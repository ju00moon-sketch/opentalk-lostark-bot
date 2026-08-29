// /지옥 · /나락 커맨드가 공유하는 강하 추천 출력 로직.
import { EmbedBuilder } from 'discord.js';
import { PATH, GRADES, DATA_DATE } from './data/descent.js';
import { EMBED_COLOR } from './format.js';

export async function replyDescent(interaction, content) {
  const grade = interaction.options.getString('등급') ?? '전설';
  const floors = GRADES.find((g) => g.value === grade)?.floors ?? 7;

  // 경로 배열은 7층부터 — 등급에 맞춰 시작 층 이하만 사용한다
  const path = PATH.slice(PATH.length - floors);
  const lines = path.map((direction, i) => {
    const floor = floors - i;
    const arrow = direction === '왼쪽' ? '⬅️' : '➡️';
    return `**[${floor}]** ${arrow} ${direction}`;
  });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🕳️ ${content} — ${grade} 강하 선택 추천 (${floors}회)`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `${DATA_DATE} 기준` });

  await interaction.reply({ embeds: [embed] });
}

export function gradeOption(option) {
  return option
    .setName('등급')
    .setDescription('강하 등급 (기본: 전설)')
    .addChoices(...GRADES.map((g) => ({ name: g.label, value: g.value })));
}
