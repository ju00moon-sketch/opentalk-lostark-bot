import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { parseTooltip, findPartBox } from '../tooltip.js';

export const data = new SlashCommandBuilder()
  .setName('팔찌')
  .setDescription('팔찌 효과 상세')
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

  const bracelet = equipment.find((e) => e.Type === '팔찌');
  if (!bracelet) {
    await interaction.editReply(`\`${name}\` — 장착한 팔찌가 없어요.`);
    return;
  }

  const tooltip = parseTooltip(bracelet.Tooltip);
  const effects = findPartBox(tooltip, '팔찌 효과') ?? [];

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`📿 ${name} — 팔찌`)
    .setDescription(`**${bracelet.Name}** (${bracelet.Grade})`);
  if (effects.length > 0) {
    embed.addFields({ name: '효과', value: trunc(effects.map((e) => `• ${e}`).join('\n')) });
  }

  await interaction.editReply({ embeds: [embed] });
}
