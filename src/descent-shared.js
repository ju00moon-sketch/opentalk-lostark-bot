// /지옥 · /나락 커맨드가 공유하는 강하 추천 출력 로직.
import { EmbedBuilder, MessageFlags } from 'discord.js';
import { DESCENT, GRADES, DATA_DATE } from './data/descent.js';
import { EMBED_COLOR } from './format.js';

export async function replyDescent(interaction, content) {
  const grade = interaction.options.getString('등급') ?? '전설';
  const path = DESCENT[content]?.[grade];

  if (!path) {
    await interaction.reply({
      content: `\`${content} ${grade}\` 경로 데이터가 아직 없어요. 추천 경로를 알려주시면 바로 추가할게요!`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const floors = path.length;
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
