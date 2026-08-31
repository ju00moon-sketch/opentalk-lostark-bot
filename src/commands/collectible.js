import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';

export const data = new SlashCommandBuilder()
  .setName('내실')
  .setDescription('수집품 진행도 (모코코 · 섬의 마음 등)')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

const bar = (ratio) => {
  const filled = Math.round(ratio * 10);
  return '▰'.repeat(filled) + '▱'.repeat(10 - filled);
};

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const collectibles = await getArmoryPart(name, 'collectibles');
  if (!collectibles || collectibles.length === 0) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const sorted = [...collectibles].sort((a, b) => b.Point / b.MaxPoint - a.Point / a.MaxPoint);
  const lines = sorted.map((c) => {
    const ratio = c.MaxPoint > 0 ? c.Point / c.MaxPoint : 0;
    return `${bar(ratio)} **${c.Type}** ${c.Point}/${c.MaxPoint} (${Math.floor(ratio * 100)}%)`;
  });

  const totalPoint = collectibles.reduce((sum, c) => sum + c.Point, 0);
  const totalMax = collectibles.reduce((sum, c) => sum + c.MaxPoint, 0);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🌱 ${name} — 내실 (수집품)`)
    .setDescription(trunc(lines.join('\n'), 4096))
    .setFooter({ text: `전체 진행도: ${totalPoint}/${totalMax} (${Math.floor((totalPoint / totalMax) * 100)}%)` });

  await interaction.editReply({ embeds: [embed] });
}
