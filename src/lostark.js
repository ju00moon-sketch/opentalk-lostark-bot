// 로스트아크 오픈 API 공용 모듈.
// 나중에 카카오톡 봇 등 다른 프론트엔드를 붙일 때도 이 모듈을 그대로 재사용한다.
const BASE_URL = 'https://developer-lostark.game.onstove.com';

async function request(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      accept: 'application/json',
      authorization: `bearer ${process.env.LOSTARK_API_KEY}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429) {
    throw new Error('API 요청 한도(분당 100회)를 초과했어요. 잠시 후 다시 시도해 주세요.');
  }
  if (!res.ok) {
    throw new Error(`로스트아크 API 오류 (HTTP ${res.status})`);
  }
  return res.json();
}

// 캐릭터 기본 프로필. 존재하지 않거나 비공개면 null.
export function getCharacterProfile(characterName) {
  return request(`/armories/characters/${encodeURIComponent(characterName)}/profiles`);
}

// 프로필+장비+각인+보석+카드 통합 조회. 존재하지 않거나 비공개면 null.
export function getArmory(characterName) {
  const filters = encodeURIComponent('profiles+equipment+engravings+gems+cards');
  return request(`/armories/characters/${encodeURIComponent(characterName)}?filters=${filters}`);
}

// 전투정보실 개별 항목 조회 (equipment, combat-skills, arkpassive, avatars, collectibles, gems, arkgrid).
export function getArmoryPart(characterName, part) {
  return request(`/armories/characters/${encodeURIComponent(characterName)}/${part}`);
}

// 같은 계정(원정대)의 캐릭터 목록. 조회 불가면 빈 배열.
export function getSiblings(characterName) {
  return request(`/characters/${encodeURIComponent(characterName)}/siblings`);
}

// 주간 콘텐츠 캘린더 (모험 섬 포함).
export function getCalendar() {
  return request('/gamecontents/calendar');
}

// 거래소 카테고리 목록.
export function getMarketOptions() {
  return request('/markets/options');
}

// 거래소 아이템 검색 (부분 일치 지원). opts: { grade: '유물', order: 'DESC' }
export function searchMarketItems(categoryCode, itemName, opts = {}) {
  return request('/markets/items', {
    Sort: 'CURRENT_MIN_PRICE',
    CategoryCode: categoryCode,
    ItemName: itemName,
    ItemGrade: opts.grade ?? null,
    PageNo: 1,
    SortCondition: opts.order ?? 'ASC',
  });
}

// 진행 중인 이벤트 목록.
export function getEvents() {
  return request('/news/events');
}

// 공식 공지사항 목록.
export function getNotices() {
  return request('/news/notices');
}

// 경매장 검색 (보석 등).
export function searchAuctionItems(categoryCode, itemName) {
  return request('/auctions/items', {
    ItemLevelMin: 0,
    ItemLevelMax: 0,
    ItemGradeQuality: null,
    Sort: 'BUY_PRICE',
    CategoryCode: categoryCode,
    ItemTier: null,
    ItemName: itemName,
    PageNo: 1,
    SortCondition: 'ASC',
  });
}
