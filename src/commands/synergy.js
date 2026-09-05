import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { SYNERGIES, SYNERGY_GROUPS, CLASS_LABELS, TYPE_ALIASES, DATA_DATE } from '../data/synergies.js';
import { trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('시너지')
  .setDescription('직업별 파티 시너지')
  .addStringOption((option) =>
    option.setName('검색').setDescription('직업명 또는 시너지 종류 (예: 블레이드, 방깎, 치적)'),
  );

const shortClass = (cls) => cls.replace(/^[^(]+/, (name) => CLASS_LABELS[name] ?? name);
const EFFECT_LABELS = [
  ['치명타 시 적에게 주는 피해', '치명타 시 적주피'], ['백/헤드 피해', '백헤드'],
  ['받는 피해 감소', '받피감'], ['방어력 감소', '방감'], ['치명타 적중', '치적'],
  ['피해 증가', '피증'], ['공격력 증가', '공증'], ['공격력 감소', '공감'], ['마나 회복', '마나회복'],
];

function overviewLine(synergy) {
  let effects = synergy.synergy;
  for (const [full, short] of EFFECT_LABELS) effects = effects.replaceAll(full, short);
  return `${shortClass(synergy.cls)}: ${effects.replaceAll('%', '').replaceAll(' + ', ', ')}`;
}

export async function execute(interaction) {
  const raw = interaction.options.getString('검색')?.trim();

  if (raw) {
    const keyword = TYPE_ALIASES[raw] ?? raw;
    const matched = SYNERGIES.filter(
      (s) => s.cls.includes(keyword) || shortClass(s.cls).includes(keyword)
        || s.synergy.includes(keyword) || s.skills.includes(keyword) || s.role.includes(keyword),
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

  // 계열별 전체 안내도 검색과 같은 데이터를 사용해 빌드 조건·수치가 어긋나지 않게 한다.
  const groups = SYNERGY_GROUPS.map(([role, label]) => {
    const rows = SYNERGIES.filter((s) => s.role === role).map(overviewLine);
    return `**✤ ${label}**\n${rows.join('\n')}`;
  });
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('❙ 클래스별 시너지 안내 (단위:%)')
    .setDescription(`\n${groups.join('\n\n')}`);

  await interaction.reply({ embeds: [embed] });
}
