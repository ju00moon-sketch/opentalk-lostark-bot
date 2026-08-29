import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { searchMarketItems } from '../lostark.js';
import { gold, EMBED_COLOR } from '../format.js';

const LIFE_SUBCATEGORIES = [
  [90200, '🌿 식물채집'],
  [90300, '🪓 벌목'],
  [90400, '⛏️ 채광'],
  [90500, '🏹 수렵'],
  [90600, '🎣 낚시'],
  [90700, '🏺 고고학'],
];

export const data = new SlashCommandBuilder()
  .setName('생활재료')
  .setDescription('생활 재료 시세를 분야별로 보여줍니다');

export async function execute(interaction) {
  await interaction.deferReply();

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('🧺 생활 재료 시세 (비싼 순)');

  for (const [code, label] of LIFE_SUBCATEGORIES) {
    const result = await searchMarketItems(code, '', { order: 'DESC' });
    const items = (result?.Items ?? []).slice(0, 3);
    if (items.length === 0) continue;
    const lines = items.map(
      (i) => `${i.Name} — **${gold(i.CurrentMinPrice)}**${i.BundleCount > 1 ? ` /${i.BundleCount}개` : ''}`,
    );
    embed.addFields({ name: label, value: lines.join('\n'), inline: true });
  }

  await interaction.editReply({ embeds: [embed] });
}
