// 떠돌이 상인 자동 알림: 출현(하루 4회, 04·10·16·22시 KST) 10분 뒤에 /떠상 전체 판을 알림 채널로 보낸다.
// 채널은 모험섬 아침 알림과 같다(/알림설정). 정각 직후에는 제보가 적어서 10분을 기다린다(처음 5분이었다가 2026-09-07 사용자 결정으로 늘림).
//
// 판을 못 만들거나(조회 실패·제보 회차 아직 없음) 일부 채널 전송이 실패하면 10분 뒤 그 채널들만 다시 시도한다(최대 3번).
// 재시도 대기 상태는 파일(merchant-notify.json)에 남겨 그사이 봇이 재시작돼도 이어서 시도한다.
// 시작 시 발송 시각이 지났으면: 유예(60분) 안이고 이 회차 기록이 없을 때만 늦게라도 한 번 보내고, 아니면 다음 출현부터 보낸다.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMerchantNotice } from './commands/merchant.js';
import { getMerchantWindows } from './merchant.js';
import { targetChannelIds } from './notify.js';
import { readJson, writeJsonAtomic } from './json-store.js';

export const SEND_DELAY_MS = 10 * 60 * 1000; // 출현 뒤 제보가 쌓이기를 기다리는 시간
export const RETRY_MS = 10 * 60 * 1000;
export const MAX_ATTEMPTS = 3;
export const GRACE_MS = 60 * 60 * 1000; // 시작 시 발송 시각이 지났어도 이 안이면 늦게라도 보낸다
export const RESUME_MS = 60 * 1000; // 재시작 직후 이어서 시도하기까지 — 디스코드 로그인이 안정된 뒤에
export const RESCHEDULE_MS = 10 * 60 * 1000; // 시간표를 못 받았을 때 예약을 다시 시도하는 간격

// { windowStart: 회차 시작(epoch ms), pending: [채널ID…], attempt } — pending이 비어 있으면 그 회차 발송이 끝난 것
const STATE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'merchant-notify.json');
const minutes = (ms) => Math.round(ms / 60000);

function loadState(statePath) {
  try {
    const raw = readJson(statePath, null);
    if (!raw || typeof raw !== 'object' || !Number.isFinite(raw.windowStart)) return null;
    return { windowStart: raw.windowStart, pending: Array.isArray(raw.pending) ? raw.pending.map(String) : [], attempt: Number(raw.attempt) || 1 };
  } catch (err) {
    console.error('떠상 알림 상태 읽기 실패:', err.message);
    return null;
  }
}

function saveState(statePath, state) {
  try {
    writeJsonAtomic(statePath, state, { pretty: false });
  } catch (err) {
    console.error('떠상 알림 상태 쓰기 실패:', err.message); // 상태를 못 남겨도 발송은 계속한다
  }
}

// channelIds에 전체 판을 보낸다 → 다시 시도해야 할 채널 목록. 판을 못 만들면 전부 재시도 대상.
export async function sendMerchantNotice(client, channelIds, { build = buildMerchantNotice } = {}) {
  let payload;
  try {
    payload = await build();
  } catch (err) {
    console.error('떠상 알림: 판 조회 실패:', err.message);
    return channelIds;
  }
  if (!payload) {
    console.error('떠상 알림: 아직 판을 만들 수 없어요(조회 실패 또는 제보 회차 없음)');
    return channelIds;
  }
  const failed = [];
  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send(payload);
      console.log(`떠상 알림 발송 완료 → ${channelId}`);
    } catch (err) {
      failed.push(channelId);
      console.error(`떠상 알림 실패 (${channelId}):`, err.message);
    }
  }
  return failed;
}

// setTimer·now·build·windows·channels·statePath는 테스트에서 시계·API·저장 위치를 바꿔 끼우기 위한 것.
// 반환값은 첫 예약이 끝나는 프로미스(시작 코드는 기다리지 않아도 된다).
export function startMerchantNotifier(client, {
  setTimer = setTimeout, now = Date.now, build = buildMerchantNotice, windows = getMerchantWindows,
  channels = targetChannelIds, statePath = STATE_PATH,
} = {}) {
  const plan = async () => {
    try {
      await schedule();
    } catch (err) {
      console.error('떠상 알림 예약 실패:', err);
      setTimer(plan, RESCHEDULE_MS);
    }
  };

  const schedule = async () => {
    const at = now();
    const found = await windows(at);
    if (!found) {
      console.error(`떠상 알림: 시간표를 받지 못해 ${minutes(RESCHEDULE_MS)}분 뒤 다시 예약`);
      setTimer(plan, RESCHEDULE_MS);
      return;
    }
    const { current, next } = found;
    if (current) {
      // 실행 중에는 메모리 상태를 기준으로 삼는다 — 저장이 실패해도 방금 보낸 회차를 다시 보내거나 끝난 재시도를 되풀이하지 않는다.
      const saved = state;
      const thisRound = saved && saved.windowStart === current.startsAt;
      if (thisRound && saved.pending.length > 0 && saved.attempt <= MAX_ATTEMPTS) {
        console.log(`떠상 알림: 재시작 전 남은 재시도(${saved.pending.length}개 채널, ${saved.attempt}/${MAX_ATTEMPTS})를 ${RESUME_MS / 1000}초 뒤 이어서 시도`);
        setTimer(() => run(current, saved.pending, saved.attempt), RESUME_MS);
        return;
      }
      if (!thisRound) {
        const sendAt = current.startsAt + SEND_DELAY_MS;
        if (at < sendAt) {
          console.log(`떠상 알림: 이번 출현 발송까지 약 ${minutes(sendAt - at)}분 (대상 ${channels().length}개 채널)`);
          setTimer(() => run(current, channels(), 1), sendAt - at);
          return;
        }
        if (at < current.startsAt + GRACE_MS) {
          console.log(`떠상 알림: 발송 시각이 지나 ${RESUME_MS / 1000}초 뒤 늦게 발송 (대상 ${channels().length}개 채널)`);
          setTimer(() => run(current, channels(), 1), RESUME_MS);
          return;
        }
      }
    }
    if (!next) {
      console.error(`떠상 알림: 다음 출현을 알 수 없어 ${minutes(RESCHEDULE_MS)}분 뒤 다시 예약`);
      setTimer(plan, RESCHEDULE_MS);
      return;
    }
    const delay = next.startsAt + SEND_DELAY_MS - at;
    console.log(`떠상 알림: 다음 발송까지 약 ${minutes(delay)}분 (대상 ${channels().length}개 채널)`);
    setTimer(() => run(next, channels(), 1), delay);
  };

  // 실패한 채널만 모아 재시도하고, 재시도가 끝난 뒤에 다음 회차를 예약한다(예약이 겹치지 않게).
  const run = async (window, channelIds, attempt) => {
    let retry = channelIds;
    try {
      retry = await sendMerchantNotice(client, channelIds, { build });
    } catch (err) {
      console.error('떠상 알림 실패:', err);
    }
    if (retry.length > 0 && attempt < MAX_ATTEMPTS) {
      remember({ windowStart: window.startsAt, pending: retry, attempt: attempt + 1 });
      console.log(`떠상 알림: ${retry.length}개 채널 ${minutes(RETRY_MS)}분 뒤 재시도 (${attempt}/${MAX_ATTEMPTS})`);
      setTimer(() => run(window, retry, attempt + 1), RETRY_MS);
      return;
    }
    if (retry.length > 0) console.error(`떠상 알림: ${retry.length}개 채널에 끝내 못 보냈어요 → ${retry.join(', ')}`);
    remember({ windowStart: window.startsAt, pending: [], attempt: 0 });
    await plan();
  };

  // 메모리 상태를 먼저 바꾸고 디스크에 남긴다. 디스크는 재시작 복원용이라 저장 실패가 예약을 바꾸지 않는다.
  const remember = (next) => {
    state = next;
    saveState(statePath, next);
  };

  let state = loadState(statePath); // 재시작 복원은 시작 때 한 번만 읽는다
  return plan();
}
