import { SlashCommandBuilder } from 'discord.js';
import { checkIn as checkInStore } from '../attendance.js';

export const data = new SlashCommandBuilder()
  .setName('출첵')
  .setDescription('출석 체크 — 이 방에서 하루 한 번 1~3P 무작위 지급, 방별 월간 포인트 표시');

export const FAILED = '출석 기록을 저장하지 못했어요. 잠시 후 다시 시도해 주세요';
export const ROOM_REQUIRED = '출석 기능은 카카오톡 오픈채팅방에서 사용할 수 있어요';

// 카톡 방 닉네임을 사용하며 없으면 "회원"으로 표시한다.
const nameOf = (interaction) => interaction.member?.displayName || interaction.user?.username || '회원';

// 의존성을 주입할 수 있게 실행 함수를 만드는 공장 — 테스트에서 저장소와 시계를 대역으로 바꾼다.
export function createExecute({ checkIn = checkInStore, now = Date.now } = {}) {
  return async function execute(interaction) {
    if (interaction.platform !== 'kakao' || typeof interaction.roomName !== 'string' || !interaction.roomName.trim()) {
      await interaction.reply(ROOM_REQUIRED);
      return;
    }
    const name = nameOf(interaction);
    let result;
    try {
      result = checkIn(interaction.user.id, { roomName: interaction.roomName, name, now }); // 동기 저장이라 deferReply 없이 바로 답한다
    } catch (err) {
      console.error('출석 저장 실패:', err.message);
      await interaction.reply(FAILED);
      return;
    }
    // 별명이 답장에 들어가므로 멘션 해석을 끈다(별명에 @everyone·<@id>가 있어도 알림이 가지 않게, 기술 검토 P2-2).
    const say = (content) => interaction.reply({ content, allowedMentions: { parse: [] } });
    if (result.status === 'already') {
      await say(`${name}님은 오늘 이 방에서 이미 출석했어요 · 이번 달 누적 ${result.total}P · 내일 00:00(한국 시간)부터 다시 할 수 있어요`);
      return;
    }
    await say(`✅ ${name}님 출석 완료! +${result.gained}P · 이번 달 누적 ${result.total}P · 이번 달 ${result.count}번째 출석`);
  };
}

export const execute = createExecute();
