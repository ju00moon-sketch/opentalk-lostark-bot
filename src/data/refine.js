// 악세서리 연마 효과 — 경매장 검색용 옵션 코드와 등급별 수치.
// 코드는 로스트아크 경매장 API의 EtcOptions[7](연마 효과) SecondOption 값이고,
// 하/중/상 수치는 /연마표(src/commands/grinding.js)와 같은 값이다. 패치 시 둘 다 고쳐야 한다.
export const DATA_DATE = '2026-08-31';

export const REFINE_OPTION = 7; // EtcOptions FirstOption — 연마 효과

// code: [하, 중, 상] — 경매장이 받는 원시값 (2.00% → 200)
export const OPTIONS = {
  42: { name: '적주피%', full: '적에게 주는 피해', values: [55, 120, 200] },
  41: { name: '추피%', full: '추가 피해', values: [70, 160, 260] },
  44: { name: '낙인력', full: '낙인력', values: [215, 480, 800] },
  43: { name: '조게획', full: '세레나데·신앙·조화 게이지 획득량', values: [160, 360, 600] },
  45: { name: '공격력%', full: '공격력 %', values: [40, 95, 155] },
  46: { name: '무공%', full: '무기 공격력 %', values: [80, 180, 300] },
  47: { name: '파회복', full: '파티원 회복 효과', values: [95, 210, 350] },
  48: { name: '파보호막', full: '파티원 보호막 효과', values: [95, 210, 350] },
  49: { name: '치적%', full: '치명타 적중률', values: [40, 95, 155] },
  50: { name: '치피%', full: '치명타 피해', values: [110, 240, 400] },
  51: { name: '아공강%', full: '아군 공격력 강화 효과', values: [135, 300, 500] },
  52: { name: '아피강%', full: '아군 피해량 강화 효과', values: [200, 450, 750] },
  53: { name: '공격력', full: '공격력 +', values: [80, 195, 390] },
  54: { name: '무공', full: '무기 공격력 +', values: [195, 480, 960] },
  55: { name: '최생', full: '최대 생명력', values: [1300, 3250, 6500] },
};

export const GRADE_INDEX = { 하: 0, 중: 1, 상: 2 };

// 부위별로 실제로 찾는 조합. 앞의 두 개가 메인 옵션이고, 3옵 검색이면 역할별 filler를 더 붙인다.
export const SLOTS = [
  {
    name: '목걸이',
    category: 200010,
    combos: [
      { role: '딜러', codes: [42, 41] },
      { role: '서폿', codes: [44, 43] },
    ],
  },
  {
    name: '귀걸이',
    category: 200020,
    combos: [
      { role: '딜러', codes: [46, 45] },
      { role: '서폿', codes: [46, 54] },
    ],
  },
  {
    name: '반지',
    category: 200030,
    combos: [
      { role: '딜러', codes: [49, 50] },
      { role: '서폿', codes: [51, 52] },
    ],
  },
];

// 3옵 검색에서 세 번째 자리에 넣어 보는 옵션. 딜러는 공격력+/무공+, 서폿은 무공+/최생을 쓴다.
// 이미 조합에 들어간 옵션은 건너뛴다 — 귀걸이 서폿(무공%+무공+)은 최생만 붙는다.
export const ROLE_FILLERS = {
  딜러: [53, 54],
  서폿: [54, 55],
};

export const DEFAULT_QUALITY = 67;
