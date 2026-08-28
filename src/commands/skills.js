import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('스킬')
  .setDescription('채용 스킬 · 트라이포드 · 룬')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임').setRequired(true),
  );

export async function execute(interaction) {
  const name = interaction.options.getString('닉네임');
  await interaction.deferReply();

  const skills = await getArmoryPart(name, 'combat-skills');
  if (!skills || skills.length === 0) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  // 레벨을 올렸거나 룬을 꽂은 스킬만 "채용 스킬"로 본다
  const used = skills
    .filter((s) => s.Level > 1 || s.Rune)
    .sort((a, b) => b.Level - a.Level)
    .slice(0, 15);

  if (used.length === 0) {
    await interaction.editReply(`\`${name}\` — 채용한 스킬이 없어요.`);
    return;
  }

  const lines = used.map((s) => {
    const tripods = (s.Tripods ?? [])
      .filter((t) => t.IsSelected)
      .map((t) => t.Name)
      .join(' / ');
    const rune = s.Rune ? ` ⟨${s.Rune.Name}⟩` : '';
    return `**${s.Name}** Lv.${s.Level}${rune}${tripods ? `\n└ ${tripods}` : ''}`;
  });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🗡️ ${name} — 스킬 (${used.length}개)`)
    .setDescription(trunc(lines.join('\n'), 4096));

  await interaction.editReply({ embeds: [embed] });
}
