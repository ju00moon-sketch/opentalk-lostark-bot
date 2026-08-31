import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { parseTooltip, getQuality, findPartBox } from '../tooltip.js';
import { parsePattern, searchPattern } from '../accessory-search.js';
import { DEFAULT_QUALITY } from '../data/refine.js';

const ACC_TYPES = ['목걸이', '귀걸이', '반지'];

export const data = new SlashCommandBuilder()
  .setName('악세')
  .setDescription('악세서리 상세, 또는 연마 조합 최저가 검색')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  )
  .addStringOption((option) =>
    option.setName('검색').setDescription('연마 조합 — 예: 상상, 상중, 상단일, 상상하'),
  )
  .addIntegerOption((option) =>
    option
      .setName('품질')
      .setDescription(`최소 품질 (기본 ${DEFAULT_QUALITY})`)
      .setMinValue(0)
      .setMaxValue(100),
  );

const PATTERN_HELP =
  '연마 조합을 알아듣지 못했어요. 예: `상단일` `상상` `상중` `상하` `중중` `중하` `중단일` `상상상` `상상중` `상상하`';

async function runSearch(interaction, pattern, quality) {
  const grades = parsePattern(pattern);
  if (!grades) {
    await interaction.reply(`\`${pattern}\` — ${PATTERN_HELP}`);
    return;
  }
  await interaction.deferReply();

  const results = await searchPattern(grades, quality);
  const patternText = grades.length === 1 ? `${grades[0]}단일` : grades.join('');
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`❙ ${patternText} 악세 최저가 시세`)
    .setDescription(`❙ 기준: 고대, 3연마, 품${quality}▲`);

  for (const { slot, rows } of results) {
    const lines = rows.map((r) => {
      if (r.failed) return `${r.label}: 조회 실패`;
      if (r.price == null) return `${r.label}: 매물 없음`;
      return `${r.label}: **${r.price.toLocaleString('ko-KR')}**`;
    });
    embed.addFields({ name: `❙ ${slot}`, value: trunc(lines.join('\n')) });
  }
  embed.setFooter({ text: '경매장 즉시구매가 최저값 · 실시간 조회' });

  await interaction.editReply({ embeds: [embed] });
}

export async function execute(interaction) {
  const pattern = interaction.options.getString('검색');
  const name = resolveCharacter(interaction);
  if (pattern) {
    await runSearch(interaction, pattern, interaction.options.getInteger('품질') ?? DEFAULT_QUALITY);
    return;
  }
  if (!name) {
    await interaction.reply('`/악세 닉네임:` 으로 착용 악세를, `/악세 검색:상상` 으로 시세를 볼 수 있어요.');
    return;
  }
  await interaction.deferReply();

  const equipment = await getArmoryPart(name, 'equipment');
  if (!equipment || equipment.length === 0) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const accessories = equipment.filter((e) => ACC_TYPES.includes(e.Type));
  if (accessories.length === 0) {
    await interaction.editReply(`\`${name}\` — 장착한 악세서리가 없어요.`);
    return;
  }

  let realizationPoints = 0;
  const blocks = accessories.map((e) => {
    const tooltip = parseTooltip(e.Tooltip);
    const quality = getQuality(tooltip);
    const grinding = findPartBox(tooltip, '연마 효과') ?? [];
    const arkPoint = findPartBox(tooltip, '아크 패시브 포인트') ?? [];
    const match = /깨달음 \+(\d+)/.exec(arkPoint.join(' '));
    if (match) realizationPoints += Number(match[1]);
    const header = `**${e.Type}** ${e.Grade}${quality === null ? '' : ` · 품질 ${quality}`}`;
    return grinding.length > 0 ? `${header}\n└ ${grinding.join(' · ')}` : header;
  });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`💍 ${name} — 악세서리`)
    .setDescription(trunc(blocks.join('\n'), 4096));
  if (realizationPoints > 0) {
    embed.setFooter({ text: `깨달음 포인트 합계: +${realizationPoints}` });
  }

  await interaction.editReply({ embeds: [embed] });
}
