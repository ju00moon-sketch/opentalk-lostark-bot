// 업데이트 공지 자동 알림: 공식 공지 목록을 몇 분 간격으로 확인해 새 "업데이트 내역" 글이 올라오면
// /업데이트와 같은 화면을 알림 채널로 보낸다.
// 수요일 10시 고정 발송이 아니라 "글이 실제로 올라온 시점"에 보내므로 점검이 연장돼도 그때 맞춰 나가고,
// 점검 연장 공지가 따로 올라오면 그것도 짧게 알린다. 모험섬 알림과 같은 채널을 쓴다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmbedBuilder } from 'discord.js';
import { getNotices } from './lostark.js';
import { buildUpdateMessage, UPDATE_TITLE } from './commands/update.js';
import { targetChannelIds } from './notify.js';
import { EMBED_COLOR } from './format.js';

const POLL_MS = 3 * 60 * 1000;

// 마지막으로 확인한 공지 번호. 배포(src 교체)·재부팅 후에도 남도록 프로젝트 루트에 저장한다.
const STATE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'update-notify.json');

const EXTENSION_TITLE = /점검.*연장|연장.*점검/;

// 공지 링크 끝의 글 번호(…/Notice/Views/13537 → 13537).
// 제목은 "(내용 추가)"처럼 나중에 바뀌기도 해서 번호로 새 글을 구분한다.
const noticeId = (n) => Number(n.Link.match(/\/(\d+)\/?$/)?.[1]) || 0;

function loadLastId() {
  try {
    if (existsSync(STATE_PATH)) return JSON.parse(readFileSync(STATE_PATH, 'utf8')).lastId ?? 0;
  } catch (err) {
    console.error('업데이트 알림 상태 읽기 실패:', err.message);
  }
  return 0;
}

const saveLastId = (lastId) => writeFileSync(STATE_PATH, JSON.stringify({ lastId }));

async function broadcast(client, payload, label) {
  for (const channelId of targetChannelIds()) {
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send(payload);
      console.log(`${label} 알림 발송 완료 → ${channelId}`);
    } catch (err) {
      console.error(`${label} 알림 실패 (${channelId}):`, err.message);
    }
  }
}

async function check(client) {
  const notices = await getNotices();
  if (!notices || notices.length === 0) return;

  const maxId = Math.max(...notices.map(noticeId));
  const lastId = loadLastId();

  // 첫 실행: 지금까지 올라온 글은 본 것으로 치고 기준점만 잡는다 (지난 공지 재발송 방지)
  if (lastId === 0) {
    saveLastId(maxId);
    return;
  }
  if (maxId <= lastId) return;

  const fresh = notices.filter((n) => noticeId(n) > lastId);

  if (fresh.some((n) => UPDATE_TITLE.test(n.Title))) {
    const message = buildUpdateMessage(notices);
    if (message) await broadcast(client, { content: '📋 이번 주 업데이트 내역이 올라왔어요!', ...message }, '업데이트');
  }

  for (const n of fresh.filter((n) => EXTENSION_TITLE.test(n.Title))) {
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`🔧 ${n.Title}`)
      .setURL(n.Link)
      .setDescription('점검이 연장됐어요. 업데이트 내역은 올라오는 대로 다시 알려드릴게요.')
      .setTimestamp(new Date(n.Date));
    await broadcast(client, { embeds: [embed] }, '점검 연장');
  }

  saveLastId(maxId);
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
