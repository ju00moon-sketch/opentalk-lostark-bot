import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { parseTooltip, getQuality, findPartBox } from '../tooltip.js';

const ACC_TYPES = ['목걸이', '귀걸이', '반지'];

export const data = new SlashCommandBuilder()
  .setName('악세')
  .setDescription('악세서리 상세 (품질 · 연마 효과)')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임').setRequired(true),
  );

export async function execute(interaction) {
  const name = interaction.options.getString('닉네임');
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
