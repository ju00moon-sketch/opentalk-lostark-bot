// 후보 선택용 로펙 시세와 비용 재평가용 공식 시세를 수집한다. 계산은 호출자의 격리 프로세스가 맡는다.
import { searchAuctionItems, searchMarketItems } from './lostark.js';
import { getLopecEnhancementSnapshot, postLopecAuctionPrices } from './lopec.js';

export const API_BUDGET = 14;
const CACHE_MS = 5 * 60 * 1000;
const GEM_CATEGORY = 210000;
const ENGRAVING_CATEGORY = 40000;
const ENGRAVING_GRADES = new Set(['일반', '고급', '희귀', '영웅', '전설', '유물']);

// 재련 시세는 개당 골드. 파편은 대주머니의 내용물 3000개로 한 번 더 나눈다.
export const MATERIALS = {
  fragment: { name: '운명의 파편 주머니(대)', category: 50010, perBundleDivisor: 3000 },
  leapstone: { name: '운명의 돌파석', category: 50010 },
  'great-leapstone': { name: '위대한 운명의 돌파석', category: 50010 },
  fusion: { name: '아비도스 융화 재료', category: 50010 },
  'advanced-fusion': { name: '상급 아비도스 융화 재료', category: 50010 },
  'weapon-stone': { name: '운명의 파괴석', category: 50010 },
  'weapon-stone-crystal': { name: '운명의 파괴석 결정', category: 50010 },
  'armor-stone': { name: '운명의 수호석', category: 50010 },
  'armor-stone-crystal': { name: '운명의 수호석 결정', category: 50010 },
  'glacier-breath': { name: '빙하의 숨결', category: 50020 },
  'lava-breath': { name: '용암의 숨결', category: 50020 },
  '야금술 : 업화 [11-14]': { name: '야금술 : 업화 [11-14]', category: 50020 },
  '야금술 : 업화 [15-18]': { name: '야금술 : 업화 [15-18]', category: 50020 },
  '야금술 : 업화 [19-20]': { name: '야금술 : 업화 [19-20]', category: 50020 },
  '강화 야금술 : 업화 [19-20]': { name: '강화 야금술 : 업화 [19-20]', category: 50020 },
  '재봉술 : 업화 [11-14]': { name: '재봉술 : 업화 [11-14]', category: 50020 },
  '재봉술 : 업화 [15-18]': { name: '재봉술 : 업화 [15-18]', category: 50020 },
  '재봉술 : 업화 [19-20]': { name: '재봉술 : 업화 [19-20]', category: 50020 },
  '강화 재봉술 : 업화 [19-20]': { name: '강화 재봉술 : 업화 [19-20]', category: 50020 },
  '장인의 야금술 : 1단계': { name: '장인의 야금술 : 1단계', category: 50020 },
  '장인의 야금술 : 2단계': { name: '장인의 야금술 : 2단계', category: 50020 },
  '장인의 야금술 : 3단계': { name: '장인의 야금술 : 3단계', category: 50020 },
  '장인의 야금술 : 4단계': { name: '장인의 야금술 : 4단계', category: 50020 },
  '장인의 재봉술 : 1단계': { name: '장인의 재봉술 : 1단계', category: 50020 },
  '장인의 재봉술 : 2단계': { name: '장인의 재봉술 : 2단계', category: 50020 },
  '장인의 재봉술 : 3단계': { name: '장인의 재봉술 : 3단계', category: 50020 },
  '장인의 재봉술 : 4단계': { name: '장인의 재봉술 : 4단계', category: 50020 },
};

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const positive = (value) => Number.isFinite(value) && value > 0;
const validKey = (key) => !['__proto__', 'constructor', 'prototype'].includes(key);
const positivePrices = (prices) => Object.fromEntries(Object.entries(record(prices) ? prices : {})
  .filter(([key, value]) => validKey(key) && positive(value)));
const uniqueKeys = (keys) => [...new Set(keys.filter((key) => typeof key === 'string' && key.length > 0))];

// ISO 시각만 허용한다. multi의 일부가 깨지면 최소 시각을 확정할 수 없으므로 수집 시각으로 대체한다.
export function parseSnapshotTime(snapshotId) {
  if (typeof snapshotId !== 'string') return null;
  const parts = (snapshotId.startsWith('multi:') ? snapshotId.slice(6).split(',') : [snapshotId]).map((s) => s.trim());
  const times = parts.map((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(s) ? Date.parse(s) : NaN);
  return times.length && times.every(Number.isFinite) ? Math.min(...times) : null;
}

const defaultFetchers = {
  run(query) {
    const [kind, ...rest] = query.split(':');
    if (kind === 'auction') return searchAuctionItems(GEM_CATEGORY, rest.join(':'));
    const [category, name, extra] = [Number(rest[0]), rest.slice(1, -1).join(':'), rest.at(-1)];
    return searchMarketItems(category, name, category === ENGRAVING_CATEGORY ? { grade: extra } : { page: Number(extra) });
  },
};
const defaultLopec = { enhancement: getLopecEnhancementSnapshot, auction: postLopecAuctionPrices };
const apiCache = new Map();
const apiPending = new Map();
const lopecCache = new Map();
const lopecPending = new Map();

// 캐릭터가 달라도 전체 통신을 최대 2개로 제한한다. 대기 중인 같은 조회도 Promise를 공유한다.
let activeRequests = 0;
const requestQueue = [];
async function limited(load) {
  if (activeRequests >= 2) await new Promise((resolve) => requestQueue.push(resolve));
  else activeRequests += 1;
  try { return await load(); }
  finally {
    const next = requestQueue.shift();
    if (next) next();
    else activeRequests -= 1;
  }
}

// at은 통신 완료 시각이다. 캐시 적중이나 진행 중 요청을 공유한 호출에서는 갱신하지 않는다.
function shared(cache, pending, key, now, load, cacheable = () => true) {
  const hit = cache.get(key);
  if (hit && now() - hit.at >= 0 && now() - hit.at < CACHE_MS) return Promise.resolve(hit);
  cache.delete(key);
  if (pending.has(key)) return pending.get(key);
  const promise = Promise.resolve().then(load).then((value) => {
    const entry = { at: now(), value };
    if (pending.get(key) === promise && cacheable(value)) cache.set(key, entry);
    return entry;
  }).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
  pending.set(key, promise);
  return promise;
}

function readLopec(raw, field, allowEmpty) {
  if (!record(raw) || !record(raw.snapshot) || !record(raw.snapshot[field])
    || (raw.snapshot.snapshotId != null && typeof raw.snapshot.snapshotId !== 'string')
    || (raw.isStale != null && typeof raw.isStale !== 'boolean')
    || (raw.staleReason != null && typeof raw.staleReason !== 'string')) {
    throw new Error('로펙 시세 응답 형식 오류');
  }
  const prices = positivePrices(raw.snapshot[field]);
  if (!allowEmpty && Object.keys(prices).length === 0) throw new Error('로펙 시세가 비어 있어요');
  return {
    snapshot: { snapshotId: raw.snapshot.snapshotId ?? null, [field]: prices },
    isStale: Boolean(raw.isStale), staleReason: raw.staleReason ?? null,
    complete: Object.keys(prices).length === Object.keys(raw.snapshot[field]).length,
  };
}

// ① 후보 선택용. 강화는 전역, 거래는 중복 제거한 정렬 target 묶음으로 5분간 공유한다.
export async function getLopecSnapshots(targets, { now = Date.now, lopec = defaultLopec } = {}) {
  const sorted = uniqueKeys(targets).sort();
  const requests = [
    ['enhancement', 'prices', () => lopec.enhancement(), false],
    [`auction:${JSON.stringify(sorted)}`, 'pricesByTarget', () => lopec.auction(sorted), sorted.length === 0],
  ].map(([key, field, load, allowEmpty]) => shared(lopecCache, lopecPending, key, now,
    () => limited(async () => readLopec(await load(), field, allowEmpty)),
    (value) => value.complete && Object.keys(value.snapshot[field]).length > 0
      // 거래는 응답 값의 유효성뿐 아니라 요청한 target이 모두 들어 있는지도 확인한다.
      && (field !== 'pricesByTarget' || sorted.every((target) => positive(value.snapshot[field][target])))));
  const settled = await Promise.allSettled(requests);
  const failure = settled.find((r) => r.status === 'rejected');
  if (failure) throw failure.reason;
  const [enh, auc] = settled.map((r) => r.value);
  const timeByKey = {};
  const staleByKey = {};
  let stale = false;
  for (const [entry, field] of [[enh, 'prices'], [auc, 'pricesByTarget']]) {
    const originalAt = parseSnapshotTime(entry.value.snapshot.snapshotId);
    const isStale = entry.value.isStale || originalAt === null;
    stale ||= isStale;
    for (const key of Object.keys(entry.value.snapshot[field])) {
      timeByKey[key] = originalAt ?? entry.at;
      staleByKey[key] = isStale;
    }
  }
  return {
    enhancement: { ...enh.value.snapshot, prices: { ...enh.value.snapshot.prices } },
    auction: { ...auc.value.snapshot, pricesByTarget: { ...auc.value.snapshot.pricesByTarget } },
    timeByKey, staleByKey, stale,
    collectedAt: { enhancement: enh.at, auction: auc.at },
    staleReason: { enhancement: enh.value.staleReason, auction: auc.value.staleReason },
  };
}

const positiveMin = (values) => {
  const valid = values.filter(positive);
  return valid.length > 0 ? Math.min(...valid) : null;
};
const unitPrice = (item) => positive(item?.CurrentMinPrice) && Number.isSafeInteger(item?.BundleCount) && item.BundleCount > 0
  ? item.CurrentMinPrice / item.BundleCount : null;
const itemsOf = (response) => Array.isArray(response?.Items) ? response.Items : [];
const gemPrice = (response) => positiveMin(itemsOf(response).map((i) => i?.AuctionInfo?.BuyPrice));
const bookPrice = (response, name, grade) => positiveMin(itemsOf(response)
  .filter((i) => i?.Name === `${grade} ${name} 각인서` && i.Grade === grade).map(unitPrice));

// 캐시 가능 여부도 조회 조건 자체로 판정한다. 캐릭터별 요구 키를 쓰면 같은 페이지의 공유 결과가 달라진다.
function usableResponse(query, response) {
  if (query.startsWith('auction:')) return gemPrice(response) !== null;
  const [, category, ...rest] = query.split(':');
  if (Number(category) === ENGRAVING_CATEGORY) return bookPrice(response, rest.slice(0, -1).join(':'), rest.at(-1)) !== null;
  const items = itemsOf(response);
  // 일부 품목만 유효한 페이지도 저장하지 않아 누락 가격의 다음 조회를 막지 않는다.
  return items.length > 0 && items.every((i) => typeof i?.Name === 'string' && i.Name.length > 0 && positive(unitPrice(i)));
}

// ② 비용 재평가용. 조회 우선순위는 보석 → 각인서 → 재료 페이지, 악세는 로펙 시세를 유지한다.
export async function buildSnapshots(needs, lopecSnapshots, { fetchers = defaultFetchers, now = Date.now, budget = API_BUDGET } = {}) {
  const materialIds = uniqueKeys(needs.materialIds);
  const targets = uniqueKeys(needs.targets);
  const prices = positivePrices(lopecSnapshots.enhancement.prices);
  const pricesByTarget = positivePrices(lopecSnapshots.auction.pricesByTarget);
  const sourceByKey = {};
  const timeByKey = {};
  const staleByKey = {};
  const selected = new Map();
  const limit = Number.isFinite(budget) ? Math.min(API_BUDGET, Math.max(0, Math.floor(budget))) : API_BUDGET;
  let apiCalls = 0;

  const call = (query) => {
    if (selected.has(query)) return selected.get(query);
    // 캐시 적중·공유 대기도 선택 예산에 포함해 재호출 시 14개 밖의 조회로 확장되지 않게 한다.
    if (selected.size >= limit) return Promise.resolve(null);
    const promise = shared(apiCache, apiPending, query, now,
      () => limited(() => { apiCalls += 1; return fetchers.run(query); }),
      (value) => usableResponse(query, value)).catch(() => null);
    selected.set(query, promise);
    return promise;
  };
  const take = (key, value, entry, destination) => {
    if (!entry || !positive(value)) return false;
    destination[key] = value;
    sourceByKey[key] = 'api';
    timeByKey[key] = entry.at;
    staleByKey[key] = false;
    return true;
  };

  for (const target of targets) {
    const match = /^gem\.(겁화|작열|멸화|홍염)\.([1-9]|10)$/.exec(target);
    if (!match) continue;
    const entry = await call(`auction:${match[2]}레벨 ${match[1]}의 보석`);
    take(target, gemPrice(entry?.value), entry, pricesByTarget);
  }
  for (const target of targets.filter((t) => t.startsWith('market.engraving.'))) {
    const name = target.slice('market.engraving.'.length);
    const grade = needs.engravingGrades?.[target];
    if (!name || !ENGRAVING_GRADES.has(grade)) continue;
    const entry = await call(`market:${ENGRAVING_CATEGORY}:${name}:${grade}`);
    take(target, bookPrice(entry?.value, name, grade), entry, pricesByTarget);
  }
  const wanted = materialIds.filter((id) => Object.hasOwn(MATERIALS, id));
  for (const category of [...new Set(wanted.map((id) => MATERIALS[id].category))]) {
    const pendingIds = new Set(wanted.filter((id) => MATERIALS[id].category === category));
    for (let page = 1; pendingIds.size > 0; page += 1) {
      const entry = await call(`market:${category}::${page}`);
      const response = entry?.value;
      const items = itemsOf(response);
      if (items.length === 0) break;
      for (const id of pendingIds) {
        const material = MATERIALS[id];
        const value = positiveMin(items.filter((i) => i?.Name === material.name).map(unitPrice));
        if (take(id, value === null ? null : value / (material.perBundleDivisor ?? 1), entry, prices)) pendingIds.delete(id);
      }
      if (Number.isSafeInteger(response.TotalCount) && response.TotalCount >= 0
        && Number.isSafeInteger(response.PageSize) && response.PageSize > 0
        && page * response.PageSize >= response.TotalCount) break;
    }
  }

  const missing = [];
  for (const [keys, values, snapshot] of [[materialIds, prices, lopecSnapshots.enhancement], [targets, pricesByTarget, lopecSnapshots.auction]]) {
    for (const key of keys) {
      if (sourceByKey[key] === 'api') continue;
      if (!Object.hasOwn(values, key)) { missing.push(key); continue; }
      const originalAt = parseSnapshotTime(snapshot.snapshotId);
      const suppliedAt = lopecSnapshots.timeByKey?.[key];
      sourceByKey[key] = 'lopec';
      timeByKey[key] = Number.isFinite(suppliedAt) ? suppliedAt : (originalAt ?? now());
      const stale = record(lopecSnapshots.staleByKey) ? lopecSnapshots.staleByKey[key] : lopecSnapshots.stale;
      staleByKey[key] = Boolean(stale) || originalAt === null;
    }
  }
  const usedTimes = Object.values(timeByKey);
  return {
    enhancement: { snapshotId: lopecSnapshots.enhancement.snapshotId, prices },
    auction: { snapshotId: lopecSnapshots.auction.snapshotId, pricesByTarget },
    sourceByKey, timeByKey, staleByKey,
    marketAt: usedTimes.length > 0 ? Math.min(...usedTimes) : null,
    stale: Object.values(staleByKey).some(Boolean), apiCalls, missing,
  };
}

export const __test = { resetPriceCache: () => { apiCache.clear(); apiPending.clear(); lopecCache.clear(); lopecPending.clear(); } };
