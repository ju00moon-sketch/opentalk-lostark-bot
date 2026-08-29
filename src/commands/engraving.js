import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { searchMarketItems } from '../lostark.js';
import { trunc, gold, EMBED_COLOR } from '../format.js';

const ENGRAVING_CATEGORY = 40000;
const GRADE_ORDER = { 유물: 0, 전설: 1, 영웅: 2 };

export const data = new SlashCommandBuilder()
  .setName('각인서')
  .setDescription('각인서 시세를 등급별로 검색합니다')
  .addStringOption((option) =>
    option.setName('각인명').setDescription('예: 아드레날린, 원한').setRequired(true),
  );

export async function execute(interaction) {
  const keyword = interaction.options.getString('각인명');
  await interaction.deferReply();

  const result = await searchMarketItems(ENGRAVING_CATEGORY, keyword);
  const items = result?.Items ?? [];
  if (items.length === 0) {
    await interaction.editReply(`\`${keyword}\` — 각인서를 찾지 못했어요.`);
    return;
  }

  const sorted = [...items].sort(
    (a, b) => (GRADE_ORDER[a.Grade] ?? 9) - (GRADE_ORDER[b.Grade] ?? 9),
  );
  const lines = sorted.map(
    (i) =>
      `**[${i.Grade}]** ${i.Name}\n└ 최저 **${gold(i.CurrentMinPrice)}** · 전일 평균 ${gold(i.YDayAvgPrice)} · 최근 ${gold(i.RecentPrice)}`,
  );

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`📜 각인서 시세 — "${keyword}"`)
    .setDescription(trunc(lines.join('\n'), 4096))
    .setThumbnail(sorted[0].Icon ?? null);

  await interaction.editReply({ embeds: [embed] });
}
