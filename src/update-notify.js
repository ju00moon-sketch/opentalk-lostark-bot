// 업데이트 공지 자동 알림: 공식 공지 목록을 몇 분 간격으로 확인해 새 "업데이트 내역" 글이 올라오면
// /업데이트와 같은 화면을 알림 채널로 보낸다.
// 수요일 10시 고정 발송이 아니라 "글이 실제로 올라온 시점"에 보내므로 점검이 연장돼도 그때 맞춰 나가고,
// 점검 연장 공지가 따로 올라오면 그것도 짧게 알린다. 모험섬 알림과 같은 채널을 쓴다.
//
// 전송에 실패한 채널은 "보낸 것"으로 치지 않는다 — 어느 채널이 못 받았는지 상태 파일에 남겨 두고
// 다음 주기(3분)에 그 채널에만 다시 보낸다(최대 3번). 성공한 채널에 중복 발송은 없다.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmbedBuilder } from 'discord.js';
import { getNotices } from './lostark.js';
import { buildUpdateMessage, UPDATE_TITLE } from './commands/update.js';
import { targetChannelIds } from './notify.js';
import { EMBED_COLOR } from './format.js';
import { readJson, writeJsonAtomic } from './json-store.js';

const POLL_MS = 3 * 60 * 1000;
const MAX_RETRIES = 3;

// 마지막으로 확인한 공지 번호와 못 보낸 채널 목록. 배포(src 교체)·재부팅 후에도 남도록 프로젝트 루트에 저장한다.
//   { lastId, retries: [{ id, kind: 'update'|'extension', channels: [채널ID…], left }] }
const STATE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'update-notify.json');

const EXTENSION_TITLE = /점검.*연장|연장.*점검/;

// 공지 링크 끝의 글 번호(…/Notice/Views/13537 → 13537).
// 제목은 "(내용 추가)"처럼 나중에 바뀌기도 해서 번호로 새 글을 구분한다.
const noticeId = (n) => Number(n.Link.match(/\/(\d+)\/?$/)?.[1]) || 0;

// 깨진 상태 파일 위에 덮어쓰지 않도록 null을 돌려주고 그 주기는 건너뛴다.
function loadState() {
  try {
    const raw = readJson(STATE_PATH, {});
    return { lastId: Number(raw.lastId) || 0, retries: Array.isArray(raw.retries) ? raw.retries : [] };
  } catch (err) {
    console.error('업데이트 알림 상태 읽기 실패:', err.message);
    return null;
  }
}

const saveState = (state) => writeJsonAtomic(STATE_PATH, state, { pretty: false });

// 채널들에 보낸다 → 실패한 채널 ID 목록
async function broadcast(client, payload, label, channelIds) {
  const failed = [];
  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send(payload);
      console.log(`${label} 알림 발송 완료 → ${channelId}`);
    } catch (err) {
      failed.push(channelId);
      console.error(`${label} 알림 실패 (${channelId}):`, err.message);
    }
  }
  return failed;
}

const extensionEmbed = (n) => new EmbedBuilder()
  .setColor(EMBED_COLOR)
  .setTitle(`🔧 ${n.Title}`)
  .setURL(n.Link)
  .setDescription('점검이 연장됐어요. 업데이트 내역은 올라오는 대로 다시 알려드릴게요.')
  .setTimestamp(new Date(n.Date));

// 알림 종류별 메시지. 재시도 때도 같은 함수로 다시 만든다(공지 목록에서 내려갔으면 null → 포기).
// 'update'는 반드시 그 공지(notice)를 본문으로 — 목록의 최신 글로 만들면 그새 새 공지가 올라왔을 때
// 실패 채널에 새 글이 두 번 가고 원래 놓친 글은 사라진다.
function payloadFor(kind, notice, notices) {
  if (kind === 'update') {
    const message = buildUpdateMessage(notices, notice);
    return message ? { content: '📋 이번 주 업데이트 내역이 올라왔어요!', ...message } : null;
  }
  if (kind === 'extension') return { embeds: [extensionEmbed(notice)] };
  return null;
}

const LABEL = { update: '업데이트', extension: '점검 연장' };

export async function check(client, { fetchNotices = getNotices, channelIds = targetChannelIds } = {}) {
  const notices = await fetchNotices();
  if (!notices || notices.length === 0) return;
  const state = loadState();
  if (!state) return;

  const maxId = Math.max(...notices.map(noticeId));

  // 첫 실행: 지금까지 올라온 글은 본 것으로 치고 기준점만 잡는다 (지난 공지 재발송 방지)
  if (state.lastId === 0) {
    saveState({ lastId: maxId, retries: [] });
    return;
  }

  // 1) 지난 주기에 못 보낸 채널만 다시 — 성공했던 채널에는 가지 않는다
  const retries = [];
  for (const r of state.retries) {
    const notice = notices.find((n) => noticeId(n) === r.id);
    const payload = notice ? payloadFor(r.kind, notice, notices) : null;
    if (!payload) {
      console.error(`${LABEL[r.kind] ?? r.kind} 알림 ${r.id}: 공지가 목록에서 내려가 재발송을 포기했어요`);
      continue;
    }
    const failed = await broadcast(client, payload, `${LABEL[r.kind] ?? r.kind} 재발송`, r.channels);
    if (failed.length === 0) continue;
    if (r.left > 1) retries.push({ ...r, channels: failed, left: r.left - 1 });
    else console.error(`${LABEL[r.kind] ?? r.kind} 알림 ${r.id}: ${failed.length}개 채널에 끝내 못 보냈어요 → ${failed.join(', ')}`);
  }

  // 2) 새 공지
  if (maxId > state.lastId) {
    const fresh = notices.filter((n) => noticeId(n) > state.lastId);
    const targets = channelIds();

    const update = fresh.find((n) => UPDATE_TITLE.test(n.Title));
    if (update) {
      const payload = payloadFor('update', update, notices);
      if (payload) {
        const failed = await broadcast(client, payload, LABEL.update, targets);
        if (failed.length > 0) retries.push({ id: noticeId(update), kind: 'update', channels: failed, left: MAX_RETRIES });
      }
    }

    for (const n of fresh.filter((n) => EXTENSION_TITLE.test(n.Title))) {
      const failed = await broadcast(client, payloadFor('extension', n, notices), LABEL.extension, targets);
      if (failed.length > 0) retries.push({ id: noticeId(n), kind: 'extension', channels: failed, left: MAX_RETRIES });
    }
  }

  saveState({ lastId: Math.max(maxId, state.lastId), retries });
}

export function startUpdateNotifier(client) {
  const tick = async () => {
    try {
      await check(client);
    } catch (err) {
      console.error('업데이트 알림 확인 실패:', err.message); // 다음 주기에 다시 시도
    }
    setTimeout(tick, POLL_MS);
  };
  console.log(`업데이트 알림: ${POLL_MS / 60000}분마다 새 공지 확인 (대상 ${targetChannelIds().length}개 채널)`);
  tick();
}
