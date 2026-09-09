import { SlashCommandBuilder } from 'discord.js';
import { getAttendanceStatus } from '../attendance.js';
import { ROOM_REQUIRED } from './attendance.js';

export const data = new SlashCommandBuilder()
  .setName('출석현황')
  .setDescription('이 방의 이번 달 출석 순위표를 확인해요');

export const FAILED = '출석 현황을 읽지 못했어요. 잠시 후 다시 시도해 주세요';
export const HEADER = '[출석 현황표]';
export const FOLD_LABEL = '▼ 출석 현황 전체보기';
// 카톡은 긴 메시지를 접어 "전체보기" 버튼으로 보여 준다. 전체보기 줄 뒤에 폭 0 공백(U+200B)을 길게 넣어
// 방에는 제목과 전체보기 줄만 보이고, 누른 사람만 순위표를 보게 한다(사용자 결정 2026-09-09).
// 폭 0 공백도 기존 1,500자 전송 예산에 원시 길이로 들어간다. 넘치는 순위는 기존 전체 보기 링크로 이어진다(누락 없음).
export const FOLD_PADDING = '\u200b'.repeat(500);
// 표시값의 줄바꿈·서식·폭 0 문자만 정리한다. 저장소 식별 키는 바꾸지 않는다.
const label = (value) => String(value).replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[\x00-\x1f\x7f`*_~]/g, ' ').replace(/\s+/g, ' ').trim();

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
    const lines = [HEADER, ''];
    if (result.members.length === 0) {
      lines.push('이번 달 이 방의 출석 기록이 없어요. ㅊㅊ로 첫 출석을 남겨 주세요.');
    } else {
      // 순위는 정렬(포인트 → 횟수 → 이름) 순서의 연번이다. 동점도 연번으로 적는다(사용자 예시).
      lines.push(FOLD_LABEL, FOLD_PADDING,
        ...result.members.map((member, index) => `[${index + 1}위] ${label(member.name)} | ${member.points}P`));
    }
    await interaction.reply({ content: lines.join('\n'), allowedMentions: { parse: [] } });
  };
}

export const execute = createExecute();
