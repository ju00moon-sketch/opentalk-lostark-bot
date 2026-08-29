import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { searchMarketItems } from '../lostark.js';
import { REWARD_TABLES, FIXED_UNIT_VALUES, MARKET_ITEMS, DATA_DATE } from '../data/efficiency.js';
import { trunc, gold, EMBED_COLOR } from '../format.js';

const MATERIAL_CATEGORY = 50000;
const CACHE_TTL = 5 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName('효율')
  .setDescription('보상 선택지의 실시간 골드 가치 랭킹')
  .addStringOption((option) =>
    option
      .setName('콘텐츠')
      .setDescription('콘텐츠 종류')
      .setRequired(true)
      .addChoices({ name: '지옥', value: '지옥' }, { name: '나락', value: '나락' }),
  )
  .addIntegerOption((option) =>
    option.setName('레벨').setDescription('아이템 레벨 (예: 1750)').setRequired(true),
  )
  .addIntegerOption((option) =>
    option.setName('단계').setDescription('단계 (예: 10)').setRequired(true),
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
const itemsValue = (prices, items) =>
  items.reduce((sum, [name, qty]) => sum + unitValue(prices, name) * qty, 0);

export async function execute(interaction) {
  const content = interaction.options.getString('콘텐츠');
  const level = interaction.options.getInteger('레벨');
  const stage = interaction.options.getInteger('단계');

  const table = REWARD_TABLES[`${content}:${level}:${stage}`];
  if (!table) {
    const known = Object.values(REWARD_TABLES).map((t) => `\`${t.label}\``).join(', ');
    await interaction.reply({
      content: `\`${content} ${level} ${stage}단계\` 데이터가 아직 없어요.\n현재 등록된 표: ${known || '없음'}\n엉... 보상 구성(전체보기)을 알려주시면 추가할게요!`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();
  const prices = await getUnitPrices();

  const baseValue = itemsValue(prices, table.base);
  const ranked = table.options
    .map((option) => ({ ...option, value: baseValue + itemsValue(prices, option.items) }))
    .sort((a, b) => b.value - a.value);

  const lines = ranked.map((o, i) => `**[${i + 1}] ${o.name}** — ${gold(o.value)}`);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`⚖️ ${table.label} 효율`)
    .setDescription(trunc(lines.join('\n'), 4096))
    .addFields({ name: '기본 보상 가치 (모든 선택지에 포함)', value: gold(baseValue) })
    .setFooter({
      text: `거래 가능 재료는 실시간 시세, 귀속 아이템은 추정 단가 · 구성표 ${DATA_DATE} 기준`,
    });

  await interaction.editReply({ embeds: [embed] });
}
