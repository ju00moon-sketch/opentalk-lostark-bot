import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getMarketOptions, searchMarketItems } from '../lostark.js';
import { trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('시세')
  .setDescription('거래소 아이템 가격을 검색합니다 (부분 검색 가능)')
  .addStringOption((option) =>
    option.setName('아이템명').setDescription('예: 운명의 파괴석, 아드레날린').setRequired(true),
  );

// 자주 찾는 카테고리를 앞에 두면 대부분 1~2번 호출로 끝난다.
const PREFERRED_ORDER = [50000, 40000, 60000, 70000, 220000, 90000];

let cachedCategories = null;
async function getCategoryCodes() {
  if (!cachedCategories) {
    const options = await getMarketOptions();
    const codes = (options.Categories ?? []).map((c) => c.Code);
    cachedCategories = [
      ...PREFERRED_ORDER.filter((c) => codes.includes(c)),
      ...codes.filter((c) => !PREFERRED_ORDER.includes(c)),
    ];
  }
  return cachedCategories;
}

export async function execute(interaction) {
  const itemName = interaction.options.getString('아이템명');
  await interaction.deferReply();

  const codes = await getCategoryCodes();
  let items = [];
  for (const code of codes) {
    const result = await searchMarketItems(code, itemName);
    if (result.Items?.length > 0) {
      items = result.Items;
      break;
    }
  }

  if (items.length === 0) {
    await interaction.editReply(`\`${itemName}\` — 거래소에서 찾지 못했어요. (보석은 \`/보석\`으로 검색하세요)`);
    return;
  }

  const lines = items.slice(0, 5).map((item) => {
    const bundle = item.BundleCount > 1 ? ` (${item.BundleCount}개 묶음)` : '';
    return [
      `**${item.Name}**${bundle} [${item.Grade}]`,
      `최저가 **${item.CurrentMinPrice.toLocaleString('ko-KR')}G** · 전일 평균 ${item.YDayAvgPrice.toLocaleString('ko-KR')}G · 최근 거래 ${item.RecentPrice.toLocaleString('ko-KR')}G`,
    ].join('\n');
  });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`💰 거래소 시세 — "${itemName}"`)
    .setDescription(trunc(lines.join('\n\n'), 4096))
    .setThumbnail(items[0].Icon ?? null);

  await interaction.editReply({ embeds: [embed] });
}
