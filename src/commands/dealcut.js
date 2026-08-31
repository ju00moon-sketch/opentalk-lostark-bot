import { SlashCommandBuilder } from 'discord.js';
import { run } from './dealshare.js';

export const data = new SlashCommandBuilder()
  .setName('딜컷')
  .setDescription('레이드 관문별 딜컷 — DPS 기준 시간을 바꿔서 조회')
  .addStringOption((option) =>
    option.setName('레이드').setDescription('예: 세하, 벨나, 성당3단계').setRequired(true),
  )
  .addIntegerOption((option) =>
    option.setName('관문').setDescription('비우면 전체 관문').setMinValue(1).setMaxValue(3),
  )
  .addStringOption((option) =>
    option.setName('시간').setDescription('DPS 기준 시간 — 예: 10, 5:30 (비우면 관문 제한시간)'),
  );

// 딜컷은 남은 숫자를 피해량이 아니라 "분"으로 읽는다.
export function execute(interaction) {
  return run(interaction, 'cut');
}
