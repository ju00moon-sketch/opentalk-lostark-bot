// /스펙업 표시 계층 — 코어(lopec-sim.getSpecupGuide)가 준 SpecupGuide를 디스코드 본문·카톡 미리보기·카톡 전체 평문으로 바꾼다.
// 반올림·상위 N·표기는 전부 여기서만 한다(코어는 원값과 전체 행을 준다 — 스펙 4절).
import { TITLE } from './kakao/layout.js';
import { STALE_AFTER_MS } from './crystal-price.js';

export const PREVIEW_COUNT = 10;
const KAKAO_PREVIEW_COUNT = 5;

const fixed1 = (n) => n.toLocaleString('ko-KR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const goldInt = (n) => Math.round(n).toLocaleString('ko-KR');
const signed = (n) => `${n < 0 ? '-' : '+'}${fixed1(Math.abs(n))}`;
const kstClock = (ms) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));

// 한 행의 표기 조각. 진짜 무료(per100k null)는 "무료 · —", 로펙 시세로 보충한 행은 끝에 *. 고정 비용 모델(fixed) 행에는 *를 붙이지 않는다.
export function rowParts(row, baseScore) {
  const free = row.per100k === null || row.expectedCost === 0;
  return {
    label: `${row.kind} · ${row.option}`,
    score: `${fixed1(row.finalScore)} (${signed(row.finalScore - baseScore)})`,
    cost: free ? '무료' : `${goldInt(row.expectedCost)}G`,
    per: free ? '—' : fixed1(row.per100k),
    star: row.priceSource === 'lopec' ? '*' : '',
  };
}

const headerLine = (profile, guide) =>
  `${profile.CharacterClassName} (${profile.ItemAvgLevel}) · 현재 로펙 ${fixed1(guide.baseScore)}`;

const discordLine = (index, row, baseScore) => {
  const p = rowParts(row, baseScore);
  return `${index}. ${p.label}  ${p.score} · ${p.cost} · ${p.per}${p.star}`;
};

// 확인 가능한 악세 등급만 변경/유지로 요약한다. 형식이 달라지면 원문을 보존한다.
function kakaoOption(row) {
  const [subject, ...rest] = row.option.split(' · ');
  const detail = rest.join(' · ');
  const fallback = { title: `${row.kind} · ${subject}`, detail };
  if (row.kind !== '악세' || !detail) return fallback;
  const states = detail.split(' → ');
  if (states.length !== 2) return fallback;
  const parsed = states.map((state) => state.split(/\s*\/\s*/).map((part) => /^(.+?)\s*\[(하|중|상)\]$/.exec(part.trim())));
  if (parsed.some((parts) => parts.some((p) => !p))) return fallback;
  const [before, after] = parsed.map((parts) => new Map(parts.map((p) => [p[1].trim(), p[2]])));
  if (before.size !== parsed[0].length || after.size !== parsed[1].length) return fallback;
  const changes = [...new Set([...before.keys(), ...after.keys()])].map((name) => {
    const from = before.get(name), to = after.get(name);
    if (!from) return `${name} ${to} 추가`;
    if (!to) return `${name} ${from} 제거`;
    return from === to ? `${name} ${to} 유지` : `${name} ${from} → ${to}`;
  });
  return { title: `${subject} 교체`, detail: changes.join(' · ') };
}

const kakaoItem = (index, row, baseScore, full) => {
  const p = rowParts(row, baseScore);
  const option = kakaoOption(row);
  return [
    `${index}위 · ${option.title}`,
    ...(option.detail ? [option.detail] : []),
    '',
    `예상 비용: ${p.cost.replace(/G$/, '골드')}${p.star}`,
    `점수 상승: ${signed(row.finalScore - baseScore)}점`,
    `투자 효율: ${p.per === '—' ? '—' : `${p.per}점 / 10만 골드`}`,
    ...(full ? [`변경 후 점수: ${fixed1(row.finalScore)}점`] : []),
  ].join('\n');
};

// 푸터 7항목 — 순서 고정, 조건부 항목은 해당할 때만 (스펙 2절).
// crystal: 저장소의 시세 { price95, at, source } — 페온 포함 여부는 코어가 실제로 쓴 guide.crystalPrice95로 판정한다(스펙 2절 페온 항목).
export function footerFor(guide, crystal = null) {
  const parts = [
    '점수는 로펙 스펙업 가이드와 동일',
    '비용은 거래소·경매장 실시간 시세(5분 캐시)',
  ];
  if (guide.pricedAt !== null && guide.pricedAt !== undefined) parts.push(`시세 기준 ${kstClock(guide.pricedAt)}`);
  if (guide.priceStale) parts.push('로펙 시세 갱신 지연');
  if (guide.rows.some((r) => r.priceSource === 'lopec')) parts.push('* 로펙 시세');
  if (guide.rows.some((r) => r.priceSource === 'fixed')) parts.push('스톤·카르마는 로펙 고정 비용 모델');
  parts.push(...peonParts(guide, crystal));
  if (guide.droppedForPrice > 0) parts.push(`비용 미확인 후보 ${guide.droppedForPrice}개 제외`);
  return parts.join(' · ');
}

const kstMonthDay = (ms) => {
  const d = new Date(ms + 9 * 60 * 60 * 1000); // KST 날짜를 월/일로
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
};
// 페온 항목: 포함이면 쓴 시세와 출처(로아툴 자동 갱신일 / 직접 설정일), 7일 넘었으면 갱신 안내, 제외면 아직 시세를 못 받은 상태.
// 항목 안에는 ' · '를 쓰지 않는다 — 카톡이 푸터를 ' · '로 나눈다.
export function peonParts(guide, crystal, now = Date.now()) {
  const used = guide.crystalPrice95;
  if (!Number.isFinite(used) || used <= 0) return ['페온 제외 — 크리스탈 시세를 아직 못 받았어요(/크리스탈로 직접 설정 가능)'];
  const at = Number.isFinite(crystal?.at) ? crystal.at : null;
  const stamp = at === null ? '' : crystal?.source === 'auto' ? `(로아툴 ${kstMonthDay(at)} 자동)` : `(${kstMonthDay(at)} 설정)`;
  const parts = [`페온 포함 — 크리스탈 95개 ${goldInt(used)}G${stamp}`];
  if (at === null || now - at > STALE_AFTER_MS) {
    const days = at === null ? null : Math.floor((now - at) / 86_400_000);
    parts.push(`크리스탈 시세 ${days === null ? '갱신 시각 미상' : `${days}일 전 값`} — 자동 갱신이 안 되고 있어요, /크리스탈로 직접 갱신`);
  }
  return parts;
}

export function discordDescription(profile, guide) {
  const top = guide.rows.slice(0, PREVIEW_COUNT);
  return [
    headerLine(profile, guide),
    '',
    ...top.map((r, i) => discordLine(i + 1, r, guide.baseScore)),
    '',
    '마지막 열 = 점수/10만G',
  ].join('\n');
}

// 카톡: 상위 5개는 비용·상승량 중심으로, 전체 보기는 모든 후보와 변경 후 총점까지 제공한다.
// 후보가 5개 이하여도 총점은 전체 보기에서만 제공하므로 두 본문을 구분한다.
export function kakaoTexts(profile, guide, crystal = null) {
  const build = (rows, full = false) => [
    `${TITLE(`${profile.CharacterName}님의 스펙업 효율`)}\n${headerLine(profile, guide)}`,
    ...rows.map((r, i) => kakaoItem(i + 1, r, guide.baseScore, full)),
    '투자 효율은 같은 골드 대비 점수 상승량입니다.\n높을수록 가성비가 좋습니다.',
    footerFor(guide, crystal).split(' · ').join('\n'),
  ].join('\n\n');
  return { preview: build(guide.rows.slice(0, KAKAO_PREVIEW_COUNT)), full: build(guide.rows, true) };
}
