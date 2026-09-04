// 모험섬 자동 알림: 매일 아침 8시(KST)에 오늘의 모험 섬을 채널로 발송한다.
// 홈 서버는 .env 채널, 다른 서버는 /알림설정으로 등록한 채널로 보낸다.
//
// 실패해도 하루를 통째로 건너뛰지 않는다 — API가 잠깐 안 되거나 일부 채널 전송이 실패하면
// 10분 뒤 그 채널들만 다시 시도한다(최대 3번). 성공한 채널에는 다시 보내지 않는다.
// 재시도 대기 상태는 파일(island-notify.json)에 남겨, 기다리는 사이 봇이 재시작돼도 이어서 시도한다.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIslandEmbed } from './commands/island.js';
import { getNotifyChannels } from './notify-store.js';
import { readJson, writeJsonAtomic } from './json-store.js';
import { kstDate } from './price-history.js';

const NOTIFY_HOUR_KST = 8;
const DAY_MS = 24 * 3600 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const RESUME_MS = 60 * 1000; // 재시작 직후 이어서 시도하기까지 — 디스코드 로그인이 안정된 뒤에
const MAX_ATTEMPTS = 3;

// { date: 'YYYY-MM-DD', pending: [채널ID…], attempt } — pending이 비어 있으면 그날 발송이 끝난 것
const STATE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'island-notify.json');

function loadState() {
  try {
    const raw = readJson(STATE_PATH, null);
    if (!raw || typeof raw !== 'object') return null;
    return { date: String(raw.date ?? ''), pending: Array.isArray(raw.pending) ? raw.pending : [], attempt: Number(raw.attempt) || 1 };
  } catch (err) {
    console.error('모험섬 알림 상태 읽기 실패:', err.message);
    return null;
  }
}

function saveState(state) {
  try {
    writeJsonAtomic(STATE_PATH, state, { pretty: false });
  } catch (err) {
    console.error('모험섬 알림 상태 쓰기 실패:', err.message); // 상태를 못 남겨도 발송은 계속한다
  }
}

// 다음 KST hour시 정각까지 남은 시간(ms)
function msUntilNextKst(hour) {
  const nowKst = Date.now() + 9 * 3600 * 1000;
  const midnightKst = Math.floor(nowKst / DAY_MS) * DAY_MS;
  let target = midnightKst + hour * 3600 * 1000;
  if (target <= nowKst) target += DAY_MS;
  return target - nowKst;
}

// 알림을 보낼 채널 목록 — 업데이트 알림(update-notify.js)도 같은 채널을 쓴다.
export function targetChannelIds() {
  const homeChannel =
    process.env.NOTIFY_CHANNEL_ID ||
    (process.env.ALLOWED_CHANNEL_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)[0];
  const ids = new Set(Object.values(getNotifyChannels()));
  if (homeChannel) ids.add(homeChannel);
  return [...ids];
}

// channelIds에 오늘 모험섬을 보낸다 → 다시 시도해야 할 채널 목록.
// API 조회 자체가 실패하면 전부 재시도 대상이고, 보낼 섬이 없으면(빈 임베드) 끝난 것으로 본다.
export async function sendIslandNotice(client, channelIds, { build = buildIslandEmbed } = {}) {
  let embed;
  try {
    embed = await build();
  } catch (err) {
    console.error('모험섬 알림: 섬 정보 조회 실패:', err.message);
    return channelIds;
  }
  if (!embed) return [];

  const failed = [];
  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send({ content: '☀️ 좋은 아침! 오늘의 모험 섬이에요.', embeds: [embed] });
      console.log(`모험섬 알림 발송 완료 → ${channelId}`);
    } catch (err) {
      failed.push(channelId);
      console.error(`모험섬 알림 실패 (${channelId}):`, err.message);
    }
  }
  return failed;
}

// 실패한 채널만 모아 재시도하고, 재시도가 끝난 뒤에 다음 날을 예약한다(예약이 겹치지 않게).
// setTimer·build·now는 테스트에서 시계와 API를 바꿔 끼우기 위한 것.
export function startIslandNotifier(client, { setTimer = setTimeout, build = buildIslandEmbed, now = Date.now } = {}) {
  const scheduleNext = () => {
    const delay = msUntilNextKst(NOTIFY_HOUR_KST);
    console.log(`모험섬 알림: 다음 발송까지 약 ${Math.round(delay / 60000)}분 (대상 ${targetChannelIds().length}개 채널)`);
    setTimer(() => run(targetChannelIds(), 1, kstDate(now())), delay);
  };

  const run = async (channelIds, attempt, date) => {
    let retry = channelIds;
    try {
      retry = await sendIslandNotice(client, channelIds, { build });
    } catch (err) {
      console.error('모험섬 알림 실패:', err);
    }
    if (retry.length > 0 && attempt < MAX_ATTEMPTS) {
      saveState({ date, pending: retry, attempt: attempt + 1 }); // 기다리는 사이 재시작돼도 이어서 시도하도록
      console.log(`모험섬 알림: ${retry.length}개 채널 ${RETRY_MS / 60000}분 뒤 재시도 (${attempt}/${MAX_ATTEMPTS})`);
      setTimer(() => run(retry, attempt + 1, date), RETRY_MS);
      return;
    }
    if (retry.length > 0) console.error(`모험섬 알림: ${retry.length}개 채널에 끝내 못 보냈어요 → ${retry.join(', ')}`);
    saveState({ date, pending: [], attempt: 0 });
    scheduleNext();
  };

  // 재시작 전 오늘 재시도가 남아 있었으면 다음 날을 기다리지 않고 잠시 뒤 이어서 시도한다
  const saved = loadState();
  if (saved && saved.date === kstDate(now()) && saved.pending.length > 0 && saved.attempt <= MAX_ATTEMPTS) {
    console.log(`모험섬 알림: 재시작 전 남은 재시도(${saved.pending.length}개 채널, ${saved.attempt}/${MAX_ATTEMPTS})를 ${RESUME_MS / 1000}초 뒤 이어서 시도`);
    setTimer(() => run(saved.pending, saved.attempt, saved.date), RESUME_MS);
    return;
  }
  scheduleNext();
}
