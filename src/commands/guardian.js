import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { guardianForWeek, cardsFor, GUARDIANS, DATA_DATE } from '../data/guardians.js';
import { trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('가토')
  .setDescription('이번 주 잔영 가디언 토벌 — 속성 취약과 추천 카드');

// /가토전체와 채팅 커맨드(ㄱㅌ 전체)가 함께 쓰는 본체
export async function renderGuardian(interaction, showAll) {
  const current = guardianForWeek(0);
  const next = guardianForWeek(1);
  const cards = cardsFor(current.element);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`⚔️ 이번 주 잔영 가디언 — ${current.name}`)
    .addFields(
      { name: '속성 취약', value: `**${current.element}속성**`, inline: true },
      { name: '🗡️ 딜러 추천 카드', value: cards.dealer, inline: true },
      { name: '💚 서폿 추천 카드', value: cards.support, inline: true },
      { name: '다음 주', value: `${next.name} (${next.element}속성)` },
    );
  if (cards.note) {
    embed.addFields({ name: '참고', value: cards.note });
  }

  if (showAll) {
    const lines = GUARDIANS.map((g) => {
      const c = cardsFor(g.element);
      const marker = g.name === current.name ? '▶' : '•';
      return `${marker} **${g.name}** (${g.element}속성${g.element === '무' ? '' : ' 취약'}) — 🗡️ ${c.dealer} / 💚 ${c.support}`;
    });
    embed.addFields({ name: '📋 전체 가디언', value: trunc(lines.join('\n')) });
    embed.addFields({ name: '※ 무속성', value: '취약 보정이 없어 보유 카드 중 각성 높은 세팅 추천' });
  } else {
    embed.setFooter({ text: `전체 가디언 표: /가토전체 또는 "ㄱㅌ 전체" · 수요일 06시 리셋 자동 계산 · ${DATA_DATE}` });
  }

  await interaction.reply({ embeds: [embed] });
}

export async function execute(interaction) {
  await renderGuardian(interaction, interaction.options.getString('전체') != null);
}
