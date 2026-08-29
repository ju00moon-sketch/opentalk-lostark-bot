import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { SYNERGIES, TYPE_ALIASES, DATA_DATE } from '../data/synergies.js';
import { trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('시너지')
  .setDescription('직업별 파티 시너지')
  .addStringOption((option) =>
    option.setName('검색').setDescription('직업명 또는 시너지 종류 (예: 블레이드, 방깎, 치적)'),
  );

export async function execute(interaction) {
  const raw = interaction.options.getString('검색');

  if (raw) {
    const keyword = TYPE_ALIASES[raw] ?? raw;
    const matched = SYNERGIES.filter(
      (s) => s.cls.includes(keyword) || s.synergy.includes(keyword),
    );
    if (matched.length === 0) {
      await interaction.reply(`\`${raw}\` — 해당하는 직업이나 시너지를 찾지 못했어요.`);
      return;
    }
    const lines = matched.map((s) => `**${s.cls}** — ${s.synergy}\n└ ${s.skills}`);
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`🤝 시너지 검색 — "${raw}" (${matched.length}개)`)
      .setDescription(trunc(lines.join('\n'), 4096))
      .setFooter({ text: `${DATA_DATE} 기준` });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  // 전체: 시너지 종류별로 묶어서 요약
  const groups = [
    ['방어력 감소', '🛡️ 방깎'],
    ['치명타 적중', '🎯 치적'],
    ['치명타 피해', '💥 치피증'],
    ['피해 증가', '⚔️ 피증'],
    ['공격력 증가', '💪 공증'],
    ['서포터', '💚 서포터'],
  ];
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('🤝 직업별 파티 시너지')
    .setFooter({ text: `${DATA_DATE} 기준 · 상세는 /시너지 직업명` });
  for (const [type, label] of groups) {
    const classes = SYNERGIES.filter((s) => s.synergy.includes(type)).map((s) => s.cls);
    if (classes.length > 0) {
      embed.addFields({ name: label, value: trunc(classes.join(' · ')), inline: true });
    }
  }

  await interaction.reply({ embeds: [embed] });
}
