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
  ㄱㅌ: { cmd: '가토', parse: (p) => ({ 전체: /전체/.test(p[0] ?? '') || null }) },
  ㅈㅇ: { cmd: '지옥', parse: (p) => ({ 등급: GRADE_MAP[p[0]] ?? null }) },
  ㄴㄹ: { cmd: '나락', parse: (p) => ({ 등급: GRADE_MAP[p[0]] ?? null }) },
  ㅅㄴㅈ: { cmd: '시너지', parse: (p) => ({ 검색: p.join(' ') || null }) },
  ㅊㅂ: { cmd: '체방', parse: () => ({}) },
  ㅋㄱ: { cmd: '클골', parse: (p) => ({ 레이드명: p.join(' ') || null }) },
  ㅈㄱ: { cmd: '주급', usage: 'ㅈㄱ 닉네임', parse: (p) => (p[0] ? { 닉네임: p.join(' ') } : null) },
  ㅅㅅ: { cmd: '시세', usage: 'ㅅㅅ 아이템명 (예: ㅅㅅ 운명의 파괴석)', parse: (p) => (p[0] ? { 아이템명: p.join(' ') } : null) },
  ㄱㅇㅅ: { cmd: '각인서', usage: 'ㄱㅇㅅ 각인명 (예: ㄱㅇㅅ 원한)', parse: (p) => (p[0] ? { 각인명: p.join(' ') } : null) },
  ㅂㅅ: { cmd: '보석', usage: 'ㅂㅅ 종류 레벨 (예: ㅂㅅ 겁화 10)', parse: (p) => {
    const 레벨 = toInt(p[1]);
    return p[0] && 레벨 ? { 종류: p[0], 레벨 } : null;
  } },
  ㅅㅋㅋㄷ: { cmd: '스킬코드', usage: 'ㅅㅋㅋㄷ 닉네임', parse: (p) => (p[0] ? { 닉네임: p.join(' ') } : null) },
  ㅋㄹㅌ: { cmd: '캐릭터', usage: 'ㅋㄹㅌ 닉네임', parse: (p) => (p[0] ? { 닉네임: p.join(' ') } : null) },
  ㄱㅈ: { cmd: '군장', usage: 'ㄱㅈ 닉네임', parse: (p) => (p[0] ? { 닉네임: p.join(' ') } : null) },
  ㄷㅇㅁ: { cmd: '도움말', parse: () => ({}) },
};

// 슬래시 인터랙션 흉내 어댑터
class TextInteraction {
  constructor(message, options) {
    this.message = message;
    this.channelId = message.channelId;
    this.guildId = message.guildId;
    this.channel = message.channel;
    this.deferred = false;
    this.replied = false;
    this.options = {
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
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
const WORD_CMDS = new Map(Object.values(ALIASES).map((def) => [def.cmd, def]));

// 처리했으면 true를 반환한다.
export async function handleTextCommand(message, commandMap) {
  const parts = message.content.trim().split(/\s+/);
  const raw = parts[0] ?? '';
  const hasPrefix = /^[.!]/.test(raw);
  const token = raw.replace(/^[.!]/, '');

  let alias = ALIASES[token]; // 초성 — 접두사 유무 무관
  if (!alias && hasPrefix && WORD_CMDS.has(token)) alias = WORD_CMDS.get(token); // 단어 — 접두사 필수
  if (!alias) return false;

  const command = commandMap.get(alias.cmd);
  if (!command) return false;

  const options = alias.parse(parts.slice(1));
  if (options === null) {
    await message.reply(`사용법: \`${alias.usage}\``).catch(() => {});
    return true;
  }

  const fake = new TextInteraction(message, options);
  try {
    await command.execute(fake);
  } catch (err) {
    console.error(`[초성 ${parts[0]}]`, err);
    await message.reply(`오류가 발생했어요: ${err.message}`).catch(() => {});
  }
  return true;
}
