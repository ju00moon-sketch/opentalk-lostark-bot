import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getFullArmory } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { parseTooltip, findPartBox, parseBracelet, stripTags } from '../tooltip.js';
import { findIdentityCrits } from '../data/identity-crit.js';

export const data = new SlashCommandBuilder()
  .setName('치적')
  .setDescription('치명타 적중률을 출처별로 합산합니다')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

// "치명타 적중률 +1.55%", "치명타 적중률이 추가로 20.00% 증가"를 잡는다. "치명타 발생 확률"도 같은 뜻으로 보되,
// "치명타 발생 확률 1.0%당 피해량이 …"(발키리 성검 개방·브레이커 치명적인 주먹)처럼 치적을 피해로 바꾸는 환산 효과는 "%당"이라 뺀다.
const CRIT = /치명타 (?:적중률|발생 확률)[이가]?\s*(?:추가로\s*)?\+?\s*([\d.]+)\s*%(?!당)/g;
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
// 기습의 대가(백어택 빌드)를 낀 캐릭터에만 더한다 — 프론트·헤드 빌드는 백어택을 노리지 않으니 (사용자 요청 2026-09-04).
const BACK_ATTACK_CRIT = 10;
const BACK_ATTACK_ENGRAVING = '기습의 대가';

// "대상이 자신 및 파티원에게 받는 치명타 저항률이 12.0초간 10.0% 감소" (급소 노출 트라이포드) — 사실상 자신·파티 치적 +N%인 시너지.
const CRIT_RESIST = /치명타 저항률[이가]?\s*(?:[\d.]+\s*초간\s*)?([\d.]+)\s*%\s*감소/g;
// "기본 이동 속도 증가량 %의 30.0% 만큼 치명타 적중률이 증가" (기상술사 기민함) — 이속 증가량은 전투 중 상한 40%로 본다.
const DERIVED_CRIT = /(이동 속도|공격 속도) 증가량\s*%의\s*([\d.]+)\s*%\s*만큼 치명타 적중률/g;
const MOVE_SPEED_CAP = 40;

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
// 파생형("이속 증가량의 30% 만큼")은 합계에 못 넣으니 derived로 따로 돌려준다.
function fromArkPassive(ark) {
  const found = [];
  const derived = [];
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
    for (const m of text.matchAll(DERIVED_CRIT)) {
      const ratio = Number(m[2]);
      derived.push({
        detail: `${nodeName} (${m[1] === '이동 속도' ? '이속' : '공속'} ${MOVE_SPEED_CAP}% × ${ratio}%)`,
        value: MOVE_SPEED_CAP * ratio / 100,
      });
    }
  }
  return { found, derived };
}

// 채용한 스킬 본문·트라이포드에서 두 가지를 모은다 — 해당 스킬에만 붙는 값이라 합계에 넣지 않는다.
//   clauses : 스킬 자체 치적("급소 타격", 창술사 청룡진 연가공법 같은 자버프) — 중첩·지속시간이 얽혀 수치 대신 구절을 그대로
//   synergy : "급소 노출"처럼 대상의 치명타 저항률을 낮추는 것 — 자신·파티 치적 +N%인 시너지라 수치로
// 스킬 본문은 툴팁의 설명 상자(MultiTextBox)만 본다 — 같은 툴팁 안의 트라이포드 목록(TripodSkillCustom)은 안 고른 것까지 들어 있어서.
const SKILL_TEXT_TYPES = new Set(['MultiTextBox', 'SingleTextBox']);

function fromSkills(skills) {
  const clauses = [];
  const synergy = [];
  const scan = (label, text) => {
    for (const m of text.matchAll(CRIT_RESIST)) synergy.push({ detail: label, value: Number(m[1]) });
    const index = text.search(/치명타 (?:적중률|발생 확률)/);
    if (index !== -1) clauses.push({ detail: label, clause: clauseAt(text, index) });
  };
  for (const skill of skills ?? []) {
    if ((skill.Level ?? 1) <= 1) continue; // 배우지 않은 스킬은 건너뛴다
    const body = Object.values(parseTooltip(skill.Tooltip))
      .filter((v) => SKILL_TEXT_TYPES.has(v?.type) && typeof v.value === 'string')
      .map((v) => stripTags(v.value))
      .join(' ')
      .replace(/\s+/g, ' ');
    scan(skill.Name, body);
    for (const tripod of skill.Tripods ?? []) {
      if (!tripod.IsSelected) continue;
      scan(`${skill.Name} · ${tripod.Name}`, stripTags(tripod.Tooltip).replace(/\s+/g, ' '));
    }
  }
  return { clauses, synergy };
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

  const ark = fromArkPassive(armory.ArkPassive);
  const all = [
    ...fromEquipment(armory.ArmoryEquipment),
    ...fromEngravings(armory.ArmoryEngraving),
    ...ark.found,
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
  // 백어택은 기습의 대가를 낀 캐릭터(백어택 빌드)에만 더한다.
  const backAttack = (armory.ArmoryEngraving?.ArkPassiveEffects ?? [])
    .some((e) => e.Name === BACK_ATTACK_ENGRAVING && e.Level > 0);
  if (backAttack) rows.push({ label: '백 어택', value: BACK_ATTACK_CRIT });

  const total = rows.reduce((sum, r) => sum + r.value, 0);
  const lines = [
    `**총합: ${pct(total)}**`,
    '',
    ...rows.map((r) => `• ${trunc(r.label, 60)}: ${pct(r.value)}`),
  ];

  // 아이덴티티(Z키) 치적은 API에 없어서 직업별 표에서 가져온다.
  // 같은 노드의 툴팁에서 이미 수치를 읽었다면(패치로 툴팁에 실린 경우) 표 항목은 빼서 두 번 세지 않는다.
  const nodeNames = (armory.ArkPassive?.Effects ?? []).map((e) => stripTags(e.Description));
  const parsedNodes = new Set(ark.found.map((h) => h.detail.replace(/\s*Lv\.\d+$/, '')));
  const identities = findIdentityCrits(armory.ArmoryProfile.CharacterClassName, nodeNames)
    .filter((i) => !i.node || ![...parsedNodes].some((n) => n.includes(i.node)));
  const skills = fromSkills(armory.ArmorySkills);

  const extraLines = [
    ...identities.map((i) => ` •${i.label}: ${pct(i.crit)}`),
    ...ark.derived.map((d) => ` •${d.detail}: ${pct(d.value)}`),
    ...skills.synergy.map((s) => ` •${s.detail} (치적 시너지): ${pct(s.value)}`),
    ...extras.map((h) => ` •${h.detail}: ${trunc(h.clause, 60)}`),
    ...skills.clauses.map((h) => ` •${h.detail}: ${trunc(h.clause, 60)}`),
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
    .setFooter({ text: `백 어택 +10%는 기습의 대가 착용 시만 합산${backAttack ? '' : ' (미착용)'} · 파티 시너지·물약은 제외` });

  await interaction.editReply({ embeds: [embed] });
}
