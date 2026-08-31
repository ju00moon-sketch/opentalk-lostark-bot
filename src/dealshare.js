// /딜지분 · /딜컷 공용 로직 — 인자 파싱과 기여도 계산.
// 슬래시 커맨드와 채팅 커맨드가 같은 규칙을 쓰도록 여기 모아 둔다.
import { RAID_HP, CUTS, BASE_TITLE } from './data/raidhp.js';

// 레이드명 별칭. "세나" = 세르카 나메처럼 (레이드 약칭 + 난이도 약칭)으로 조합해 찾는다.
const RAID_ALIASES = {
  '4막': ['4막', '4', '사막', '파멸의성채', '파멸'],
  종막: ['종막', '종', '최후의날'],
  세르카: ['세르카', '세르', '세'],
  성당: ['지평의성당', '지평', '성당', '성'],
  벨가르딘: ['벨가르딘', '벨가', '벨'],
};
const DIFF_ALIASES = {
  노말: ['노말', '노', 'n'],
  하드: ['하드', '하', 'h'],
  나메: ['나메', '나이트메어', '나', 'nm'],
  '1단계': ['1단계', '1'],
  '2단계': ['2단계', '2'],
  '3단계': ['3단계', '3'],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, '');

// 아직 데이터가 없는 레이드 — "못 찾음"과 구분해서 안내한다.
const UNSUPPORTED = /^(1막|2막|3막|일막|이막|삼막)/;

// 입력을 레이드로 해석한다. 난이도까지 붙으면 단일 항목, 레이드만 주면 난이도 전체.
export function resolveRaid(input) {
  const q = norm(input);
  if (!q) return null;

  const matches = [];
  for (const entry of RAID_HP) {
    for (const rAlias of RAID_ALIASES[entry.raid] ?? []) {
      const r = norm(rAlias);
      if (q === r) {
        matches.push({ entry, exact: false });
        break;
      }
      for (const dAlias of DIFF_ALIASES[entry.diff] ?? []) {
        if (q === r + norm(dAlias)) {
          matches.push({ entry, exact: true });
          break;
        }
      }
    }
  }
  if (matches.length === 0) {
    return UNSUPPORTED.test(q) ? { unsupported: true } : null;
  }
  const exact = matches.filter((m) => m.exact);
  const list = (exact.length > 0 ? exact : matches).map((m) => m.entry);
  return { entries: list, exact: exact.length > 0 };
}

// "2700억", "1조", "1조2000억", "5000만" → 숫자. 단위가 없으면 null.
export function parseDamage(token) {
  const m = /^(?:(\d+(?:\.\d+)?)조)?(?:(\d+(?:\.\d+)?)억)?(?:(\d+(?:\.\d+)?)만)?$/.exec(token);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 1e12 + Number(m[2] ?? 0) * 1e8 + Number(m[3] ?? 0) * 1e4;
}

// 인자 배열을 { 레이드, 관문, 피해량, 시간(초) }로 해석한다.
// mode 'share'(딜지분)는 남은 숫자를 [관문, 피해량]으로, 'cut'(딜컷)은 [관문, 분]으로 읽는다.
// 단독 숫자는 1~30이면 분, 그보다 크면 억으로 본다.
export function parseArgs(parts, mode = 'share') {
  let raid = '';
  let gate = null;
  let damage = null;
  let seconds = null;
  const bare = [];

  // 채팅 커맨드는 인자 전체를 한 문자열로 넘기므로 공백 기준으로 한 번 더 쪼갠다
  const tokens = parts.flatMap((p) => String(p ?? '').trim().split(/\s+/)).filter(Boolean);

  for (const raw of tokens) {
    let token = raw;

    // 레이드명에 붙은 관문 (세나1관)도 떼어 낸다
    const gateMatch = /(\d+)관(문)?$/.exec(token);
    if (gateMatch) {
      gate ??= Number(gateMatch[1]);
      token = token.slice(0, gateMatch.index);
      if (!token) continue;
    }

    let m = /^(\d+):(\d{1,2})$/.exec(token); // 10:00
    if (m) {
      seconds ??= Number(m[1]) * 60 + Number(m[2]);
      continue;
    }
    m = /^(\d+)분(?:(\d+)초)?$/.exec(token); // 10분 / 10분30초
    if (m) {
      seconds ??= Number(m[1]) * 60 + Number(m[2] ?? 0);
      continue;
    }
    const dmg = parseDamage(token);
    if (dmg !== null) {
      damage ??= dmg;
      continue;
    }
    if (/^\d+(\.\d+)?$/.test(token)) {
      bare.push(Number(token));
      continue;
    }
    raid += token;
  }

  // 남은 순수 숫자 배분
  if (bare.length >= 2) {
    if (gate === null) gate = bare.shift();
    if (mode === 'cut') seconds ??= bare[0] * 60;
    else damage ??= bare[0] * 1e8;
  } else if (bare.length === 1) {
    const n = bare[0];
    if (mode === 'cut') seconds ??= n * 60;
    else if (damage !== null) gate ??= n;
    else if (n <= 30) seconds ??= n * 60;
    else damage = n * 1e8;
  }

  return { raid, gate, damage, seconds };
}

// 관문 하나의 기여도 계산 결과.
export function computeGate(entry, gate, damage, seconds) {
  const total = gate.hp - gate.tactic; // 연합군(택틱) 딜은 분모에서 뺀다
  const time = seconds ?? gate.time;
  const cuts = CUTS[entry.players].map((cut) => ({
    ...cut,
    need: total * cut.ratio,
    dps: total * cut.ratio / time,
  }));

  let ratio = null;
  let title = null;
  if (damage != null) {
    ratio = damage / total;
    title = BASE_TITLE;
    for (const cut of [...cuts].sort((a, b) => a.ratio - b.ratio)) {
      if (cut.title && ratio >= cut.ratio) title = cut.title;
    }
  }
  return { total, time, cuts, ratio, title, dps: damage == null ? null : damage / time };
}

// 안내문에 쓸 짧은 호출명 — 벨가르딘 하드 → "벨하", 지평의 성당 3단계 → "성3".
export function shortName(entry) {
  const raidAlias = [...(RAID_ALIASES[entry.raid] ?? [entry.raid])].sort(
    (a, b) => a.length - b.length,
  )[0];
  const stage = /^(\d)단계$/.exec(entry.diff);
  return raidAlias + (stage ? stage[1] : entry.diff[0]);
}

// 큰 수를 "1조 2000억" 꼴로. 억 미만은 버린다.
export function damageText(n) {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const jo = Math.floor(n / 1e12);
  const eok = Math.round((n - jo * 1e12) / 1e8);
  if (jo > 0) return eok > 0 ? `${jo}조 ${eok.toLocaleString('ko-KR')}억` : `${jo}조`;
  return `${eok.toLocaleString('ko-KR')}억`;
}

// DPS는 억/초 단위로 소수 둘째 자리까지.
export const dpsText = (n) => `${(n / 1e8).toFixed(2)}억/초`;

export const timeText = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
};
