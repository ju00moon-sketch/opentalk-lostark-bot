// 레이드 클리어 골드 데이터.
// 출처: loalogol.kr 주간 골드 계산기 (2026-08-29 확인). 패치로 바뀌면 이 파일만 수정하면 된다.
// gates: 관문별 { g: 클리어 골드, bonus: 더보기 비용 }
export const DATA_DATE = '2026-08-29';

export const RAIDS = [
  { name: '벨가르딘', diff: '나이트메어', ilvl: 1780, gates: [{ g: 30000, bonus: 9600 }, { g: 45000, bonus: 14400 }] },
  { name: '벨가르딘', diff: '하드', ilvl: 1770, gates: [{ g: 25000, bonus: 8000 }, { g: 37000, bonus: 11840 }] },
  { name: '벨가르딘', diff: '노말', ilvl: 1750, gates: [{ g: 20000, bonus: 6400 }, { g: 30000, bonus: 9600 }] },
  { name: '지평의 성당', diff: '3단계', ilvl: 1750, gates: [{ g: 20000, bonus: 6400 }, { g: 30000, bonus: 9600 }] },
  { name: '지평의 성당', diff: '2단계', ilvl: 1720, gates: [{ g: 16000, bonus: 5120 }, { g: 24000, bonus: 7680 }] },
  { name: '지평의 성당', diff: '1단계', ilvl: 1700, gates: [{ g: 13500, bonus: 4320 }, { g: 16500, bonus: 5280 }] },
  { name: '세르카', diff: '나이트메어', ilvl: 1740, gates: [{ g: 21000, bonus: 6720 }, { g: 33000, bonus: 10560 }] },
  { name: '세르카', diff: '하드', ilvl: 1730, gates: [{ g: 17500, bonus: 5600 }, { g: 26500, bonus: 8480 }] },
  { name: '세르카', diff: '노말', ilvl: 1710, gates: [{ g: 13000, bonus: 4160 }, { g: 19000, bonus: 6080 }] },
  { name: '종막: 최후의 날', diff: '하드', ilvl: 1730, gates: [{ g: 16000, bonus: 5120 }, { g: 32000, bonus: 10240 }] },
  { name: '종막: 최후의 날', diff: '노말', ilvl: 1710, gates: [{ g: 11000, bonus: 3520 }, { g: 21000, bonus: 6720 }] },
  { name: '4막: 파멸의 성채', diff: '하드', ilvl: 1720, gates: [{ g: 13500, bonus: 4320 }, { g: 24500, bonus: 7840 }] },
  { name: '4막: 파멸의 성채', diff: '노말', ilvl: 1700, gates: [{ g: 10000, bonus: 3200 }, { g: 17000, bonus: 5440 }] },
  { name: '3막: 칠흑, 폭풍의 밤', diff: '하드', ilvl: 1700, gates: [{ g: 5000, bonus: 1650 }, { g: 8000, bonus: 2640 }, { g: 14000, bonus: 4060 }] },
  { name: '3막: 칠흑, 폭풍의 밤', diff: '노말', ilvl: 1680, gates: [{ g: 4000, bonus: 1300 }, { g: 7000, bonus: 2350 }, { g: 10000, bonus: 3360 }] },
  { name: '2막: 부유하는 악몽의 진혼곡', diff: '하드', ilvl: 1690, gates: [{ g: 7500, bonus: 2400 }, { g: 15500, bonus: 5100 }] },
  { name: '2막: 부유하는 악몽의 진혼곡', diff: '노말', ilvl: 1670, gates: [{ g: 5500, bonus: 1820 }, { g: 11000, bonus: 3720 }] },
  { name: '1막: 대지를 부수는 업화의 궤적', diff: '하드', ilvl: 1680, gates: [{ g: 5500, bonus: 1820 }, { g: 12500, bonus: 4150 }] },
  { name: '1막: 대지를 부수는 업화의 궤적', diff: '노말', ilvl: 1660, gates: [{ g: 3500, bonus: 750 }, { g: 8000, bonus: 1780 }] },
  { name: '서막: 에기르', diff: '싱글', ilvl: 1640, gates: [{ g: 2200, bonus: 720 }, { g: 5000, bonus: 1630 }] },
  { name: '베히모스', diff: '싱글', ilvl: 1640, gates: [{ g: 2200, bonus: 720 }, { g: 5000, bonus: 1630 }] },
];

export const totalGold = (raid) => raid.gates.reduce((sum, gate) => sum + gate.g, 0);
export const totalBonus = (raid) => raid.gates.reduce((sum, gate) => sum + gate.bonus, 0);
