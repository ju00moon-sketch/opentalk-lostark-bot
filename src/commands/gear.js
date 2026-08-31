import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmory } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { characterButtons } from '../buttons.js';

export const data = new SlashCommandBuilder()
  .setName('군장')
  .setDescription('장비 · 각인 · 보석 · 카드를 한눈에 보여줍니다')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

// 장비 툴팁(JSON 문자열)에서 품질 값을 찾는다. 실패해도 조용히 넘어간다.
function extractQuality(tooltipJson) {
  try {
    const tooltip = JSON.parse(tooltipJson);
    for (const element of Object.values(tooltip)) {
      const q = element?.value?.qualityValue;
      if (typeof q === 'number' && q >= 0) return q;
    }
  } catch {
    // 툴팁 구조가 바뀌어도 품질만 생략하고 나머지는 표시한다
  }
  return null;
}

const GEAR_TYPES = ['무기', '투구', '상의', '하의', '장갑', '어깨'];

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const armory = await getArmory(name);
  if (!armory || !armory.ArmoryProfile) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const profile = armory.ArmoryProfile;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${profile.CharacterName} — 군장검사`)
    .setThumbnail(profile.CharacterImage ?? null)
    .setDescription(
      `${profile.ServerName} · ${profile.CharacterClassName} · 아이템 레벨 **${profile.ItemAvgLevel}**`,
    );

  // 장비 6부위
  const gear = (armory.ArmoryEquipment ?? []).filter((e) => GEAR_TYPES.includes(e.Type));
  if (gear.length > 0) {
    const lines = gear.map((e) => {
      const quality = extractQuality(e.Tooltip);
      const qualityText = quality === null ? '' : ` · 품질 ${quality}`;
      return `**${e.Type}** ${e.Name} (${e.Grade}${qualityText})`;
    });
    embed.addFields({ name: '⚔️ 장비', value: trunc(lines.join('\n')) });
  }

  // 각인 (아크패시브 시대의 ArkPassiveEffects 우선, 없으면 구 방식 Effects)
  const engraving = armory.ArmoryEngraving;
  const arkEffects = engraving?.ArkPassiveEffects ?? [];
  const oldEffects = engraving?.Effects ?? [];
  if (arkEffects.length > 0) {
    const lines = arkEffects.map((e) => `${e.Grade ?? ''} **${e.Name}** Lv.${e.Level}`.trim());
    embed.addFields({ name: '📜 각인', value: trunc(lines.join('\n')), inline: true });
  } else if (oldEffects.length > 0) {
    const lines = oldEffects.map((e) => e.Name);
    embed.addFields({ name: '📜 각인', value: trunc(lines.join('\n')), inline: true });
  }

  // 보석: "10레벨 겁화의 보석" → 종류/레벨별로 묶어 요약
  const gems = armory.ArmoryGem?.Gems ?? [];
  if (gems.length > 0) {
    const counts = new Map();
    for (const gem of gems) {
      const match = /(\d+)레벨\s+(\S+)의 보석/.exec(gem.Name ?? '');
      const key = match ? `${match[2]} ${match[1]}레벨` : `기타 ${gem.Level}레벨`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const lines = [...counts.entries()].map(([key, n]) => `${key} ×${n}`);
    embed.addFields({ name: '💎 보석', value: trunc(lines.join('\n')), inline: true });
  }

  // 카드: 세트별로 활성화된 마지막 효과 이름만
  const cardEffects = armory.ArmoryCard?.Effects ?? [];
  if (cardEffects.length > 0) {
    const lines = cardEffects
      .map((set) => set.Items?.at(-1)?.Name)
      .filter(Boolean);
    if (lines.length > 0) {
      embed.addFields({ name: '🃏 카드', value: trunc(lines.join('\n')) });
    }
  }

  await interaction.editReply({
    embeds: [embed],
    components: characterButtons(profile.CharacterName, ['정보', '치적', '팔찌']),
  });
}
