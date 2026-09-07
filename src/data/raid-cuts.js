// 공개 딜컷 스냅샷. 각 관문은 [강투, 1인분, 잔혈], 단위는 억이다.
// 상세표의 세 컷은 각각의 공개 값을 보존하며 다른 컷에서 재계산하지 않는다.
// 출처: https://docs.google.com/spreadsheets/d/1v4gfG-Lr0iFmiP0PXtVTsijdMziekQaZ-wBTWrobncY/edit#gid=0
// 화면: https://loaviewer.github.io/ (상세표 우선, 없는 4막·종막은 간편보기)
// 4막·종막 원본: https://loaviewer.github.io/js/index.js 의 simpleData 상수.
// 아래 AE 셀은 같은 값의 대조 위치이며 사이트가 읽는 데이터는 JS 상수다.
// 4막·종막 1인분은 사이트 js/index.js의 parseSimpleRangeParts와 동일하게
// Math.round((잔혈 / 0.2 / 6) / 10) * 10으로 계산된 값이다(oneDerived).
// 종막 하드는 현행 간편보기가 사용하는 AE160·AE161 값을 따른다.
// 자료 선택·불일치 기록: specs/2026-09-07-dealshare-basis-review.md
export const DATA_DATE = '2026-09-07';

export const CUTS = {
  4: [{ short: '강투', title: '강직한 투사', ratio: 0.3 }, { short: '1인분' }, { short: '잔혈', title: '잔혹한 혈투사', ratio: 0.4 }],
  8: [{ short: '강투', title: '강직한 투사', ratio: 0.15 }, { short: '1인분' }, { short: '잔혈', title: '잔혹한 혈투사', ratio: 0.2 }],
};
export const BASE_TITLE = '투사';

export const RAID_CUTS = {
  '4막 노말': { oneRatio: 1 / 6, oneDerived: true, gates: [
    [740, 830, 990], // simpleData 309행 · AE24
    [950, 1060, 1270], // simpleData 310행 · AE25
  ] },
  '4막 하드': { oneRatio: 1 / 6, oneDerived: true, gates: [
    [1425, 1580, 1900], // simpleData 332행 · AE44
    [1575, 1750, 2100], // simpleData 333행 · AE45
  ] },
  '종막 노말': { oneRatio: 1 / 6, oneDerived: true, gates: [
    [1190, 1330, 1590], // simpleData 293행 · AE8
    [1050, 1170, 1400], // simpleData 294행 · AE9
  ] },
  '종막 하드': { oneRatio: 1 / 6, oneDerived: true, gates: [
    [2025, 2250, 2700], // simpleData 379행 · AE160
    [3375, 3740, 4490], // simpleData 380행 · AE161
  ] },
  '세르카 노말': { oneRatio: 0.33, oneDerived: false, gates: [
    [1110, 1221, 1480], // D42·D45·D52
    [1430, 1574, 1907], // G42·G45·G52
  ] },
  '세르카 하드': { oneRatio: 0.33, oneDerived: false, gates: [
    [2309, 2540, 3078], // L42·L45·L52
    [2976, 3274, 3968], // O42·O45·O52
  ] },
  '세르카 나메': { oneRatio: 0.33, oneDerived: false, gates: [
    [3582, 3941, 4777], // T42·T45·T52
    [4618, 5080, 6157], // W42·W45·W52
  ] },
  '성당 1단계': { oneRatio: 0.33, oneDerived: false, gates: [
    [994, 1094, 1326], // D10·D13·D20
    [937, 1031, 1250], // G10·G13·G20
  ] },
  '성당 2단계': { oneRatio: 0.33, oneDerived: false, gates: [
    [2161, 2377, 2882], // L10·L13·L20
    [2089, 2298, 2786], // O10·O13·O20
  ] },
  '성당 3단계': { oneRatio: 0.33, oneDerived: false, gates: [
    [3650, 4015, 4866], // T10·T13·T20
    [3594, 3953, 4792], // W10·W13·W20
  ] },
  '벨가르딘 노말': { oneRatio: 0.166, oneDerived: false, gates: [
    [2601, 2879, 3469], // D675·D677·D681
    [2917, 3228, 3889], // G675·G677·G681
  ] },
  '벨가르딘 하드': { oneRatio: 0.166, oneDerived: false, gates: [
    [4142, 4584, 5523], // L675·L677·L681
    [4689, 5189, 6252], // O675·O677·O681
  ] },
  '벨가르딘 나메': { oneRatio: 0.166, oneDerived: false, gates: [
    [7412, 8203, 9883], // T675·T677·T681
    [8391, 9286, 11188], // W675·W677·W681
  ] },
};
