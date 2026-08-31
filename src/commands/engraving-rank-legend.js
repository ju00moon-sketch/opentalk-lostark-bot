import { SlashCommandBuilder } from 'discord.js';
import { showRanking } from './engraving-rank.js';

export const data = new SlashCommandBuilder()
  .setName('전각')
  .setDescription('가장 비싼 전설 각인서 TOP 10');

export function execute(interaction) {
  return showRanking(interaction, '전설');
}
