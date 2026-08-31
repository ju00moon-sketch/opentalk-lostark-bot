// 아이덴티티(Z키)처럼 전투정보실 API 툴팁에 나오지 않는 직업 고유 치명타 적중률.
// 상시로 도는 값이 아니라 발동 중에만 붙으므로 /치적에서는 "추가 치명타 확률"로 따로 보여 준다.
//
// class는 전투정보실의 직업명, node는 그 빌드를 가르는 깨달음 아크패시브 노드 이름이다.
// (직업 각인마다 아이덴티티 효과가 달라서 노드까지 맞춰야 오탐이 없다.)
// 확인된 것만 넣는다 — 수치를 모르는 직업은 비워 두면 그 줄이 안 나올 뿐이다.
export const IDENTITY_CRIT = [
  {
    class: '슬레이어',
    node: '포식자',
    label: '포식자',
    crit: 30,
    note: '폭주 상태에서 치명타 적중률 +30%',
  },
];

// 캐릭터의 직업·깨달음 노드에 해당하는 항목을 찾는다. 없으면 null.
export function findIdentityCrit(className, nodeNames) {
  return (
    IDENTITY_CRIT.find(
      (entry) => entry.class === className && nodeNames.some((n) => n.includes(entry.node)),
    ) ?? null
  );
}
