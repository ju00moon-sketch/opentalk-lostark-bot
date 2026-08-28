import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getCharacterProfile } from '../lostark.js';
import { EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('캐릭터')
  .setDescription('로스트아크 캐릭터 정보를 조회합니다')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임').setRequired(true),
  );

export async function execute(interaction) {
  const name = interaction.options.getString('닉네임');
  await interaction.deferReply();

  const profile = await getCharacterProfile(name);
  if (!profile) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(profile.CharacterName)
    .setThumbnail(profile.CharacterImage ?? null)
    .addFields(
      { name: '서버', value: profile.ServerName ?? '-', inline: true },
      { name: '직업', value: profile.CharacterClassName ?? '-', inline: true },
      { name: '아이템 레벨', value: profile.ItemAvgLevel ?? '-', inline: true },
      { name: '전투 레벨', value: String(profile.CharacterLevel ?? '-'), inline: true },
      { name: '원정대 레벨', value: String(profile.ExpeditionLevel ?? '-'), inline: true },
      { name: '길드', value: profile.GuildName ?? '-', inline: true },
    );
  if (profile.Title) {
    embed.setDescription(profile.Title);
  }

  await interaction.editReply({ embeds: [embed] });
}
