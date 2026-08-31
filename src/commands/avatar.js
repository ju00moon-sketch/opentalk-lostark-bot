import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';

export const data = new SlashCommandBuilder()
  .setName('아바타')
  .setDescription('장착 아바타 목록')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const avatars = await getArmoryPart(name, 'avatars');
  if (avatars === null) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }
  if (avatars.length === 0) {
    await interaction.editReply(`\`${name}\` — 장착한 아바타가 없어요.`);
    return;
  }

  const lines = avatars.map(
    (a) => `**${a.Type}** ${a.Name} · ${a.Grade}${a.IsInner ? ' (덧입기)' : ''}`,
  );

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`👗 ${name} — 아바타`)
    .setDescription(trunc(lines.join('\n'), 4096));

  await interaction.editReply({ embeds: [embed] });
}
