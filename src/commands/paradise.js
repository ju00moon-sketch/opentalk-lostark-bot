import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { stripTags } from '../tooltip.js';

export const data = new SlashCommandBuilder()
  .setName('낙원력')
  .setDescription('캐릭터의 낙원력을 조회합니다 (보주 기준)')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임').setRequired(true),
  );

export async function execute(interaction) {
  const name = interaction.options.getString('닉네임');
  await interaction.deferReply();

  const equipment = await getArmoryPart(name, 'equipment');
  if (!equipment || equipment.length === 0) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  // 낙원력은 보주 등 장비 툴팁에 기록된다. "…낙원력 : 12,345,678" 패턴을 전부 수집.
  const findings = [];
  for (const item of equipment) {
    const text = stripTags(item.Tooltip ?? '');
    const matches = [...text.matchAll(/([가-힣0-9\s]*낙원력)\s*:\s*([\d,]+)/g)];
    for (const m of matches) {
      findings.push({ item: `${item.Type} · ${item.Name}`, label: m[1].trim(), value: m[2] });
    }
  }

  if (findings.length === 0) {
    await interaction.editReply(
      `\`${name}\` — 낙원력 정보를 찾지 못했어요. (낙원력이 기록되는 보주를 장착하지 않았을 수 있어요)`,
    );
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🌌 ${name} — 낙원력`)
    .setDescription(
      trunc(findings.map((f) => `**${f.label}** — **${f.value}**\n└ ${f.item}`).join('\n'), 4096),
    );

  await interaction.editReply({ embeds: [embed] });
}
