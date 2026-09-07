// 레이드 관문별 보스 체력 · 제한시간 · 공대장 택틱(연합군) 피해량.
// 출처: https://lopec.kr/tool/mvp (자료 2026-08-31, 벨가르딘 나메 체력 2026-09-07 재확인).
// hp·tactic은 원본 참고 자료로 보존하며 현재 딜지분·딜컷 계산에는 사용하지 않는다.
// 현재 계산 기준은 raid-cuts.js의 공개 딜컷이다. 비교 근거는 specs/2026-09-07-dealshare-basis-review.md 참고.
// 성당 2단계 원본 체력은 공개 컷의 역산 기준과 약 9% 다르며 원인은 미확정이다.
//   hp      — 관문 보스 총 체력
//   tactic  — 원본의 국룰 택틱 기본값 합계 (연합군 스킬이 넣는 딜).
//   time    — 관문 제한시간(초). DPS 기준 시간의 기본값.
// 1~3막은 lopec 계산기에서 빠져 있어 아직 미지원.
export const DATA_DATE = '2026-08-31';

export const RAID_HP = [
  { key: '4막 노말', raid: '4막', full: '4막: 파멸의 성채', diff: '노말', players: 8, gates: [
      { gate: 1, boss: '욕망의 주인, 에키드나', hp: 534719555981, tactic: 36130000000, time: 660 }, // (실드)니나브3+1, (무력)웨이3
      { gate: 2, boss: '심연의 파수꾼, 아르모체', hp: 678888288361, tactic: 116300000000, time: 900 }, // 바훈투르3+찐무1, 실리안3, 아제나3+1, 히든 바훈투르
  ] },
  { key: '4막 하드', raid: '4막', full: '4막: 파멸의 성채', diff: '하드', players: 8, gates: [
      { gate: 1, boss: '욕망의 주인, 에키드나', hp: 1044257090479, tactic: 111760000000, time: 660 }, // 실리안3+1, (실드)니나브3+1, (무력)웨이3
      { gate: 2, boss: '심연의 파수꾼, 아르모체', hp: 1347145643848, tactic: 221900000000, time: 900 }, // 아제나3, 바훈투르3+ 찐무 1, 실리안3+1, 히든 바훈투르
  ] },
  { key: '종막 노말', raid: '종막', full: '종막: 최후의 날', diff: '노말', players: 8, gates: [
      { gate: 1, boss: '심연의 군주, 카제로스', hp: 878436700620, tactic: 84500000000, time: 1080 }, // 샨디3, (실드)니나브3+1, 히든 웨이
      { gate: 2, boss: '대악마, 카제로스', hp: 762920268298, tactic: 27500000000, time: 960 }, // 카단3+1, 이난나3+1
  ] },
  { key: '종막 하드', raid: '종막', full: '종막: 최후의 날', diff: '하드', players: 8, gates: [
      { gate: 1, boss: '심연의 군주, 카제로스', hp: 1368776848584, tactic: 169600000000, time: 1080 }, // 샨디3, (실드)니나브3+1, 히든 웨이
      { gate: 2, boss: '대악마, 카제로스', hp: 2406298868972, tactic: 61420000000, time: 960 }, // 샨디3+1, 공아만3
  ] },
  { key: '세르카 노말', raid: '세르카', full: '세르카', diff: '노말', players: 4, gates: [
      { gate: 1, boss: '고통의 마녀, 세르카', hp: 369920517484, tactic: 0, time: 600 },
      { gate: 2, boss: '코르부스 툴 라크', hp: 476825758976, tactic: 0, time: 600 },
  ] },
  { key: '세르카 하드', raid: '세르카', full: '세르카', diff: '하드', players: 4, gates: [
      { gate: 1, boss: '고통의 마녀, 세르카', hp: 769567947570, tactic: 0, time: 600 },
      { gate: 2, boss: '코르부스 툴 라크', hp: 991969881687, tactic: 0, time: 600 },
  ] },
  { key: '세르카 나메', raid: '세르카', full: '세르카', diff: '나메', players: 4, gates: [
      { gate: 1, boss: '고통의 마녀, 세르카', hp: 1194141353268, tactic: 0, time: 600 },
      { gate: 2, boss: '코르부스 툴 라크', hp: 1539242432318, tactic: 0, time: 600 },
  ] },
  { key: '성당 1단계', raid: '성당', full: '지평의 성당', diff: '1단계', players: 4, gates: [
      { gate: 1, boss: '대주교, 아르세노스', hp: 331435324522, tactic: 0, time: 600 },
      { gate: 2, boss: '광신의 인도자, 아르세노스', hp: 312476622965, tactic: 0, time: 600 },
  ] },
  { key: '성당 2단계', raid: '성당', full: '지평의 성당', diff: '2단계', players: 4, gates: [
      { gate: 1, boss: '대주교, 아르세노스', hp: 791711996705, tactic: 0, time: 600 },
      { gate: 2, boss: '광신의 인도자, 아르세노스', hp: 765275689586, tactic: 0, time: 600 },
  ] },
  { key: '성당 3단계', raid: '성당', full: '지평의 성당', diff: '3단계', players: 4, gates: [
      { gate: 1, boss: '대주교, 아르세노스', hp: 1216576707098, tactic: 0, time: 600 },
      { gate: 2, boss: '광신의 인도자, 아르세노스', hp: 1197954508761, tactic: 0, time: 600 },
  ] },
  { key: '벨가르딘 노말', raid: '벨가르딘', full: '벨가르딘', diff: '노말', players: 8, gates: [
      { gate: 1, boss: '죽음의 계율자, 벨가르딘', hp: 1739316795458, tactic: 0, time: 600 },
      { gate: 2, boss: '페투스 안 크라그마', hp: 1950577229952, tactic: 0, time: 780 },
  ] },
  { key: '벨가르딘 하드', raid: '벨가르딘', full: '벨가르딘', diff: '하드', players: 8, gates: [
      { gate: 1, boss: '죽음의 계율자, 벨가르딘', hp: 2768565114395, tactic: 0, time: 600 },
      { gate: 2, boss: '페투스 안 크라그마', hp: 3133977387540, tactic: 0, time: 780 },
  ] },
  { key: '벨가르딘 나메', raid: '벨가르딘', full: '벨가르딘', diff: '나메', players: 8, gates: [
      { gate: 1, boss: '죽음의 계율자, 벨가르딘', hp: 4951627226525, tactic: 0, time: 600 },
      { gate: 2, boss: '페투스 안 크라그마', hp: 5605114847754, tactic: 0, time: 780 },
  ] },
];
