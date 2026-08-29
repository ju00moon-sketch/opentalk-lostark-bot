// 지옥/나락 강하 선택 추천 경로.
// 배열은 최상층부터 [7]→[1] 순서. 데이터가 없는 조합은 null (커맨드가 안내 메시지를 띄운다).
// ⚠️ 아래 지옥-전설 경로는 길드장이 제공한 예시 — 지옥 것이 맞는지 확인 필요.
export const DATA_DATE = '2026-08-29';

export const GRADES = [
  { value: '전설', label: '전설 (7회)', floors: 7 },
  { value: '영웅', label: '영웅 (6회)', floors: 6 },
  { value: '희귀', label: '희귀 (5회)', floors: 5 },
];

export const DESCENT = {
  지옥: {
    전설: ['오른쪽', '오른쪽', '왼쪽', '오른쪽', '왼쪽', '오른쪽', '왼쪽'],
    영웅: null,
    희귀: null,
  },
  나락: {
    전설: null,
    영웅: null,
    희귀: null,
  },
};
