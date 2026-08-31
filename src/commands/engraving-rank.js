import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { searchMarketItems } from '../lostark.js';
import { trunc, gold, EMBED_COLOR } from '../format.js';

const ENGRAVING_CATEGORY = 40000;

export const data = new SlashCommandBuilder()
  .setName('각인서랭킹')
  .setDescription('가장 비싼 각인서 TOP 10')
  .addStringOption((option) =>
    option
      .setName('등급')
      .setDescription('각인서 등급 (기본: 유물)')
      .addChoices({ name: '유물 (유각)', value: '유물' }, { name: '전설 (전각)', value: '전설' }),
  );

// /유각 · /전각처럼 등급이 고정된 커맨드에서도 재사용한다.
export async function showRanking(interaction, grade) {
  await interaction.deferReply();

  const result = await searchMarketItems(ENGRAVING_CATEGORY, '', { grade, order: 'DESC' });
  const items = (result?.Items ?? []).slice(0, 10);
  if (items.length === 0) {
    await interaction.editReply('각인서 정보를 가져오지 못했어요.');
    return;
  }

  const lines = items.map(
    (i, rank) => `**${rank + 1}.** ${i.Name.replace(`${grade} `, '').replace(' 각인서', '')} — **${gold(i.CurrentMinPrice)}**`,
  );

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🏆 비싼 ${grade} 각인서 TOP ${items.length}`)
    .setDescription(trunc(lines.join('\n'), 4096));

  await interaction.editReply({ embeds: [embed] });
}

export function execute(interaction) {
  return showRanking(interaction, interaction.options.getString('등급') ?? '유물');
}
