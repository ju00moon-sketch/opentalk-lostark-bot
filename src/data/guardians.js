// 잔영 가디언 토벌 주간 로테이션 + 속성/추천 카드.
// ⚠️ 순서는 나무위키 기재 순환 목록 기준 추정 — 실제와 다르면 ROTATION 순서만 수정하면 된다.
// 기준점: 2026-08-26(수) 리셋 주 = 스콜라키아 (길드장 확인).
export const DATA_DATE = '2026-08-30';

export const ROTATION = [
  { name: '루멘칼리고', element: '암' },
  { name: '가르가디스', element: '토' },
  { name: '스콜라키아', element: '토' },
  { name: '크라티오스', element: '뇌' },
  { name: '아게오로스', element: '성' },
  { name: '드렉탈라스', element: '화' },
  { name: '소나벨', element: '암' },
  { name: '베스칼', element: '화' },
];

// 기준 주 (수요일 06:00 KST 리셋 기준)와 그 주의 로테이션 인덱스
export const ANCHOR = { date: '2026-08-26', index: 2 };

// 속성별 추천 카드 (딜러: 세구빛 계열, 서폿: 남바절 계열 + 속성 변환)
export function cardsFor(element) {
  return {
    dealer: `${element}구빛 (세상을 구하는 빛 + ${element}속성 변환)`,
    support: `${element}바절 (남겨진 바람의 절벽 + ${element}속성 변환)`,
  };
}

const WEEK_MS = 7 * 24 * 3600 * 1000;

// 가장 최근의 수요일 06:00 KST 시각 (ms)
function currentResetMs(nowMs) {
  const kst = new Date(nowMs + 9 * 3600 * 1000);
  const day = kst.getUTCDay(); // KST 기준 요일
  const daysSinceWed = (day - 3 + 7) % 7;
  const resetKst = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - daysSinceWed, 6, 0, 0);
  let reset = resetKst - 9 * 3600 * 1000; // UTC로 환산
  if (nowMs < reset) reset -= WEEK_MS; // 수요일 06시 이전이면 지난주 리셋
  return reset;
}

// 이번 주(+offset 주)의 가디언
export function guardianForWeek(offset = 0) {
  const anchorReset = Date.parse(`${ANCHOR.date}T06:00:00+09:00`);
  const weeks = Math.round((currentResetMs(Date.now()) - anchorReset) / WEEK_MS) + offset;
  const index = ((ANCHOR.index + weeks) % ROTATION.length + ROTATION.length) % ROTATION.length;
  return ROTATION[index];
}
