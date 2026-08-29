// 지옥/나락 "효율" — 시즌3 (1750 열쇠) 단계별 보상 데이터.
// 출처: loalogol.kr 지옥 보상 계산기에서 전 단계 추출 (2026-08-30 확인).
// 각 선택지 가치 = (지옥은 기본 보상 골드 +) Σ(수량 × 개당 가치).
// 개당 가치: 거래 가능 재료는 실시간 거래소 시세, 나머지는 아래 고정/추정 단가.
export const DATA_DATE = '2026-08-30';

// 거래소 실시간 시세 조회 대상 (강화 재료 카테고리 50000)
export const MARKET_ITEMS = [
  '용암의 숨결',
  '빙하의 숨결',
  '상급 아비도스 융화 재료',
  '운명의 파괴석 결정',
  '운명의 수호석 결정',
  '위대한 운명의 돌파석',
];

// 고정/추정 단가 (골드). 시세를 못 구한 거래 아이템의 예비값으로도 쓴다.
export const FIXED_UNIT_VALUES = {
  // 거래소 아이템 예비 단가 (거래소 장애/점검 시 폴백 — 2026-08-30 시세 기준)
  '용암의 숨결': 367,
  '빙하의 숨결': 279,
  '상급 아비도스 융화 재료': 183,
  '운명의 파괴석 결정': 9.1,
  '운명의 수호석 결정': 1.5,
  '위대한 운명의 돌파석': 13,
  '귀속 골드': 1,
  // 일반재련 대체 비용 역산. 평균 시행 횟수(1÷1.5%≈67트) 기준 — 엉봇과 동일 관점.
  // (중앙값 46트 기준으로 보수적으로 잡으면 385G — 로아로골 방식)
  '특수재련 재료': 538,
  '정련된 운명의 돌': 900,
  '정련된 혼돈의 돌': 1100,
  '젬(희귀)': 2000,
  '젬(영웅)': 20000,
  '천상 도전권': 3000,
  '팔찌': 130, // 페온 환산 근사
  '어빌리티 스톤': 270, // 키트당 추정
  '귀속 각인서': 16670, // 유물 각인서 평균가 근사
  '귀속 보석': 358000,
  '전설 카드팩': 8000,
};

// 지옥 단계 0~10. breath=[용암,빙하], stones=[운명,혼돈], guard=[파괴,수호], gem=[수량,등급]
export const HELL_STAGES = [
  { stone: 9, breath: [12, 36], fusion: 75, special: 28, stones: [9, 7], guard: [600, 1800], gold: 5500, gem: [3, '희귀'], heaven: 0, brace: 4, leap: 30, base: 734 },
  { stone: 12, breath: [18, 54], fusion: 110, special: 45, stones: [13, 10], guard: [750, 2250], gold: 8200, gem: [6, '희귀'], heaven: 0, brace: 6, leap: 42, base: 896 },
  { stone: 18, breath: [24, 72], fusion: 150, special: 62, stones: [18, 15], guard: [1100, 3300], gold: 11000, gem: [8, '희귀'], heaven: 0, brace: 8, leap: 56, base: 1053 },
  { stone: 25, breath: [30, 90], fusion: 200, special: 84, stones: [24, 20], guard: [1500, 4500], gold: 14400, gem: [12, '희귀'], heaven: 0, brace: 12, leap: 76, base: 1243 },
  { stone: 33, breath: [40, 120], fusion: 270, special: 115, stones: [33, 27], guard: [2000, 6000], gold: 19200, gem: [1, '영웅'], heaven: 0, brace: 18, leap: 108, base: 1441 },
  { stone: 45, breath: [60, 180], fusion: 360, special: 155, stones: [45, 36], guard: [2700, 8100], gold: 26400, gem: [2, '영웅'], heaven: 2, brace: 24, leap: 160, base: 1657 },
  { stone: 60, breath: [90, 270], fusion: 540, special: 220, stones: [72, 54], guard: [3600, 10800], gold: 38400, gem: [3, '영웅'], heaven: 4, brace: 30, leap: 230, base: 1906 },
  { stone: 80, breath: [130, 390], fusion: 720, special: 310, stones: [90, 72], guard: [5400, 16200], gold: 54000, gem: [4, '영웅'], heaven: 7, brace: 42, leap: 320, base: 2138 },
  { stone: 110, breath: [180, 540], fusion: 1000, special: 430, stones: [120, 100], guard: [7800, 23400], gold: 78000, gem: [5, '영웅'], heaven: 10, brace: 60, leap: 450, base: 2386 },
  { stone: 150, breath: [260, 780], fusion: 1440, special: 600, stones: [180, 144], guard: [10800, 32400], gold: 114000, gem: [6, '영웅'], heaven: 15, brace: 90, leap: 650, base: 2636 },
  { stone: 220, breath: [380, 1140], fusion: 2400, special: 1000, stones: [300, 250], guard: [18000, 54000], gold: 156000, gem: [7, '영웅'], heaven: 20, brace: 150, leap: 1000, base: 2879 },
];

// 나락 단계 0~10. engrave=귀속 각인서, jewel=귀속 보석, card=전설 카드팩
export const NARAKA_STAGES = [
  { stone: 45, breath: [60, 180], stones: [45, 35], gold: 27500, gem: [15, '희귀'], brace: 20, engrave: 3, jewel: 0, card: 0 },
  { stone: 60, breath: [90, 270], stones: [65, 50], gold: 41000, gem: [30, '희귀'], brace: 30, engrave: 5, jewel: 0, card: 0 },
  { stone: 90, breath: [120, 360], stones: [90, 75], gold: 55000, gem: [40, '희귀'], brace: 40, engrave: 7, jewel: 0, card: 0 },
  { stone: 125, breath: [150, 450], stones: [120, 100], gold: 72000, gem: [60, '희귀'], brace: 60, engrave: 10, jewel: 0, card: 0 },
  { stone: 165, breath: [200, 600], stones: [165, 135], gold: 96000, gem: [5, '영웅'], brace: 90, engrave: 13, jewel: 0, card: 0 },
  { stone: 225, breath: [300, 900], stones: [225, 180], gold: 132000, gem: [10, '영웅'], brace: 120, engrave: 16, jewel: 0, card: 1 },
  { stone: 300, breath: [450, 1350], stones: [360, 270], gold: 192000, gem: [15, '영웅'], brace: 150, engrave: 24, jewel: 0, card: 2 },
  { stone: 400, breath: [650, 1950], stones: [450, 360], gold: 270000, gem: [20, '영웅'], brace: 210, engrave: 32, jewel: 0, card: 3 },
  { stone: 550, breath: [900, 2700], stones: [600, 500], gold: 390000, gem: [25, '영웅'], brace: 300, engrave: 48, jewel: 4, card: 4 },
  { stone: 750, breath: [1300, 3900], stones: [900, 720], gold: 570000, gem: [30, '영웅'], brace: 450, engrave: 65, jewel: 5, card: 5 },
  { stone: 1100, breath: [1900, 5700], stones: [1500, 1250], gold: 780000, gem: [35, '영웅'], brace: 750, engrave: 100, jewel: 6, card: 7 },
];

// 단계 데이터를 /효율 커맨드가 쓰는 선택지 목록으로 변환한다.
export function buildTable(content, stage) {
  const s = (content === '지옥' ? HELL_STAGES : NARAKA_STAGES)[stage];
  if (!s) return null;

  // parts 항목: ['아이템', 수량] = 모두 지급, { choice: [...] } = 택1 (가치가 높은 쪽으로 계산)
  const options = [
    { name: '재련 보조 (숨결)', parts: [['용암의 숨결', s.breath[0]], ['빙하의 숨결', s.breath[1]]] },
    { name: '운명/혼돈의 돌 (택1)', parts: [{ choice: [['정련된 운명의 돌', s.stones[0]], ['정련된 혼돈의 돌', s.stones[1]]] }] },
    { name: '귀속 골드', parts: [['귀속 골드', s.gold]] },
    { name: `젬 선택 (${s.gem[1]})`, parts: [[`젬(${s.gem[1]})`, s.gem[0]]] },
    { name: '어빌리티 스톤', parts: [['어빌리티 스톤', s.stone]] },
    { name: '팔찌', parts: [['팔찌', s.brace]] },
  ];

  if (content === '지옥') {
    options.push(
      { name: '특수 재련', parts: [['특수재련 재료', s.special]] },
      { name: '융화 재료', parts: [['상급 아비도스 융화 재료', s.fusion]] },
      { name: '파괴석/수호석 (택1)', parts: [{ choice: [['운명의 파괴석 결정', s.guard[0]], ['운명의 수호석 결정', s.guard[1]]] }] },
      { name: '돌파석', parts: [['위대한 운명의 돌파석', s.leap]] },
    );
    if (s.heaven > 0) options.push({ name: '천상 도전권', parts: [['천상 도전권', s.heaven]] });
  } else {
    options.push({ name: '귀속 각인서', parts: [['귀속 각인서', s.engrave]] });
    if (s.jewel > 0) options.push({ name: '귀속 보석', parts: [['귀속 보석', s.jewel]] });
    if (s.card > 0) options.push({ name: '전설 카드팩', parts: [['전설 카드팩', s.card]] });
  }

  return {
    label: `[시즌3] ${content} 1750 - ${stage}단계`,
    baseGold: content === '지옥' ? s.base : 0,
    options,
  };
}
