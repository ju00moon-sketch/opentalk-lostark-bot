import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { guardianForWeek, cardsFor, DATA_DATE } from '../data/guardians.js';
import { EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('가토')
  .setDescription('이번 주 잔영 가디언 토벌 — 속성 취약과 추천 카드');

export async function execute(interaction) {
  const current = guardianForWeek(0);
  const next = guardianForWeek(1);
  const cards = cardsFor(current.element);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`⚔️ 이번 주 잔영 가디언 — ${current.name}`)
    .addFields(
      { name: '속성 취약', value: `**${current.element}속성**`, inline: true },
      { name: '다음 주', value: `${next.name} (${next.element})`, inline: true },
      { name: '🗡️ 딜러 추천 카드', value: cards.dealer },
      { name: '💚 서폿 추천 카드', value: cards.support },
    )
    .setFooter({ text: `수요일 06시 리셋 기준 자동 계산 · ${DATA_DATE}` });

  await interaction.reply({ embeds: [embed] });
}
