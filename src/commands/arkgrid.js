import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { stripTags } from '../tooltip.js';

export const data = new SlashCommandBuilder()
  .setName('앜그')
  .setDescription('아크 그리드 코어와 효과')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임').setRequired(true),
  );

export async function execute(interaction) {
  const name = interaction.options.getString('닉네임');
  await interaction.deferReply();

  const grid = await getArmoryPart(name, 'arkgrid');
  if (!grid || !grid.Slots || grid.Slots.length === 0) {
    await interaction.editReply(`\`${name}\` — 아크 그리드 정보가 없어요. (닉네임 확인 또는 미개방)`);
    return;
  }

  const coreLines = grid.Slots.map((s) => `**${s.Name}** — ${s.Grade} · ${s.Point}P`);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🔮 ${name} — 아크 그리드`)
    .addFields({ name: '코어', value: trunc(coreLines.join('\n')) });

  const effects = (grid.Effects ?? []).map(
    (e) => `${stripTags(e.Tooltip)}${e.Level ? ` (Lv.${e.Level})` : ''}`,
  );
  if (effects.length > 0) {
    embed.addFields({ name: '적용 효과', value: trunc(effects.join('\n')) });
  }

  await interaction.editReply({ embeds: [embed] });
}
