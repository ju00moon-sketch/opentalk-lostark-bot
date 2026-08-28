import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { stripTags } from '../tooltip.js';

export const data = new SlashCommandBuilder()
  .setName('앜패')
  .setDescription('아크 패시브 포인트와 노드')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임').setRequired(true),
  );

export async function execute(interaction) {
  const name = interaction.options.getString('닉네임');
  await interaction.deferReply();

  const ark = await getArmoryPart(name, 'arkpassive');
  if (!ark || !ark.Points) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const pointLines = ark.Points.map(
    (p) => `**${p.Name}** ${p.Value}P${p.Description ? ` — ${p.Description}` : ''}`,
  );

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`✨ ${name} — 아크 패시브`)
    .setDescription(pointLines.join('\n'));

  // 노드를 진화/깨달음/도약별로 묶어서 표시
  for (const category of ['진화', '깨달음', '도약']) {
    const nodes = (ark.Effects ?? [])
      .filter((e) => e.Name === category)
      .map((e) => stripTags(e.Description).replace(`${category} `, ''));
    if (nodes.length > 0) {
      embed.addFields({ name: category, value: trunc(nodes.join('\n')), inline: true });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}
