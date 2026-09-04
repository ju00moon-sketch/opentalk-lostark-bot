// /지옥 · /나락 커맨드가 공유하는 강하 선택 추천 로직.
// 추천은 매번 랜덤 — 오늘의 운에 맡기는 재미 요소다.
import { EmbedBuilder } from 'discord.js';
import { GRADES } from './data/descent.js';
import { EMBED_COLOR } from './format.js';

// 등급 없이 치면 결과 대신 사용법 — 슬래시는 옵션이 필수라 여기 오지 않고, 채팅·카톡 경로는 매처가 먼저 걸러 준다(이중 안전장치).
export const DESCENT_USAGE = (content) => `/${content} 등급 (전설·영웅·희귀 또는 7회·6회·5회) (예: /${content} 전설)`;

export async function replyDescent(interaction, content) {
  const grade = interaction.options.getString('등급');
  if (!grade) {
    await interaction.reply(`사용법: ${DESCENT_USAGE(content)}`);
    return;
  }
  const floors = GRADES.find((g) => g.value === grade)?.floors ?? 7;

  const lines = [];
  for (let floor = floors; floor >= 1; floor--) {
    const direction = Math.random() < 0.5 ? '왼쪽' : '오른쪽';
    lines.push(`**[${floor}]** ${direction === '왼쪽' ? '⬅️' : '➡️'} ${direction}`);
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🕳️ ${content} — ${grade} 강하 선택 추천 (${floors}회)`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: '🎲 오늘의 운에 맡겨보세요 — 칠 때마다 새로 뽑아드려요' });

  await interaction.reply({ embeds: [embed] });
}

export function gradeOption(option) {
  return option
    .setName('등급')
    .setDescription('강하 등급')
    .setRequired(true)
    .addChoices(...GRADES.map((g) => ({ name: g.label, value: g.value })));
}
