import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { searchMarketItems } from '../lostark.js';
import { trunc, amount, priceDelta, EMBED_COLOR } from '../format.js';

const ENGRAVING_CATEGORY = 40000;

// 등급 고정 단축 커맨드 이름 — "다음 쪽" 안내에 그대로 쓴다.
const SHORT_COMMAND = { 유물: '유각', 전설: '전각' };

// 단어형 커맨드 접두사: 디스코드 채팅은 ".", 카카오톡은 "/".
const prefixFor = (interaction) => (interaction.platform === 'kakao' ? '/' : '.');

const shortName = (name, grade) => name.replace(`${grade} `, '').replace(' 각인서', '');

export const data = new SlashCommandBuilder()
  .setName('각인서랭킹')
  .setDescription('가장 비싼 각인서 TOP 10 (전일 대비 포함)')
  .addStringOption((option) =>
    option
      .setName('등급')
      .setDescription('각인서 등급 (기본: 유물)')
      .addChoices({ name: '유물 (유각)', value: '유물' }, { name: '전설 (전각)', value: '전설' }),
  )
  .addIntegerOption((option) =>
    option.setName('페이지').setDescription('몇 쪽 (기본 1 · 한 쪽에 10개)').setMinValue(1).setMaxValue(20),
  );

// /유각 · /전각처럼 등급이 고정된 커맨드에서도 재사용한다.
export async function showRanking(interaction, grade, page = 1) {
  await interaction.deferReply();

  const result = await searchMarketItems(ENGRAVING_CATEGORY, '', { grade, order: 'DESC', page });
  const items = result?.Items ?? [];
  if (items.length === 0) {
    await interaction.editReply(
      page > 1 ? `${page}쪽에는 각인서가 없어요.` : '각인서 정보를 가져오지 못했어요.',
    );
    return;
  }

  const lines = items.map((i) => `${shortName(i.Name, grade)}: ${amount(i.CurrentMinPrice)}`);

  // 다음 쪽 안내 — 거래소는 한 쪽에 PageSize개씩 준다.
  const pageSize = result.PageSize ?? items.length;
  const shortCommand = SHORT_COMMAND[grade];
  if (shortCommand && page * pageSize < (result.TotalCount ?? 0)) {
    lines.push('', `※ 다음 검색: ${prefixFor(interaction)}${shortCommand} ${page + 1}`);
  }

  // 전일 대비는 거래소가 주는 전일 평균 거래가(YDayAvgPrice)를 기준으로 한다.
  const deltas = items
    .map((i) => {
      const delta = priceDelta(i.CurrentMinPrice, i.YDayAvgPrice);
      return delta === null ? null : `${shortName(i.Name, grade)}: ${delta}`;
    })
    .filter(Boolean);
  if (deltas.length > 0) lines.push('', '▼ 전일 대비 더보기', ...deltas);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🏆 ${grade} 각인서 시세랭킹${page > 1 ? ` (${page}쪽)` : ''}`)
    .setDescription(trunc(lines.join('\n'), 4096))
    .setFooter({
      text: deltas.length > 0 ? '최저가 · 전일 대비는 전일 평균 거래가 기준' : '최저가',
    });

  await interaction.editReply({ embeds: [embed] });
}

export function execute(interaction) {
  return showRanking(
    interaction,
    interaction.options.getString('등급') ?? '유물',
    interaction.options.getInteger('페이지') ?? 1,
  );
}
