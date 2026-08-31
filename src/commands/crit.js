import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getFullArmory } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { parseTooltip, findPartBox, parseBracelet, stripTags } from '../tooltip.js';
import { findIdentityCrit } from '../data/identity-crit.js';

export const data = new SlashCommandBuilder()
  .setName('치적')
  .setDescription('치명타 적중률을 출처별로 합산합니다')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

// "치명타 적중률 +1.55%", "치명타 적중률이 추가로 20.00% 증가" 를 모두 잡는다.
const CRIT = /치명타 적중률[이가]?\s*(?:추가로\s*)?\+?\s*([\d.]+)\s*%/g;
// "치명타 적중률이 100%로 적용된다"(선수필승)처럼 더하는 게 아니라 값을 대체하는 표현.
const REPLACEMENT = /^\s*(?:으?로)\s*적용/;

// 치적을 언급한 구절만 잘라 낸다 — 수치 하나로 줄이기 어려운 효과는 문장을 그대로 보여준다.
// 소수점(20.00%)에서 끊기지 않도록 숫자 사이의 마침표는 문장 끝으로 보지 않는다.
function clauseAt(text, index) {
  const rest = text.slice(index);
  const end = rest.search(/,|(?<!\d)\.|\.(?!\d)|하고|하며/);
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

// 중첩마다 쌓이는 효과("치명타 적중률 +1.4% … 최대 5중첩")는 풀스택 기준으로 합산한다.
// 반면 "최대 중첩 도달 시 20% 증가"처럼 이미 최대치를 적어 둔 건 중첩 표기가
// 치적 앞에 오므로 그대로 쓴다.
const PER_STACK = /최대\s*(\d+)\s*중첩/;

// 한 덩어리의 설명에서 치적을 뽑는다. [{ value, additive, stacks, clause }]
function readCrit(text) {
  const source = String(text ?? '');
  const out = [];
  for (const m of source.matchAll(CRIT)) {
    const after = source.slice(m.index + m[0].length);
    const stacks = Number(PER_STACK.exec(after)?.[1] ?? 1);
    out.push({
      value: Number(m[1]),
      additive: !REPLACEMENT.test(after),
      stacks,
      clause: clauseAt(source, m.index),
    });
  }
  return out;
}

// 백어택 성공 시 치명타 적중률 10% 증가 — 장비와 무관한 게임 기본 수치.
const BACK_ATTACK_CRIT = 10;

const ACC_TYPES = ['목걸이', '귀걸이', '반지'];

// 장비(악세 연마 · 팔찌 옵션)에서 치적을 모은다.
function fromEquipment(equipment) {
  const found = [];
  for (const item of equipment ?? []) {
    const tooltip = parseTooltip(item.Tooltip);
    let lines = [];
    if (ACC_TYPES.includes(item.Type)) {
      lines = findPartBox(tooltip, '연마 효과') ?? [];
    } else if (item.Type === '팔찌') {
      const { stats, effects } = parseBracelet(tooltip);
      lines = [...stats.map((s) => `${s.name} ${s.value}`), ...effects];
    } else {
      continue;
    }
    for (const line of lines) {
      for (const hit of readCrit(line)) {
        found.push({ source: item.Type, detail: line, ...hit });
      }
    }
  }
  return found;
}

// 각인 효과에서 치적을 모은다 (아드레날린 등). Lv.0은 효과가 없으므로 건너뛴다.
function fromEngravings(engraving) {
  const found = [];
  for (const e of engraving?.ArkPassiveEffects ?? []) {
    if (!e.Level) continue;
    const text = stripTags(e.Description);
    for (const hit of readCrit(text)) {
      found.push({ source: '각인', detail: `${e.Name} Lv.${e.Level}`, ...hit });
    }
  }
  return found;
}

// 아크 패시브 노드에서 치적을 모은다. 출처는 계열(진화·깨달음·도약)로 묶는다.
function fromArkPassive(ark) {
  const found = [];
  for (const e of ark?.Effects ?? []) {
    const tooltip = parseTooltip(e.ToolTip);
    const text = Object.values(tooltip)
      .filter((v) => v?.type === 'MultiTextBox')
      .map((v) => stripTags(v.value).replace(/\|/g, ' '))
      .join(' ');
    const description = stripTags(e.Description);
    const category = /^(진화|깨달음|도약)/.exec(description)?.[1] ?? '아크패시브';
    const nodeName = description.replace(/^(진화|깨달음|도약)\s*\d*티어\s*/, '');
    for (const hit of readCrit(text)) {
      found.push({ source: category, detail: nodeName, ...hit });
    }
  }
  return found;
}

// 채용한 트라이포드 중 치적이 붙은 것 — 해당 스킬에만 붙는 값이라 합계에 넣지 않는다.
// 중첩·지속시간이 얽힌 표현이 많아 수치 대신 구절을 그대로 보여 준다.
function fromSkills(skills) {
  const found = [];
  for (const skill of skills ?? []) {
    for (const tripod of skill.Tripods ?? []) {
      if (!tripod.IsSelected) continue;
      const text = stripTags(tripod.Tooltip).replace(/\s+/g, ' ');
      const index = text.indexOf('치명타 적중률');
      if (index === -1) continue;
      found.push({ detail: `${skill.Name} · ${tripod.Name}`, clause: clauseAt(text, index) });
    }
  }
  return found;
}

const pct = (n) => `${n.toFixed(2)}%`;

// 같은 부위에서 여러 줄이 나오면 한 줄로 합친다 (반지 두 개 등).
const MERGED_SOURCES = new Set(['목걸이', '귀걸이', '반지', '팔찌']);

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const armory = await getFullArmory(name);
  if (!armory?.ArmoryProfile) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  // 치명 특성이 주는 치적은 API 툴팁에 이미 환산돼 있다.
  const critStat = (armory.ArmoryProfile.Stats ?? []).find((s) => s.Type === '치명');
  const statMatch = /치명타 적중률이 <font[^>]*>([\d.]+)%/.exec(String(critStat?.Tooltip ?? ''));
  const statCrit = statMatch ? Number(statMatch[1]) : 0;

  const all = [
    ...fromEquipment(armory.ArmoryEquipment),
    ...fromEngravings(armory.ArmoryEngraving),
    ...fromArkPassive(armory.ArkPassive),
  ];
  // 값을 대체하는 표현(선수필승)만 합계에서 빼고, 중첩형은 풀스택으로 환산해 더한다.
  const counted = all.filter((h) => h.additive);
  const extras = all.filter((h) => !h.additive);

  // 부위별 옵션(반지 두 개 등)은 한 줄로 합치고, 각인·노드는 이름을 그대로 남긴다.
  const rows = [{ label: `스탯 (치명 ${critStat?.Value ?? '-'})`, value: statCrit }];
  const mergedIndex = new Map();
  for (const hit of counted) {
    const value = hit.value * hit.stacks;
    if (MERGED_SOURCES.has(hit.source)) {
      const found = mergedIndex.get(hit.source);
      if (found) {
        found.value += value;
        continue;
      }
      const row = { label: hit.source, value };
      mergedIndex.set(hit.source, row);
      rows.push(row);
      continue;
    }
    // 풀스택 환산이면 어떻게 나온 값인지 같이 적는다
    const suffix = hit.stacks > 1 ? ` (${hit.value}% ×${hit.stacks}중첩)` : '';
    rows.push({ label: `${hit.source} ${hit.detail}${suffix}`, value });
  }
  rows.push({ label: '백 어택', value: BACK_ATTACK_CRIT });

  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const lines = [
    `**총합: ${pct(total)}**`,
    '',
    ...rows.map((r) => `• ${trunc(r.label, 60)}: ${pct(r.value)}`),
  ];

  // 아이덴티티(Z키) 치적은 API에 없어서 직업별 표에서 가져온다.
  const nodeNames = (armory.ArkPassive?.Effects ?? []).map((e) => stripTags(e.Description));
  const identity = findIdentityCrit(armory.ArmoryProfile.CharacterClassName, nodeNames);

  const extraLines = [
    ...(identity ? [` •${identity.label}: ${pct(identity.crit)}`] : []),
    ...extras.map((h) => ` •${h.detail}: ${trunc(h.clause, 60)}`),
    ...fromSkills(armory.ArmorySkills).map((h) => ` •${h.detail}: ${trunc(h.clause, 60)}`),
  ];
  if (extraLines.length > 0) {
    lines.push('', ' ※ 추가 치명타 확률 (위에 합산되지 않음)', ...extraLines);
  }

  const profile = armory.ArmoryProfile;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`❙ ${profile.CharacterName}님의 치적 정보`)
    .setThumbnail(profile.CharacterImage ?? null)
    .setDescription(
      `${profile.CharacterClassName} (${profile.ItemAvgLevel})\n\n${trunc(lines.join('\n'), 3900)}`,
    )
    .setFooter({ text: '백 어택은 게임 기본 +10% · 파티 시너지·물약은 제외' });

  await interaction.editReply({ embeds: [embed] });
}
