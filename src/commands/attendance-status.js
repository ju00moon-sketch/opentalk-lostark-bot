import { SlashCommandBuilder } from 'discord.js';
import { getAttendanceStatus } from '../attendance.js';
import { ROOM_REQUIRED } from './attendance.js';

export const data = new SlashCommandBuilder()
  .setName('출석체크현황')
  .setDescription('이 방의 이번 달 출석 포인트·횟수와 오늘 출석 여부를 확인해요');

export const FAILED = '출석 현황을 읽지 못했어요. 잠시 후 다시 시도해 주세요';
// 표시값의 줄바꿈·서식만 정리한다. 저장소 식별 키는 바꾸지 않는다.
const label = (value) => String(value).replace(/[\x00-\x1f\x7f`*_~]/g, ' ').replace(/\s+/g, ' ').trim();

export function createExecute({ getStatus = getAttendanceStatus, now = Date.now } = {}) {
  return async function execute(interaction) {
    if (interaction.platform !== 'kakao' || typeof interaction.roomName !== 'string' || !interaction.roomName.trim()) {
      await interaction.reply(ROOM_REQUIRED);
      return;
    }
    let result;
    try {
      result = getStatus(interaction.roomName, { now });
    } catch (err) {
      console.error('출석 현황 조회 실패:', err.message);
      await interaction.reply(FAILED);
      return;
    }
    const lines = [
      `📋 ${label(result.roomName)} ${result.date.slice(0, 4)}년 ${Number(result.date.slice(5, 7))}월 출석 체크 현황`,
      `${result.date} (한국 시간) · 오늘 출석 ${result.todayCount}명 · 이번 달 참여 ${result.members.length}명`,
      '',
    ];
    if (result.members.length === 0) {
      lines.push('이번 달 이 방의 출석 기록이 없어요. ㅊㅊ로 첫 출석을 남겨 주세요.');
    } else {
      lines.push(...result.members.map((member, index) =>
        `${index + 1}. ${label(member.name)} · ${member.points.toLocaleString('ko-KR')}P · ${member.count}회 · ${member.attendedToday ? '✅ 오늘 출석' : '오늘 미출석'}`));
      lines.push('', '이번 달 이 방에서 출석한 참여자만 표시해요.');
    }
    lines.push('매월 1일 00:00(한국 시간)에 포인트·출석 횟수가 초기화돼요.');
    await interaction.reply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
  };
}

export const execute = createExecute();
