// 팔찌 검색 — "특90치90" 같은 입력을 경매장 조회 조건으로 바꾸고, 응답을 표시용으로 정리한다.
// 공식 경매장 API는 팔찌의 전투 특성·부여 효과 수량·도약·특수 효과만 주고 부여 효과 내용(치피·적추 등)은 주지 않는다(명세 §2).
import { searchBraceletAuction } from './lostark.js';

// 옵션 코드는 공식 API GET /auctions/options 기준(2026-09-07 확인). FirstOption 2 = 전투 특성, 4 = 팔찌 옵션 수량, 5 = 팔찌 특수 효과.
export const STAT_CODES = { 치명: 15, 특화: 16, 제압: 17, 신속: 18, 인내: 19, 숙련: 20 };
const STAT_SHORT = { 특: '특화', 치: '치명', 신: '신속', 제: '제압', 인: '인내', 숙: '숙련' };
const STAT_NAMES = [...Object.keys(STAT_CODES), ...Object.keys(STAT_SHORT)].sort((a, b) => b.length - a.length);
const STAT_MAX = 999;
// 특수 효과는 이름만 조건이라 실수치를 전부 포괄하는 넓은 범위로 검색한다(최대 생명력은 11,200~16,800 — 999로 두면 0건, 기술 검토 P2-1).
export const SPECIAL_MAX = 999_999;
const SLOT_OPTION = { 고정: 1, 부여: 2 };
const SLOT_MAX = { 고정: 2, 부여: 3 };

// 특수 효과 26종. 입력은 띄어쓰기 없이 비교하고, 긴 이름은 짧은 별칭도 받는다.
export const SPECIAL_EFFECTS = [
  { code: 39, name: '강타' }, { code: 40, name: '타격' }, { code: 26, name: '속공' }, { code: 27, name: '투자' },
  { code: 29, name: '멸시' }, { code: 30, name: '무시' }, { code: 28, name: '반격' }, { code: 31, name: '반전' },
  { code: 35, name: '앵콜' }, { code: 38, name: '돌진' }, { code: 37, name: '오뚝이' }, { code: 32, name: '회생' },
  { code: 33, name: '긴급 수혈' }, { code: 34, name: '응급 처치' }, { code: 36, name: '마나회수' },
  { code: 3, name: '최대 생명력' }, { code: 4, name: '최대 마나' }, { code: 1, name: '물리 방어력', aliases: ['물방'] }, { code: 2, name: '마법 방어력', aliases: ['마방'] },
  { code: 6, name: '전투 중 생명력 회복량', aliases: ['생명력회복'] }, { code: 59, name: '전투 자원 회복량', aliases: ['자원회복'] },
  { code: 60, name: '공격 및 이동 속도 증가', aliases: ['공이속'] },
  { code: 63, name: '이동기 및 기상기 재사용 대기시간 감소', aliases: ['이동기', '기상기'] },
  { code: 61, name: '시드 이하 주는 피해 증가', aliases: ['시드주피'] }, { code: 62, name: '시드 이하 받는 피해 감소', aliases: ['시드받피'] },
  { code: 64, name: '피격 이상 면역 효과', aliases: ['피격이상면역', '피면'] },
];
const compact = (s) => String(s).replace(/\s+/g, '');
const findSpecial = (token) => SPECIAL_EFFECTS.find((e) => compact(e.name) === token || (e.aliases ?? []).includes(token)) ?? null;
// "긴급 수혈"처럼 공백이 든 정식 이름은 토큰으로 쪼개기 전에 붙여 둔다(긴 이름 먼저). 정식 이름이 아닌 토큰끼리는 합치지 않는다.
const SPACED_NAMES = SPECIAL_EFFECTS.map((e) => e.name).filter((n) => n.includes(' ')).sort((a, b) => b.length - a.length);
const joinSpacedNames = (text) => SPACED_NAMES.reduce((s, name) => s.split(name).join(compact(name)), text);

const STAT_RE = new RegExp(`^(${STAT_NAMES.join('|')})(\\d{1,3})`);
const STAT_ONLY_RE = new RegExp(`^(${STAT_NAMES.join('|')})$`);
const SLOT_RE = /^(부여|고정)(\d)|^(\d)(부여|고정)/;

// "특90치90" · "특화 90 치명90 부여3" · "3부여 신100 강타" → 조건 객체. 형식이 아니거나 조건이 없으면 null.
export function parseBraceletQuery(text) {
  const tokens = joinSpacedNames(String(text ?? '')).trim().split(/\s+/).filter(Boolean);
  // "특 90"처럼 이름과 값이 떨어져 있으면 붙인다.
  for (let i = 0; i < tokens.length - 1; i++) {
    if (STAT_ONLY_RE.test(tokens[i]) && /^\d{1,3}$/.test(tokens[i + 1])) tokens.splice(i, 2, tokens[i] + tokens[i + 1]);
  }
  const query = { stats: [], randomSlots: null, fixedSlots: null, specials: [] };
  for (let token of tokens) {
    while (token) {
      let m = STAT_RE.exec(token);
      if (m) {
        const name = STAT_SHORT[m[1]] ?? m[1];
        const min = Number(m[2]);
        if (min < 1 || min > STAT_MAX || query.stats.some((s) => s.name === name)) return null;
        query.stats.push({ name, min });
        token = token.slice(m[0].length);
        continue;
      }
      m = SLOT_RE.exec(token);
      if (m) {
        const kind = m[1] ?? m[4];
        const count = Number(m[2] ?? m[3]);
        if (count < 1 || count > SLOT_MAX[kind]) return null;
        if (kind === '부여') { if (query.randomSlots !== null) return null; query.randomSlots = count; }
        else { if (query.fixedSlots !== null) return null; query.fixedSlots = count; }
        token = token.slice(m[0].length);
        continue;
      }
      const special = findSpecial(token);
      if (!special) return null;
      if (!query.specials.includes(special.name)) query.specials.push(special.name);
      token = '';
    }
  }
  const empty = query.stats.length === 0 && query.randomSlots === null && query.fixedSlots === null && query.specials.length === 0;
  return empty ? null : query;
}

// 표시·캐시 키용 라벨: "특화 90↑ 치명 90↑ · 부여 3 · 고정 2 · 강타"
export function queryLabel(query) {
  const parts = [];
  if (query.stats.length > 0) parts.push(query.stats.map((s) => `${s.name} ${s.min}↑`).join(' '));
  if (query.randomSlots !== null) parts.push(`부여 ${query.randomSlots}`);
  if (query.fixedSlots !== null) parts.push(`고정 ${query.fixedSlots}`);
  parts.push(...query.specials);
  return parts.join(' · ');
}

// API EtcOptions. MinValue만 주면 필터가 걸리지 않아 MaxValue를 함께 보낸다(특성은 999). 특수 효과는 값 조건 없이 0~SPECIAL_MAX.
export function toEtcOptions(query) {
  const etc = query.stats.map((s) => ({ FirstOption: 2, SecondOption: STAT_CODES[s.name], MinValue: s.min, MaxValue: STAT_MAX }));
  if (query.randomSlots !== null) etc.push({ FirstOption: 4, SecondOption: SLOT_OPTION.부여, MinValue: query.randomSlots, MaxValue: query.randomSlots });
  if (query.fixedSlots !== null) etc.push({ FirstOption: 4, SecondOption: SLOT_OPTION.고정, MinValue: query.fixedSlots, MaxValue: query.fixedSlots });
  for (const name of query.specials) {
    const special = SPECIAL_EFFECTS.find((e) => e.name === name);
    etc.push({ FirstOption: 5, SecondOption: special.code, MinValue: 0, MaxValue: SPECIAL_MAX });
  }
  return etc;
}

// 응답 한 건 → { price, bidStart, stats, randomSlots, leap, specials, endsAt }. 모르는 Type은 무시한다.
// 특수 효과는 BRACELET_SPECIAL_EFFECTS(최대 생명력 등)뿐 아니라 ABILITY_ENGRAVE(이동기 및 기상기 재사용 대기시간 감소 등)로도 온다(실검색 사본, 기술 검토 P2-2).
const SPECIAL_TYPES = new Set(['BRACELET_SPECIAL_EFFECTS', 'ABILITY_ENGRAVE']);
function normalizeItem(item) {
  const stats = [];
  const specials = [];
  let randomSlots = null;
  let leap = null;
  for (const o of item.Options ?? []) {
    if (o.Type === 'STAT') stats.push({ name: o.OptionName, value: o.Value });
    else if (o.Type === 'BRACELET_RANDOM_SLOT') randomSlots = o.Value;
    else if (o.Type === 'ARK_PASSIVE') leap = o.Value;
    else if (SPECIAL_TYPES.has(o.Type)) specials.push({ name: o.OptionName, value: o.Value });
  }
  const auction = item.AuctionInfo ?? {};
  return {
    price: auction.BuyPrice ?? null,
    bidStart: auction.BidStartPrice ?? auction.StartPrice ?? null,
    stats, randomSlots, leap, specials,
    endsAt: auction.EndDate ?? null,
  };
}

// 같은 조건은 60초 캐시(분당 100회 한도 공유). 진행 중인 조회는 함께 기다리고 실패는 캐시하지 않는다.
export const CACHE_TTL = 60 * 1000;
const cache = new Map(); // label → { result }
const inFlight = new Map(); // label → Promise

export function searchBracelets(query, { search = searchBraceletAuction, now = Date.now } = {}) {
  const key = queryLabel(query);
  const hit = cache.get(key);
  if (hit && now() - hit.at <= CACHE_TTL) return Promise.resolve(hit);
  if (inFlight.has(key)) return inFlight.get(key);
  const job = search(toEtcOptions(query))
    .then((res) => {
      const result = { total: res?.TotalCount ?? 0, items: (res?.Items ?? []).map(normalizeItem), at: now() };
      cache.set(key, result);
      return result;
    })
    .finally(() => { inFlight.delete(key); });
  inFlight.set(key, job);
  return job;
}

export const __test = { resetCache: () => { cache.clear(); inFlight.clear(); } };
