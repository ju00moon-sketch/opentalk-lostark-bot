import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { stripTags } from '../tooltip.js';

export const data = new SlashCommandBuilder()
  .setName('장착보석')
  .setDescription('캐릭터가 장착한 보석과 스킬별 효과')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

// "10레벨 겁화의 보석 (귀속)" → "10겁화"
function shortGemName(rawName) {
  const match = /(\d+)레벨\s+(\S+)의 보석/.exec(stripTags(rawName));
  return match ? `${match[1]}${match[2]}` : stripTags(rawName);
}

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const gemData = await getArmoryPart(name, 'gems');
  if (!gemData || !gemData.Gems || gemData.Gems.length === 0) {
    await interaction.editReply(`\`${name}\` — 장착한 보석이 없거나 ${NOT_FOUND_HINT}`);
    return;
  }

  const gemBySlot = new Map(gemData.Gems.map((g) => [g.Slot, g]));
  const skillEffects = gemData.Effects?.Skills ?? [];

  const lines = skillEffects.map((effect) => {
    const gem = gemBySlot.get(effect.GemSlot);
    const gemLabel = gem ? shortGemName(gem.Name) : '?';
    const desc = (effect.Description ?? []).map(stripTags).join(', ');
    return `\`${gemLabel}\` **${effect.Name}** — ${desc}`;
  });

  // 스킬 매핑이 없는 보석 (예: 공용 효과)
  const mappedSlots = new Set(skillEffects.map((e) => e.GemSlot));
  const unmapped = gemData.Gems.filter((g) => !mappedSlots.has(g.Slot)).map(
    (g) => `\`${shortGemName(g.Name)}\``,
  );
  if (unmapped.length > 0) {
    lines.push(`기타: ${unmapped.join(' ')}`);
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`💎 ${name} — 장착 보석 (${gemData.Gems.length}개)`)
    .setDescription(trunc(lines.join('\n'), 4096));

  await interaction.editReply({ embeds: [embed] });
}
