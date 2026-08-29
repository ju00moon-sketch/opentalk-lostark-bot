import { SlashCommandBuilder } from 'discord.js';
import { renderGuardian } from './guardian.js';

export const data = new SlashCommandBuilder()
  .setName('가토전체')
  .setDescription('전체 가디언 토벌의 속성 취약과 추천 카드 표');

export async function execute(interaction) {
  await renderGuardian(interaction, true);
}
