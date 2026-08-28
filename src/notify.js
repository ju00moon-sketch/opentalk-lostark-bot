// 모험섬 자동 알림: 매일 아침 8시(KST)에 오늘의 모험 섬을 채널로 발송한다.
import { buildIslandEmbed } from './commands/island.js';

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

export function startIslandNotifier(client) {
  // 지정 채널이 없으면 허용 채널 중 첫 번째를 쓴다
  const channelId =
    process.env.NOTIFY_CHANNEL_ID ||
    (process.env.ALLOWED_CHANNEL_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)[0];

  if (!channelId) {
    console.log('모험섬 알림: 대상 채널이 없어 비활성화 (NOTIFY_CHANNEL_ID 또는 ALLOWED_CHANNEL_IDS 필요)');
    return;
  }

  const schedule = () => {
    const delay = msUntilNextKst(NOTIFY_HOUR_KST);
    console.log(`모험섬 알림: 다음 발송까지 약 ${Math.round(delay / 60000)}분`);
    setTimeout(async () => {
      try {
        const embed = await buildIslandEmbed();
        if (embed) {
          const channel = await client.channels.fetch(channelId);
          await channel.send({ content: '☀️ 좋은 아침! 오늘의 모험 섬이에요.', embeds: [embed] });
          console.log('모험섬 알림 발송 완료');
        }
      } catch (err) {
        console.error('모험섬 알림 실패:', err);
      }
      schedule(); // 다음 날 다시 예약
    }, delay);
  };
  schedule();
}
