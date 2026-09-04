import { SlashCommandBuilder } from 'discord.js';
import { showRanking } from './engraving-rank.js';

export const data = new SlashCommandBuilder()
  .setName('전각')
  .setDescription('가장 비싼 전설 각인서 TOP 10 (전일 대비 포함)')
  .addIntegerOption((option) =>
    option.setName('페이지').setDescription('몇 쪽 (기본 1 · 한 쪽에 10개)').setMinValue(1).setMaxValue(20),
  );

export function execute(interaction) {
  return showRanking(interaction, '전설', interaction.options.getInteger('페이지') ?? 1);
}
