import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { searchMarketItems } from '../lostark.js';
import { buildTable, FIXED_UNIT_VALUES, MARKET_ITEMS, DATA_DATE } from '../data/efficiency.js';
import { trunc, gold, EMBED_COLOR } from '../format.js';

const MATERIAL_CATEGORY = 50000;
const CACHE_TTL = 5 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName('효율')
  .setDescription('지옥/나락 보상 선택지의 실시간 골드 가치 랭킹 (1750 열쇠)')
  .addStringOption((option) =>
    option
      .setName('콘텐츠')
      .setDescription('콘텐츠 종류')
      .setRequired(true)
      .addChoices({ name: '지옥', value: '지옥' }, { name: '나락', value: '나락' }),
  )
  .addIntegerOption((option) =>
    option
      .setName('단계')
      .setDescription('진행도 단계 (0~10)')
      .setRequired(true)
      .setMinValue(0)
      .setMaxValue(10),
  );

// 거래소 시세 캐시 (아이템명 → 개당 골드)
let priceCache = null;
let cachedAt = 0;

async function getUnitPrices() {
  if (priceCache && Date.now() - cachedAt < CACHE_TTL) return priceCache;
  const prices = new Map();
  for (const itemName of MARKET_ITEMS) {
    try {
      const result = await searchMarketItems(MATERIAL_CATEGORY, itemName);
      const exact = (result?.Items ?? []).find((i) => i.Name === itemName) ?? result?.Items?.[0];
      if (exact) prices.set(itemName, exact.CurrentMinPrice / (exact.BundleCount || 1));
    } catch {
      // 시세 조회 실패 시 추정 단가로 폴백
    }
  }
  priceCache = prices;
  cachedAt = Date.now();
  return prices;
}

const unitValue = (prices, name) => prices.get(name) ?? FIXED_UNIT_VALUES[name] ?? 0;

// parts 항목 하나의 가치. 배열이면 지급, { choice }면 택1 중 최대값.
function partValue(prices, part) {
  if (Array.isArray(part)) return unitValue(prices, part[0]) * part[1];
  return Math.max(...part.choice.map(([name, qty]) => unitValue(prices, name) * qty));
}

export async function execute(interaction) {
  const content = interaction.options.getString('콘텐츠');
  const stage = interaction.options.getInteger('단계');

  const table = buildTable(content, stage);
  if (!table) {
    await interaction.reply(`\`${content} ${stage}단계\` 데이터가 없어요. 단계는 0~10이에요.`);
    return;
  }

  await interaction.deferReply();
  const prices = await getUnitPrices();

  const ranked = table.options
    .map((option) => ({
      name: option.name,
      value: table.baseGold + option.parts.reduce((sum, part) => sum + partValue(prices, part), 0),
    }))
    .sort((a, b) => b.value - a.value);

  const lines = ranked.map((o, i) => `**[${i + 1}] ${o.name}** — ${gold(o.value)}`);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`⚖️ ${table.label} 효율`)
    .setDescription(trunc(lines.join('\n'), 4096))
    .setFooter({
      text:
        (table.baseGold > 0 ? `기본 보상(약 ${gold(table.baseGold)}) 포함 · ` : '') +
        `재료는 실시간 시세, 귀속템은 추정 단가 · 구성표 ${DATA_DATE} 기준`,
    });

  await interaction.editReply({ embeds: [embed] });
}
