// /스펙업 표시 계층 — 코어(lopec-sim.getSpecupGuide)가 준 SpecupGuide를 디스코드 본문·카톡 미리보기·카톡 전체 평문으로 바꾼다.
// 반올림·상위 N·표기는 전부 여기서만 한다(코어는 원값과 전체 행을 준다 — 스펙 4절).
import { TITLE } from './kakao/layout.js';

export const PREVIEW_COUNT = 10;

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

const kakaoItem = (index, row, baseScore) => {
  const p = rowParts(row, baseScore);
  return `${index}. ${p.label}\n→ ${p.score} · ${p.cost} · ${p.per}/10만G${p.star}`;
};

// 푸터 7항목 — 순서 고정, 조건부 항목은 해당할 때만 (스펙 2절).
export function footerFor(guide) {
  const parts = [
    '점수는 로펙 스펙업 가이드와 동일',
    '비용은 거래소·경매장 실시간 시세(5분 캐시)',
  ];
  if (guide.pricedAt !== null && guide.pricedAt !== undefined) parts.push(`시세 기준 ${kstClock(guide.pricedAt)}`);
  if (guide.priceStale) parts.push('로펙 시세 갱신 지연');
  if (guide.rows.some((r) => r.priceSource === 'lopec')) parts.push('* 로펙 시세');
  if (guide.rows.some((r) => r.priceSource === 'fixed')) parts.push('스톤·카르마는 로펙 고정 비용 모델');
  if (guide.droppedForPrice > 0) parts.push(`비용 미확인 후보 ${guide.droppedForPrice}개 제외`);
  return parts.join(' · ');
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

// 카톡: 미리보기(상위 10개)와 전체(행 전체). 둘 다 제목·머리줄·푸터를 갖춘 완결된 본문이다.
// 행이 10개 이하면 두 문자열이 같아 브리지가 전체 보기 링크를 만들지 않는다(스펙 2절 조건).
export function kakaoTexts(profile, guide) {
  const build = (rows) => [
    `${TITLE(`${profile.CharacterName}님의 스펙업 효율`)}\n${headerLine(profile, guide)}`,
    ...rows.map((r, i) => kakaoItem(i + 1, r, guide.baseScore)),
    footerFor(guide),
  ].join('\n\n');
  return { preview: build(guide.rows.slice(0, PREVIEW_COUNT)), full: build(guide.rows) };
}
