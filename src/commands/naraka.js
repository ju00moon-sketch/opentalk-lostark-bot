import { SlashCommandBuilder } from 'discord.js';
import { replyDescent, gradeOption } from '../descent-shared.js';

export const data = new SlashCommandBuilder()
  .setName('나락')
  .setDescription('나락 강하 선택 추천 경로')
  .addStringOption(gradeOption);

export async function execute(interaction) {
  await replyDescent(interaction, '나락');
}
