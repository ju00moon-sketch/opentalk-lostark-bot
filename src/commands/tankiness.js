import { SlashCommandBuilder, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBED_COLOR } from '../format.js';

// 차트 이미지는 scripts/chembang-chart.html 을 렌더링해 만든다.
// 데이터가 바뀌면 그 HTML의 TIERS를 고치고 다시 캡처해서 이 파일을 교체하면 된다.
const CHART_PATH = join(
  dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'charts', 'chembang.png',
);

export const data = new SlashCommandBuilder()
  .setName('체방')
  .setDescription('직업별 체방(체력×방어력) 계수표');

export async function execute(interaction) {
  if (!existsSync(CHART_PATH)) {
    await interaction.reply('체방 계수표 이미지를 찾지 못했어요. 관리자에게 알려주세요!');
    return;
  }

  const file = new AttachmentBuilder(CHART_PATH, { name: 'chembang.png' });
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('🛡️ 직업별 체방 계수')
    .setImage('attachment://chembang.png')
    .setFooter({ text: '2026-08-29 기준 · 수치가 높을수록 단단해요' });

  await interaction.reply({ embeds: [embed], files: [file] });
}
