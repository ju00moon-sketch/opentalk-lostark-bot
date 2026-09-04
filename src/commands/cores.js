import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { CLASS_ENGRAVINGS, ENGRAVING_CORES, CHAOS_CORES } from '../data/cores.js';
import { trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('코어')
  .setDescription('아크 그리드 코어 정보 (직업명 · 코어명 · 혼돈)')
  .addStringOption((option) =>
    option
      .setName('검색')
      .setDescription('직업명(블레이드), 각인명(버스트), 코어명(일섬), 혼돈')
      .setRequired(true),
  );

const GROUP_ORDER = ['해', '달', '별'];
const groupLabel = (type, group) => `${type}의 ${group}`;

function coreListEmbed(title, coresByLabel) {
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(title);
  for (const [label, cores] of coresByLabel) {
    if (cores.length === 0) continue;
    embed.addFields({
      name: label,
      value: trunc(cores.map((c) => `\`${c.name}\``).join(' ')),
      inline: true,
    });
  }
  embed.setFooter({ text: '코어 상세: /코어 검색:코어명 · 데이터 daloa.xyz (2026-07-22)' });
  return embed;
}

function groupCores(cores) {
  return GROUP_ORDER.map((g) => [
    groupLabel(cores.find((c) => c.group === g)?.type ?? '질서', g),
    cores.filter((c) => c.group === g),
  ]);
}

function coreDetailEmbed(core, source) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🔮 ${core.name}`)
    .setDescription(`${source} · ${groupLabel(core.type, core.group)} 코어`);
  if (core.p10) embed.addFields({ name: '10P', value: trunc(core.p10) });
  if (core.p14) embed.addFields({ name: '14P', value: trunc(core.p14) });
  if (core.p17) embed.addFields({ name: '17P', value: trunc(core.p17) });
  if (core.p18) {
    const same = core.p18 === core.p19 && core.p19 === core.p20;
    embed.addFields(
      same
        ? { name: '18~20P (단계마다)', value: trunc(core.p18) }
        : { name: '18 / 19 / 20P', value: trunc([core.p18, core.p19, core.p20].join('\n')) },
    );
  }
  return embed;
}

export async function execute(interaction) {
  const raw = interaction.options.getString('검색').trim();

  // 1. 혼돈 전체 목록
  if (raw === '혼돈') {
    await interaction.reply({ embeds: [coreListEmbed('🔮 공용 혼돈 코어', groupCores(CHAOS_CORES))] });
    return;
  }

  // 정확히 같은 이름이 있으면 부분 일치보다 먼저 — "일격"은 일격필살 각인이 아니라 '일격' 코어를 뜻한다.
  const exactCores = [];
  for (const [eng, cores] of Object.entries(ENGRAVING_CORES)) {
    for (const core of cores) if (core.name === raw) exactCores.push([core, eng]);
  }
  for (const core of CHAOS_CORES) if (core.name === raw) exactCores.push([core, '공용']);
  if (exactCores.length > 0 && exactCores.length <= 3) {
    await interaction.reply({ embeds: exactCores.map(([core, src]) => coreDetailEmbed(core, src)) });
    return;
  }

  // 2. 직업명 → 각인 2종의 코어 목록 (정확한 이름 우선, 그다음 부분 일치)
  const classNames = Object.keys(CLASS_ENGRAVINGS);
  const cls = classNames.find((c) => c === raw) ?? classNames.find((c) => c.includes(raw));
  if (cls) {
    const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`🔮 ${cls} — 아크 그리드 코어`);
    for (const eng of CLASS_ENGRAVINGS[cls]) {
      const cores = ENGRAVING_CORES[eng] ?? [];
      const lines = GROUP_ORDER.map((g) => {
        const names = cores.filter((c) => c.group === g).map((c) => `\`${c.name}\``).join(' ');
        return names ? `**${g}** ${names}` : null;
      }).filter(Boolean);
      embed.addFields({ name: `📜 ${eng}`, value: trunc(lines.join('\n')) });
    }
    embed.setFooter({ text: '코어 상세: /코어 검색:코어명 · 데이터 daloa.xyz (2026-07-22)' });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  // 3. 각인명 → 그 각인의 코어 목록 (정확한 이름 우선)
  const engNames = Object.keys(ENGRAVING_CORES);
  const engName = engNames.find((e) => e === raw) ?? engNames.find((e) => e.includes(raw));
  if (engName) {
    await interaction.reply({
      embeds: [coreListEmbed(`🔮 ${engName} — 코어 목록`, groupCores(ENGRAVING_CORES[engName]))],
    });
    return;
  }

  // 4. 코어명 검색 → 상세
  const matches = [];
  for (const [eng, cores] of Object.entries(ENGRAVING_CORES)) {
    for (const core of cores) if (core.name.includes(raw)) matches.push([core, eng]);
  }
  for (const core of CHAOS_CORES) if (core.name.includes(raw)) matches.push([core, '공용']);

  if (matches.length === 0) {
    await interaction.reply(`\`${raw}\` — 직업/각인/코어를 찾지 못했어요. 예: \`/코어 블레이드\`, \`/코어 혼돈\``);
    return;
  }
  if (matches.length > 3) {
    const names = matches.slice(0, 25).map(([c, src]) => `\`${c.name}\`(${src})`).join(' ');
    await interaction.reply(`\`${raw}\` 검색 결과 ${matches.length}개 — 더 구체적으로 검색해 주세요:\n${trunc(names, 1900)}`);
    return;
  }
  await interaction.reply({ embeds: matches.map(([core, src]) => coreDetailEmbed(core, src)) });
}
