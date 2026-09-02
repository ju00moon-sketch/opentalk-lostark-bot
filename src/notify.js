// 모험섬 자동 알림: 매일 아침 8시(KST)에 오늘의 모험 섬을 채널로 발송한다.
// 홈 서버는 .env 채널, 다른 서버는 /알림설정으로 등록한 채널로 보낸다.
import { buildIslandEmbed } from './commands/island.js';
import { getNotifyChannels } from './notify-store.js';

const NOTIFY_HOUR_KST = 8;
const DAY_MS = 24 * 3600 * 1000;

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

export function startIslandNotifier(client) {
  const schedule = () => {
    const delay = msUntilNextKst(NOTIFY_HOUR_KST);
    console.log(`모험섬 알림: 다음 발송까지 약 ${Math.round(delay / 60000)}분 (대상 ${targetChannelIds().length}개 채널)`);
    setTimeout(async () => {
      try {
        const embed = await buildIslandEmbed();
        if (embed) {
          for (const channelId of targetChannelIds()) {
            try {
              const channel = await client.channels.fetch(channelId);
              await channel.send({ content: '☀️ 좋은 아침! 오늘의 모험 섬이에요.', embeds: [embed] });
              console.log(`모험섬 알림 발송 완료 → ${channelId}`);
            } catch (err) {
              console.error(`모험섬 알림 실패 (${channelId}):`, err.message);
            }
          }
        }
      } catch (err) {
        console.error('모험섬 알림 실패:', err);
      }
      schedule(); // 다음 날 다시 예약
    }, delay);
  };
  schedule();
}
