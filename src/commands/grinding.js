import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { EMBED_COLOR } from '../format.js';

// 악세서리 연마 효과 수치표 (하/중/상). 패치로 바뀌면 여기만 수정.
const TABLE = {
  '🔗 공용': [
    ['최대 생명력', '1,300', '3,250', '6,500'],
    ['공격력', '80', '195', '390'],
    ['무기공격력', '195', '480', '960'],
    ['최대 마나', '6', '15', '30'],
    ['상태이상 공격 지속시간', '0.20%', '0.50%', '1.00%'],
    ['전투 중 생명력 회복량', '10', '25', '50'],
  ],
  '📿 목걸이': [
    ['적에게 주는 피해', '0.55%', '1.20%', '2.00%'],
    ['추가 피해', '0.70%', '1.60%', '2.60%'],
    ['세레나데·신앙·조화 게이지 획득량', '1.60%', '3.60%', '6.00%'],
    ['낙인력', '2.15%', '4.80%', '8.00%'],
  ],
  '💧 귀걸이': [
    ['공격력', '0.40%', '0.95%', '1.55%'],
    ['무기공격력', '0.80%', '1.80%', '3.00%'],
    ['파티원 회복 효과', '0.95%', '2.10%', '3.50%'],
    ['파티원 보호막 효과', '0.95%', '2.10%', '3.50%'],
  ],
  '💍 반지': [
    ['아군 공격력 강화', '1.35%', '3.00%', '5.00%'],
    ['아군 피해량 강화', '2.00%', '4.50%', '7.50%'],
    ['치명타 적중률', '0.40%', '0.95%', '1.55%'],
    ['치명타 피해', '1.10%', '2.40%', '4.00%'],
  ],
};

export const data = new SlashCommandBuilder()
  .setName('연마표')
  .setDescription('악세서리 연마 효과 수치표 (하/중/상)');

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('⚒️ 악세서리 연마 효과 수치표')
    .setDescription('각 옵션의 **하 · 중 · 상** 수치예요.');

  for (const [category, rows] of Object.entries(TABLE)) {
    const lines = rows.map(([name, low, mid, high]) => `**${name}** — ${low} · ${mid} · **${high}**`);
    embed.addFields({ name: category, value: lines.join('\n') });
  }

  await interaction.reply({ embeds: [embed] });
}
