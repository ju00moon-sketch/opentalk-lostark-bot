// 일자별 시세 기록 — "전일 대비"를 계산하려고 남기는 최소한의 저장소.
// 거래소 API(각인서 등)는 전일 평균가(YDayAvgPrice)를 주지만 경매장 API(보석)에는 전일 가격이 아예 없다.
// 그래서 보석은 조회할 때마다 그날의 최저가를 적어 두었다가 다음 날 비교한다.
// 배포는 src/만 갈아 끼우므로 다른 런타임 상태 파일과 같이 저장소 루트에 둔다.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic } from './json-store.js';

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'price-history.json');
const KEEP_DAYS = 3; // 전일 비교에 필요한 건 어제뿐 — 하루 이틀 봇이 쉬어도 되게 사흘만 남긴다

// 봇 서버 시간대가 UTC라 KST 기준으로 날짜를 끊는다. "2026-09-04" 형태.
export function kstDate(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 깨진 파일은 null — 그 회차는 기록도 비교도 건너뛴다. 빈 상태로 덮어쓰면 어제 기록이 사라진다.
function load() {
  try {
    return readJson(STORE_PATH, {});
  } catch (err) {
    console.error('시세 기록 파일 읽기 실패 — 이번 회차는 기록을 건너뜁니다:', err.message);
    return null;
  }
}

function save(store) {
  try {
    writeJsonAtomic(STORE_PATH, store, { pretty: false });
  } catch (err) {
    // 기록에 실패해도 시세 자체는 보여 줘야 하므로 삼킨다 (다음 조회 때 다시 시도된다)
    console.error('시세 기록 파일 쓰기 실패:', err.message);
  }
}

// 오늘 시세를 적고, 같은 키의 가장 최근 "이전 날짜" 기록을 돌려준다.
//   group   — 기록 묶음 이름 (예: '보석')
//   entries — { 키: 가격 }. 가격이 숫자가 아니면(매물 없음) 그날 기록은 건너뛴다.
// → { 키: { price, date } } — 이전 기록이 없는 키는 아예 빠진다.
export function recordAndCompare(group, entries) {
  const today = kstDate();
  const store = load();
  if (!store) return {};
  const bucket = store[group] ?? (store[group] = {});
  const baseline = {};
  let dirty = false;

  for (const [key, price] of Object.entries(entries)) {
    const days = bucket[key] ?? (bucket[key] = {});

    const prevDate = Object.keys(days).filter((date) => date < today).sort().pop();
    if (prevDate) baseline[key] = { price: days[prevDate], date: prevDate };

    // 오늘 값은 마지막으로 본 시세로 덮어쓴다 → 내일의 기준은 "어제 마지막 시세"가 된다
    if (Number.isFinite(price) && days[today] !== price) {
      days[today] = price;
      dirty = true;
    }

    const dates = Object.keys(days).sort();
    for (const old of dates.slice(0, Math.max(0, dates.length - KEEP_DAYS))) {
      delete days[old];
      dirty = true;
    }
  }

  if (dirty) save(store);
  return baseline;
}
