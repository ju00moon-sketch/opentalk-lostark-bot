// 티어 4 광휘 보석 수치. 단위는 퍼센트 숫자이며 32는 32%를 뜻한다.
// 확인일: 2026-09-07.
// 피해·쿨감: 공식 경매장 API /auctions/items, 각 레벨 겁화·작열 Options.Value.
// https://developer-lostark.game.onstove.com/auctions/items
// 기본 공격력: 공식 보석 가이드(6·8·9), 전투정보실 보석 툴팁(2·5~10).
// https://lostark.game.onstove.com/GameGuide/Pages/보석
// https://developer-lostark.game.onstove.com/armories/characters/{name}/gems
// 1레벨은 기본 공격력 효과 없음: 2024-07-10 공식 업데이트 안내.
// https://lostark.game.onstove.com/News/Notice/Views/12819
// 3~4레벨 공격력은 공식 툴팁 검증 진행 중이므로 추정하지 않고 null로 둔다.
export const GEM_STATS = {
  1: { damagePercent: 8, cooldownPercent: 6, attackPercent: 0 },
  2: { damagePercent: 12, cooldownPercent: 8, attackPercent: 0.05 },
  3: { damagePercent: 16, cooldownPercent: 10, attackPercent: null },
  4: { damagePercent: 20, cooldownPercent: 12, attackPercent: null },
  5: { damagePercent: 24, cooldownPercent: 14, attackPercent: 0.3 },
  6: { damagePercent: 28, cooldownPercent: 16, attackPercent: 0.45 },
  7: { damagePercent: 32, cooldownPercent: 18, attackPercent: 0.6 },
  8: { damagePercent: 36, cooldownPercent: 20, attackPercent: 0.8 },
  9: { damagePercent: 40, cooldownPercent: 22, attackPercent: 1 },
  10: { damagePercent: 44, cooldownPercent: 24, attackPercent: 1.2 },
};
