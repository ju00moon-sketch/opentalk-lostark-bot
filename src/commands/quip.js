import { SlashCommandBuilder } from 'discord.js';
import { getQuip as getQuipStore } from '../quip.js';

export const data = new SlashCommandBuilder()
  .setName('한마디')
  .setDescription('오늘의 한마디 — 하루 한 번 건네는 짧은 응원과 생각거리');

export const FAILED = '오늘의 한마디를 준비하지 못했어요. 잠시 후 다시 시도해 주세요';

// 카톡 방 닉네임, 없으면 계정 이름 또는 "회원".
const nameOf = (interaction) => interaction.member?.displayName || interaction.user?.username || '회원';

// 의존성을 주입할 수 있게 실행 함수를 만드는 공장 — 테스트에서 생성·저장을 대역으로 바꾼다.
export function createExecute({ getQuip = getQuipStore, now = Date.now } = {}) {
  return async function execute(interaction) {
    const name = nameOf(interaction);
    await interaction.deferReply(); // LLM 호출은 몇 초 걸릴 수 있다
    let result;
    try {
      result = await getQuip(interaction.user.id, { now });
    } catch (err) {
      console.error('한마디 저장 실패:', err.message);
      await interaction.editReply(FAILED);
      return;
    }
    // 첫 응답은 이름과 본문만, 이미 받은 사용자의 재요청은 다음 날 안내만 보낸다.
    const content = result.status === 'repeat'
      ? '오늘의 한마디는 이미 받으셨어요. 내일 00:00(한국 시간) 이후에 다시 시도해 주세요.'
      : `${name}님 ${result.text}`;
    // 별명과 생성 문장이 답장에 들어가므로 멘션 해석을 끈다(@everyone·<@id>가 섞여도 알림이 가지 않게).
    await interaction.editReply({ content, allowedMentions: { parse: [] } });
  };
}

export const execute = createExecute();
