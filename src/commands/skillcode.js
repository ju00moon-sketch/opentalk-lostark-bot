import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { createHash } from 'node:crypto';
import { getFullArmory } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { stripTags } from '../tooltip.js';

export const data = new SlashCommandBuilder()
  .setName('스킬코드')
  .setDescription('캐릭터의 빌드 요약과 빌드 코드 (각인·스킬·보석·아크패시브)')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임').setRequired(true),
  );

// 보석 짧은 표기: 효과 설명으로 겁(피해)/작(재사용) 계열을 구분한다
function shortGem(gem, effectDesc) {
  const level = gem.Level;
  const isCooldown = /재사용|쿨/.test(effectDesc);
  const base = stripTags(gem.Name).includes('광휘') ? '광' : '';
  return `${level}${base}${isCooldown ? '작' : '겁'}`;
}

export async function execute(interaction) {
  const name = interaction.options.getString('닉네임');
  await interaction.deferReply();

  const armory = await getFullArmory(name);
  if (!armory || !armory.ArmoryProfile) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const profile = armory.ArmoryProfile;

  // 각인
  const engravings = (armory.ArmoryEngraving?.ArkPassiveEffects ?? []).map((e) => {
    const stone = e.AbilityStoneLevel ? `+${e.AbilityStoneLevel}` : '';
    return `${e.Name}(${e.Level}${stone})`;
  });

  // 스킬 (레벨을 올렸거나 룬을 꽂은 것)
  const skills = (armory.ArmorySkills ?? []).filter((s) => s.Level > 1 || s.Rune);
  const skillLines = skills.map((s) => {
    const rune = s.Rune ? `[${s.Rune.Grade}·${s.Rune.Name}]` : '[　]';
    return `${rune} Lv.${s.Level} ${s.Name}`;
  });

  // 보석
  const gems = armory.ArmoryGem?.Gems ?? [];
  const gemBySlot = new Map(gems.map((g) => [g.Slot, g]));
  const gemEffects = armory.ArmoryGem?.Effects?.Skills ?? [];
  const gemLines = gemEffects.map((eff) => {
    const gem = gemBySlot.get(eff.GemSlot);
    const desc = (eff.Description ?? []).map(stripTags).join(', ');
    const pct = /([\d.]+)%/.exec(desc)?.[1];
    return `${gem ? shortGem(gem, desc) : '?'} | ${eff.Name}${pct ? `(${Math.round(pct)}%)` : ''}`;
  });
  const avgLevel = gems.length
    ? (gems.reduce((sum, g) => sum + g.Level, 0) / gems.length).toFixed(1)
    : '0';

  // 아크패시브
  const arkSections = [];
  for (const point of armory.ArkPassive?.Points ?? []) {
    const nodes = (armory.ArkPassive?.Effects ?? [])
      .filter((e) => e.Name === point.Name)
      .map((e) => {
        const m = /(\d+)티어\s+(.+?)\s+Lv\.(\d+)/.exec(stripTags(e.Description));
        return m ? `[${m[1]}티어] ${m[2]} Lv.${m[3]}` : stripTags(e.Description);
      });
    arkSections.push({ label: `${point.Name} ${point.Value}${point.Description ? ` · ${point.Description}` : ''}`, nodes });
  }

  // 빌드 코드: 빌드 구성 요소의 SHA-512 지문 — 같은 빌드면 항상 같은 코드
  const fingerprintSource = JSON.stringify({
    engravings,
    skills: skills.map((s) => [s.Name, s.Level, s.Rune?.Name ?? null, (s.Tripods ?? []).filter((t) => t.IsSelected).map((t) => t.Name)]),
    gems: gemLines,
    ark: arkSections,
  });
  const code = createHash('sha512').update(fingerprintSource).digest('hex').toUpperCase();

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🧬 ${profile.CharacterName} — 스킬 코드`)
    .setDescription(`직업: **${profile.CharacterClassName}**\n\`\`\`${code}\`\`\``)
    .addFields(
      { name: '📜 각인', value: trunc(engravings.join(' ') || '-') },
      {
        name: `🗡️ 스킬 (${profile.UsingSkillPoint ?? '-'}/${profile.TotalSkillPoint ?? '-'})`,
        value: trunc(skillLines.join('\n') || '-'),
      },
      { name: `💎 보석 (${gems.length}개 · 평균 Lv.${avgLevel})`, value: trunc(gemLines.join('\n') || '-') },
    );
  for (const section of arkSections) {
    embed.addFields({ name: `✨ ${section.label}`, value: trunc(section.nodes.join('\n') || '-'), inline: true });
  }
  embed.setFooter({ text: '빌드 코드는 포근해챗봇 지문 — 각인·스킬·트포·보석·앜패가 같으면 같은 코드예요' });

  await interaction.editReply({ embeds: [embed] });
}
