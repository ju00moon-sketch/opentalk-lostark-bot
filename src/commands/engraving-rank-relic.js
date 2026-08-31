import { SlashCommandBuilder } from 'discord.js';
import { showRanking } from './engraving-rank.js';

export const data = new SlashCommandBuilder()
  .setName('유각')
  .setDescription('가장 비싼 유물 각인서 TOP 10');

export function execute(interaction) {
  return showRanking(interaction, '유물');
}
