import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getCharacterProfile } from '../lostark.js';
import { EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { characterButtons } from '../buttons.js';

export const data = new SlashCommandBuilder()
  .setName('캐릭터')
  .setDescription('로스트아크 캐릭터 정보를 조회합니다')
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

  const profile = await getCharacterProfile(name);
  if (!profile) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const guild = profile.GuildName
    ? `${profile.GuildName}${profile.GuildMemberGrade ? `
${profile.GuildMemberGrade}` : ''}`
    : '-';
  const town = profile.TownName
    ? `${profile.TownName}${profile.TownLevel ? ` Lv.${profile.TownLevel}` : ''}`
    : '-';

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
      { name: '전투력', value: profile.CombatPower ?? '-', inline: true },
      { name: '길드', value: guild, inline: true },
      { name: '영지', value: town, inline: true },
      { name: '스킬 포인트', value: `${profile.UsingSkillPoint ?? '-'}/${profile.TotalSkillPoint ?? '-'}`, inline: true },
    );

  // 성향(지성·담력·매력·친절)은 있을 때만
  const tendencies = (profile.Tendencies ?? [])
    .map((t) => `${t.Type} ${t.Point}`)
    .join(' · ');
  if (tendencies) embed.addFields({ name: '성향', value: tendencies });

  if (profile.Title) {
    embed.setDescription(profile.Title);
  }

  await interaction.editReply({
    embeds: [embed],
    components: characterButtons(profile.CharacterName, ['정보', '군장', '주급']),
  });
}
