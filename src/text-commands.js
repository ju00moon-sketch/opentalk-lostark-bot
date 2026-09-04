// 초성 텍스트 커맨드: 채팅에 "ㅂㅂㄱ 4000"처럼 치면 슬래시 커맨드처럼 동작한다.
// 슬래시 인터랙션을 흉내 내는 어댑터로 기존 커맨드 로직을 그대로 재사용한다.

const toInt = (s) => {
  const n = parseInt(String(s ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

const GRADE_MAP = {
  전설: '전설', 영웅: '영웅', 희귀: '희귀',
  '7회': '전설', '6회': '영웅', '5회': '희귀',
  7: '전설', 6: '영웅', 5: '희귀',
};

// parse는 인자 배열을 받아 옵션 객체를 반환한다. null이면 사용법 안내.
export const ALIASES = {
  ㅂㅂㄱ: { cmd: '분배금', usage: 'ㅂㅂㄱ 가격 [인원] (예: ㅂㅂㄱ 4000)', parse: (p) => {
    const 가격 = toInt(p[0]);
    if (가격 === null || 가격 < 1) return null;
    const 인원 = toInt(String(p[1] ?? '').replace('인', ''));
    return [4, 8, 16].includes(인원) ? { 가격, 인원 } : { 가격 };
  } },
  ㅁㅎㅅ: { cmd: '모험섬', parse: () => ({}) },
  ㄱㅌ: { cmd: '가토', parse: (p) => ({ 전체: /전체/.test(p.join(' ')) ? '전체' : null }) },
  ㅈㅇ: { cmd: '지옥', parse: (p) => ({ 등급: GRADE_MAP[p[0]] ?? null }) },
  ㄴㄹ: { cmd: '나락', parse: (p) => ({ 등급: GRADE_MAP[p[0]] ?? null }) },
  ㅅㄴㅈ: { cmd: '시너지', parse: (p) => ({ 검색: p.join(' ') || null }) },
  ㅊㅂ: { cmd: '체방', parse: () => ({}) },
  ㅋㄱ: { cmd: '클골', parse: (p) => ({ 레이드명: p.join(' ') || null }) },
  ㅈㄱ: { cmd: '주급', parse: (p) => ({ 닉네임: p.join(' ') || null }) },
  ㅅㅅ: { cmd: '시세', usage: 'ㅅㅅ 아이템명 (예: ㅅㅅ 운명의 파괴석)', parse: (p) => (p[0] ? { 아이템명: p.join(' ') } : null) },
  ㄱㅇㅅ: { cmd: '각인서', usage: 'ㄱㅇㅅ 각인명 (예: ㄱㅇㅅ 원한)', parse: (p) => (p[0] ? { 각인명: p.join(' ') } : null) },
  ㅂㅅ: { cmd: '보석', usage: 'ㅂㅅ 종류 레벨 (예: ㅂㅅ 겁화 10)', parse: (p) => {
    const 레벨 = toInt(p[1]);
    return p[0] && 레벨 ? { 종류: p[0], 레벨 } : null;
  } },
  ㅅㅋㅋㄷ: { cmd: '스킬코드', parse: (p) => ({ 닉네임: p.join(' ') || null }) },
  ㅇㄱ: { cmd: '유각', parse: () => ({}) },
  ㅈㄱㅇ: { cmd: '전각', parse: () => ({}) },
  ㄷㅈㅂ: { cmd: '딜지분', usage: 'ㄷㅈㅂ 레이드[관문] [피해량] (예: ㄷㅈㅂ 세하1관 2700억)', parse: (p) => (p[0] ? { 레이드: p.join(' ') } : null) },
  ㄷㅋ: { cmd: '딜컷', usage: 'ㄷㅋ 레이드[관문] [분] (예: ㄷㅋ 세하 10)', parse: (p) => (p[0] ? { 레이드: p.join(' ') } : null) },
  ㅋㄹㅌ: { cmd: '캐릭터', parse: (p) => ({ 닉네임: p.join(' ') || null }) },
  ㅈㅂ: { cmd: '정보', parse: (p) => ({ 닉네임: p.join(' ') || null }) },
  ㄷㄹ: { cmd: '등록', parse: (p) => ({ 닉네임: p.join(' ') || null }) },
  ㅊㅈ: { cmd: '치적', parse: (p) => ({ 닉네임: p.join(' ') || null }) },
  ㄹㅍ: { cmd: '로펙', parse: (p) => ({ 닉네임: p.join(' ') || null }) },
  ㅂㅋ: { cmd: '부캐', parse: (p) => ({ 닉네임: p.join(' ') || null }) },
  ㅈㅎㅇ: { cmd: '젬효율', parse: (p) => ({ 닉네임: p.join(' ') || null }) },
  ㄱㅈ: { cmd: '군장', parse: (p) => ({ 닉네임: p.join(' ') || null }) },
  ㄹㅋ: { cmd: '랭킹', parse: () => ({}) },
  ㅊㄱ: { cmd: '체급', parse: () => ({}) },
  ㅇㄷㅇㅌ: { cmd: '업데이트', parse: () => ({}) },
  업뎃: { cmd: '업데이트', parse: () => ({}) },
  시전: { cmd: 'cpm', usage: '.cpm 횟수 시간 [목표] (예: .cpm 35 7분)', parse: (p) => {
    const 횟수 = toInt(p[0]);
    return 횟수 && p[1] ? { 횟수, 시간: p[1], 목표: p[2] ? Number(p[2]) : null } : null;
  } },
  ㄷㅇㅁ: { cmd: '도움말', parse: () => ({}) },
};

// 슬래시 인터랙션 흉내 어댑터
class TextInteraction {
  constructor(message, options) {
    this.message = message;
    this.channelId = message.channelId;
    this.guildId = message.guildId;
    this.guild = message.guild;
    this.channel = message.channel;
    this.user = message.author;
    this.member = message.member; // 서버 닉네임을 캐릭터명으로 쓰는 폴백용
    this.deferred = false;
    this.replied = false;
    this.options = {
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
      getNumber: (name) => options[name] ?? null,
      getBoolean: (name) => options[name] ?? null,
      getChannel: () => null,
      getSubcommand: () => options.__sub,
    };
  }
  async deferReply() {
    this.deferred = true;
    await this.channel.sendTyping().catch(() => {});
  }
  async reply(payload) {
    this.replied = true;
    return this.#send(payload);
  }
  async editReply(payload) {
    return this.#send(payload);
  }
  async #send(payload) {
    const p = typeof payload === 'string' ? { content: payload } : { ...payload };
    delete p.flags; // 텍스트 커맨드에는 에페메랄이 없다
    return this.message.reply(p).catch(() => this.channel.send(p));
  }
}

// 규칙: 초성(ㅂㅂㄱ)은 접두사 없이 바로, 원래 단어(분배금·지옥 등)는 반드시 "." 또는 "!"를
// 붙여야 반응한다 — 일반 대화("지옥 같네")가 오작동하지 않도록.
// ALIASES에 초성이 아닌 축약("업뎃")을 넣을 수도 있는데, 이런 단어형도 접두사를 요구한다.
const WORD_CMDS = new Map(Object.values(ALIASES).map((def) => [def.cmd, def]));
const CHOSUNG_ONLY = /^[ㄱ-ㅎ]+$/;

// 악세 연마 조합 단축어 — ".상상", ".상중 70" 처럼 쓴다.
// ALIASES와 달리 슬래시 커맨드로는 등록하지 않는다 (초성 별칭 없음).
const REFINE_PATTERNS = ['상단일', '중단일', '상상상', '상상중', '상상하', '상상', '상중', '상하', '중중', '중하'];

function matchRefinePattern(token, params) {
  if (!REFINE_PATTERNS.includes(token)) return null;
  const 품질 = toInt(params[0]);
  return { cmd: '악세', options: { 검색: token, 품질: 품질 ?? null } };
}

// ── 슬래시 옵션 정의로 범용 파싱 (별칭이 없는 커맨드용 — 카카오에서 /장비 닉네임 같은 형태)
const OPT = { SUB: 1, SUB_GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5, CHANNEL: 7, NUMBER: 10 };

function usageOf(name, defs) {
  const parts = defs.map((o) => {
    const label = o.choices ? o.choices.map((c) => c.value).join('|') : o.name;
    return o.required ? label : `[${label}]`;
  });
  return `/${name} ${parts.join(' ')}`.trim();
}

// tokens를 옵션 정의 순서대로 채운다. "옵션명:값"으로 특정 옵션을 지정할 수도 있다.
// 마지막에 남은 옵션이 문자열이면 남은 토큰을 통째로 받는다(닉네임·검색어에 띄어쓰기 허용).
export function parseGenericOptions(command, tokens) {
  const json = command.data.toJSON();
  const defs = (json.options ?? []).filter((o) => ![OPT.SUB, OPT.SUB_GROUP, OPT.CHANNEL].includes(o.type));
  if (defs.length === 0) return { options: {} };
  const usage = usageOf(json.name, defs);
  const options = {};
  const rest = [];
  for (const token of tokens) {
    const m = /^([^:]+):(.+)$/.exec(token);
    const def = m && defs.find((o) => o.name === m[1]);
    if (def) options[def.name] = m[2];
    else rest.push(token);
  }
  const unfilled = defs.filter((o) => !(o.name in options));
  unfilled.forEach((def, i) => {
    if (rest.length === 0) return;
    const isLastString = i === unfilled.length - 1 && def.type === OPT.STRING;
    options[def.name] = isLastString ? rest.splice(0).join(' ') : rest.shift();
  });
  for (const def of defs) {
    const raw = options[def.name];
    if (raw === undefined) {
      if (def.required) return { usage };
      options[def.name] = null;
      continue;
    }
    let value = raw;
    if (def.type === OPT.INTEGER) value = toInt(raw);
    else if (def.type === OPT.NUMBER) value = Number(String(raw).replace(/,/g, ''));
    else if (def.type === OPT.BOOLEAN) value = /^(true|1|예|응|on|켜기)$/i.test(raw);
    if (value === null || (typeof value === 'number' && !Number.isFinite(value))) return { usage };
    if (def.choices && !def.choices.some((c) => String(c.value) === String(value))) return { usage };
    options[def.name] = value;
  }
  return { options };
}

// 발화를 (커맨드, 옵션)으로 해석한다. 처리 대상이 아니면 null, 옵션이 부족하면 { command, usage }.
//   prefixes    — 단어형 커맨드(정보·상상)에 요구하는 접두사. 디스코드는 . ! / 카카오는 /
//   bareChosung — 초성 별칭을 접두사 없이 허용할지 (디스코드 true, 카카오 false)
//   anyCommand  — 별칭이 없는 커맨드도 슬래시 옵션 정의로 파싱해 허용할지 (카카오 true)
export function matchTextCommand(content, commandMap, { prefixes = ['.', '!'], bareChosung = true, anyCommand = false } = {}) {
  const parts = content.trim().split(/\s+/);
  const raw = parts[0] ?? '';
  const prefix = prefixes.find((p) => raw.startsWith(p));
  const hasPrefix = prefix !== undefined;
  const token = hasPrefix ? raw.slice(prefix.length) : raw;
  const params = parts.slice(1);
  if (!token) return null;

  // 악세 연마 조합(.상상)은 단어형이라 접두사가 필요하다
  const refine = hasPrefix ? matchRefinePattern(token, params) : null;
  if (refine) {
    const command = commandMap.get(refine.cmd);
    return command ? { command, options: refine.options, label: raw } : null;
  }

  // 초성은 (허용 시) 접두사 유무 무관, 단어형 축약은 접두사 필수
  let alias = null;
  if (ALIASES[token] && ((bareChosung && CHOSUNG_ONLY.test(token)) || hasPrefix)) alias = ALIASES[token];
  if (!alias && hasPrefix && WORD_CMDS.has(token)) alias = WORD_CMDS.get(token); // 원래 커맨드명
  if (alias) {
    const command = commandMap.get(alias.cmd);
    if (!command) return null;
    const options = alias.parse(params);
    if (options === null) return { command, usage: alias.usage, label: raw };
    return { command, options, label: raw };
  }

  // 별칭이 없는 커맨드 — 카카오처럼 모든 커맨드를 /이름 인자 형태로 받을 때만
  if (anyCommand && hasPrefix && commandMap.has(token)) {
    const command = commandMap.get(token);
    const parsed = parseGenericOptions(command, params);
    if (parsed.usage) return { command, usage: parsed.usage, label: raw };
    return { command, options: parsed.options, label: raw };
  }
  return null;
}

// 어댑터를 만들어 커맨드를 실행한다. 항상 true(처리함)를 반환한다.
async function runCommand(command, message, options, label) {
  const fake = new TextInteraction(message, options);
  try {
    await command.execute(fake);
  } catch (err) {
    console.error(`[채팅 ${label}]`, err);
    await message.reply(`오류가 발생했어요: ${err.message}`).catch(() => {});
  }
  return true;
}

// 처리했으면 true를 반환한다.
export async function handleTextCommand(message, commandMap) {
  const match = matchTextCommand(message.content, commandMap);
  if (!match) return false;
  if (match.usage) {
    await message.reply(`사용법: \`${match.usage}\``).catch(() => {});
    return true;
  }
  return runCommand(match.command, message, match.options, match.label);
}
