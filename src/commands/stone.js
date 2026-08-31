import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { parseTooltip, findPartBox, findIndentGroup } from '../tooltip.js';

export const data = new SlashCommandBuilder()
  .setName('스톤')
  .setDescription('어빌리티 스톤 세공 결과')
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

  const equipment = await getArmoryPart(name, 'equipment');
  if (!equipment || equipment.length === 0) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const stone = equipment.find((e) => e.Type === '어빌리티 스톤');
  if (!stone) {
    await interaction.editReply(`\`${name}\` — 장착한 어빌리티 스톤이 없어요.`);
    return;
  }

  const tooltip = parseTooltip(stone.Tooltip);
  const engravings = findIndentGroup(tooltip);
  const base = findPartBox(tooltip, '기본 효과') ?? [];
  const bonus = findPartBox(tooltip, '세공 단계 보너스') ?? [];

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🪨 ${name} — 어빌리티 스톤`)
    .setDescription(`**${stone.Name}** (${stone.Grade})`);
  if (engravings.length > 0) {
    embed.addFields({ name: '세공 각인', value: trunc(engravings.join('\n')) });
  }
  if (base.length > 0 || bonus.length > 0) {
    embed.addFields({ name: '효과', value: trunc([...base, ...bonus].join('\n')) });
  }

  await interaction.editReply({ embeds: [embed] });
}
