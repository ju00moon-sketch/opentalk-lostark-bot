// 가디언 토벌 — 잔영 주간 로테이션 + 전체 가디언 속성/추천 카드.
// 카드 구성은 길드장이 제공한 전체 가디언 정보 기준 (2026-08-30).
// 기준점: 2026-08-26(수) 리셋 주 = 스콜라키아.
export const DATA_DATE = '2026-08-30';

// 속성별 추천 카드 (첫째 줄: 딜러, 둘째 줄: 서폿)
export const ELEMENT_CARDS = {
  암: { dealer: '카제로스의 군단장', support: '신념의 길' },
  토: { dealer: '굳센 대지의 숨결', support: '잠재우는 대지의 가호' },
  뇌: { dealer: '날랜 뇌전의 숨결', support: '몰아치는 뇌전의 가호' },
  성: { dealer: '세상을 구하는 빛', support: '남겨진 바람의 절벽' },
  화: { dealer: '힘찬 화염의 숨결', support: '피어나는 화염의 가호' },
  수: { dealer: '거센 파도의 숨결', support: '노래하는 파도의 가호' },
  무: { dealer: '세상을 구하는 빛', support: '남겨진 바람의 절벽', note: '무속성은 취약 보정이 없어 보유 카드 중 각성 높은 세팅 추천' },
};

// 전체 가디언 목록. rotation: true = 잔영 주간 로테이션 대상 (순서 = 로테이션 순서)
export const GUARDIANS = [
  { name: '루멘칼리고', element: '암', rotation: true },
  { name: '가르가디스', element: '토', rotation: true },
  { name: '스콜라키아', element: '토', rotation: true },
  { name: '크라티오스', element: '뇌', rotation: true },
  { name: '아게오로스', element: '성', rotation: true },
  { name: '드렉탈라스', element: '화', rotation: true },
  { name: '소나벨', element: '암', rotation: true },
  { name: '베스칼', element: '화', rotation: true },
  { name: '쿤켈라니움', element: '뇌', rotation: false },
  { name: '하누마탄', element: '무', rotation: false },
  { name: '데스칼루다', element: '수', rotation: false },
  { name: '이그렉시온', element: '화', rotation: false },
  { name: '벨가누스', element: '성', rotation: false },
  { name: '아카테스', element: '암', rotation: false },
  { name: '엘버하스틱', element: '수', rotation: false },
];

const ROTATION = GUARDIANS.filter((g) => g.rotation);

// 기준 주 (수요일 06:00 KST 리셋 기준)와 그 주의 로테이션 인덱스
export const ANCHOR = { date: '2026-08-26', index: 2 };

export function cardsFor(element) {
  return ELEMENT_CARDS[element] ?? { dealer: '-', support: '-' };
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

// 가장 최근의 수요일 06:00 KST 시각 (ms)
function currentResetMs(nowMs) {
  const kst = new Date(nowMs + 9 * 3600 * 1000);
  const day = kst.getUTCDay();
  const daysSinceWed = (day - 3 + 7) % 7;
  const resetKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - daysSinceWed, 6, 0, 0);
  let reset = resetKst - 9 * 3600 * 1000;
  if (nowMs < reset) reset -= WEEK_MS;
  return reset;
}

// 이번 주(+offset 주)의 잔영 가디언
export function guardianForWeek(offset = 0) {
  const anchorReset = Date.parse(`${ANCHOR.date}T06:00:00+09:00`);
  const weeks = Math.round((currentResetMs(Date.now()) - anchorReset) / WEEK_MS) + offset;
  const index = ((ANCHOR.index + weeks) % ROTATION.length + ROTATION.length) % ROTATION.length;
  return ROTATION[index];
}
