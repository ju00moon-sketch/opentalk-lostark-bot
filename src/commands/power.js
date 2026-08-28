import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getCharacterProfile } from '../lostark.js';
import { EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';

const COMBAT_STATS = ['치명', '특화', '제압', '신속', '인내', '숙련'];

export const data = new SlashCommandBuilder()
  .setName('전투력')
  .setDescription('전투력과 전투 특성')
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

  const stats = new Map((profile.Stats ?? []).map((s) => [s.Type, s.Value]));
  const combatStats = COMBAT_STATS.filter((t) => stats.has(t))
    .map((t) => `${t} **${stats.get(t)}**`)
    .join(' · ');

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`⚡ ${profile.CharacterName} — 전투력 ${profile.CombatPower ?? '-'}`)
    .setThumbnail(profile.CharacterImage ?? null)
    .addFields(
      { name: '아이템 레벨', value: profile.ItemAvgLevel ?? '-', inline: true },
      { name: '공격력', value: Number(stats.get('공격력') ?? 0).toLocaleString('ko-KR'), inline: true },
      { name: '최대 생명력', value: Number(stats.get('최대 생명력') ?? 0).toLocaleString('ko-KR'), inline: true },
    );
  if (combatStats) {
    embed.addFields({ name: '전투 특성', value: combatStats });
  }

  await interaction.editReply({ embeds: [embed] });
}
