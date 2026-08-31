import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { DATA_DATE } from '../data/raidhp.js';
import {
  resolveRaid, parseArgs, computeGate, damageText, dpsText, timeText, shortName,
} from '../dealshare.js';
import { trunc, EMBED_COLOR, padDisplay } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('딜지분')
  .setDescription('레이드 관문별 딜지분 컷과 내 기여도 판정')
  .addStringOption((option) =>
    option.setName('레이드').setDescription('예: 세나, 벨나, 성당3단계').setRequired(true),
  )
  .addIntegerOption((option) =>
    option.setName('관문').setDescription('비우면 전체 관문').setMinValue(1).setMaxValue(3),
  )
  .addStringOption((option) =>
    option.setName('피해량').setDescription('예: 2700억, 1조2000억 (단위 없으면 억)'),
  )
  .addStringOption((option) =>
    option.setName('시간').setDescription('DPS 기준 시간 — 예: 10, 10:00 (비우면 관문 제한시간)'),
  );

const RAID_NOT_FOUND =
  '레이드를 찾지 못했어요. 지원: `4막` `종막` `세르카` `성당` `벨가르딘` (예: `세나`, `벨하`, `성당3단계`)';
const UNSUPPORTED_MSG =
  '1~3막은 아직 보스 체력 데이터가 없어요. 현재 지원: `4막` `종막` `세르카` `성당` `벨가르딘`';

// 슬래시 옵션과 채팅 인자를 같은 형태로 맞춘다.
function readInput(interaction, mode) {
  const raid = interaction.options.getString('레이드');
  const rest = [
    interaction.options.getInteger?.('관문') ?? null,
    interaction.options.getString('피해량'),
    interaction.options.getString('시간'),
  ].filter((v) => v != null && v !== '');
  // 관문은 정수 옵션이므로 "N관"으로 바꿔 파서가 관문으로 읽게 한다
  const tokens = [raid, ...rest.map((v, i) => (i === 0 && typeof v === 'number' ? `${v}관` : String(v)))];
  return parseArgs(tokens, mode);
}

function gateField(entry, gate, parsed) {
  const r = computeGate(entry, gate, parsed.damage, parsed.seconds);
  const lines = [];

  if (r.ratio != null) {
    lines.push(
      `내 딜 **${damageText(parsed.damage)}** / ${damageText(r.total)}`,
      `딜지분 **${(r.ratio * 100).toFixed(1)}%** · ${dpsText(r.dps)} (${timeText(r.time)} 기준)`,
      `예상 칭호 **${r.title}**`,
      '',
    );
  } else {
    const basis = r.time === gate.time ? '' : ` · DPS 기준 ${timeText(r.time)}`;
    lines.push(`체력 ${damageText(gate.hp)} · 제한 ${timeText(gate.time)}${basis}`);
    if (gate.tactic > 0) lines.push(`택틱 제외 실딜 **${damageText(r.total)}**`);
    lines.push('');
  }

  for (const cut of r.cuts) {
    const label = padDisplay(`${cut.short} ${(cut.ratio * 100).toFixed(1)}%`, 12);
    const base = `\`${label}\` ${damageText(cut.need)} · ${dpsText(cut.dps)}`;
    if (r.ratio == null) {
      lines.push(base);
      continue;
    }
    const diff = parsed.damage - cut.need;
    const mark = diff >= 0 ? '✅' : '❌';
    lines.push(`${mark} ${base} (${diff >= 0 ? '+' : '-'}${damageText(Math.abs(diff))})`);
  }

  return {
    name: `${gate.gate}관문 · ${gate.boss}`,
    value: trunc(lines.join('\n')),
  };
}

export async function run(interaction, mode) {
  const parsed = readInput(interaction, mode);
  const resolved = resolveRaid(parsed.raid);

  if (!resolved) {
    await interaction.reply(`\`${parsed.raid || '(없음)'}\` — ${RAID_NOT_FOUND}`);
    return;
  }
  if (resolved.unsupported) {
    await interaction.reply(UNSUPPORTED_MSG);
    return;
  }

  // 난이도까지 특정되지 않았으면 난이도 목록을 먼저 보여 준다
  if (!resolved.exact && resolved.entries.length > 1) {
    const entry = resolved.entries[0];
    const lines = resolved.entries.map((e) => {
      const gates = e.gates
        .map((g) => `${g.gate}관 ${damageText(g.hp - g.tactic)}`)
        .join(' · ');
      return `**${e.diff}** ${gates}`;
    });
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`🗡️ ${entry.full} — 난이도별 실딜량`)
      .setDescription(
        `${lines.join('\n')}\n\n난이도까지 붙여서 다시 불러 주세요. 예: \`${shortName(resolved.entries.at(-1))}\``,
      )
      .setFooter({ text: `${DATA_DATE} 기준 · 택틱 제외 실딜량` });
    await interaction.reply({ embeds: [embed] });
    return;
  }

  const entry = resolved.entries[0];
  const gates = parsed.gate == null
    ? entry.gates
    : entry.gates.filter((g) => g.gate === parsed.gate);
  if (gates.length === 0) {
    await interaction.reply(`\`${entry.key}\`는 ${entry.gates.length}관문까지 있어요.`);
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(
      `🗡️ ${entry.full} ${entry.diff} — ${parsed.damage == null ? '딜컷' : '딜지분'} (${entry.players}인)`,
    )
    .addFields(gates.map((g) => gateField(entry, g, parsed)));

  const notes = [`${DATA_DATE} 기준`, '딜러 기준 · 국룰 택틱 반영'];
  if (parsed.damage == null) notes.push('피해량을 넣으면 판정까지 나와요');
  embed.setFooter({ text: notes.join(' · ') });

  await interaction.reply({ embeds: [embed] });
}

export function execute(interaction) {
  return run(interaction, 'share');
}
