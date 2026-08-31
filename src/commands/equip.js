import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { parseTooltip, getQuality } from '../tooltip.js';

const MAIN_TYPES = ['무기', '투구', '상의', '하의', '장갑', '어깨'];
const SUB_TYPES = ['완갑', '나침반', '부적', '보주'];

export const data = new SlashCommandBuilder()
  .setName('장비')
  .setDescription('부위별 장비 상세 (재련 · 등급 · 품질)')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

const line = (e, withQuality = true) => {
  const quality = withQuality ? getQuality(parseTooltip(e.Tooltip)) : null;
  return `**${e.Type}** ${e.Name} · ${e.Grade}${quality === null ? '' : ` · 품질 ${quality}`}`;
};

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

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`⚔️ ${name} — 장비`);

  const main = equipment.filter((e) => MAIN_TYPES.includes(e.Type));
  if (main.length > 0) {
    embed.addFields({ name: '전투 장비', value: trunc(main.map((e) => line(e)).join('\n')) });
  }
  const sub = equipment.filter((e) => SUB_TYPES.includes(e.Type));
  if (sub.length > 0) {
    embed.addFields({ name: '보조 장비', value: trunc(sub.map((e) => line(e, false)).join('\n')) });
  }

  await interaction.editReply({ embeds: [embed] });
}
