// 크리스탈 시세 설정 — /스펙업이 페온 비용을 골드로 환산할 때 쓰는 "블루 크리스탈 95개의 골드 가격".
// 공식 오픈 API에도, 로펙에도 자동 시세가 없어(2026-09-06 조사 — 로펙은 사용자가 직접 입력) 길드원이 화폐거래소 값을 /크리스탈로 적어 둔다.
// 배포는 src/만 갈아 끼우므로 다른 런타임 상태 파일과 같이 저장소 루트에 둔다.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonLenient, writeJsonAtomic } from './json-store.js';

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'crystal-price.json');
export const MIN_PRICE = 1_000; // 95개 가격의 상식적 범위 — 오타(16 · 1662600)를 걸러 낸다
export const MAX_PRICE = 500_000;
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 이보다 오래된 설정은 갱신 안내를 붙인다

export const isValidPrice = (price95) => Number.isInteger(price95) && price95 >= MIN_PRICE && price95 <= MAX_PRICE;

// 페온 1개의 골드값 — 로펙 스펙업 가이드와 같은 환산(95개 가격 ÷ 95 × 8.5).
export const peonGold = (price95) => (price95 / 95) * 8.5;

export function createCrystalStore(path = STORE_PATH) {
  return {
    // { price95, at, by } 또는 null(미설정·깨진 파일·범위 밖).
    get() {
      const data = readJsonLenient(path, null, '크리스탈 시세 파일');
      if (!isValidPrice(data?.price95)) return null;
      return {
        price95: data.price95,
        at: Number.isFinite(data.at) ? data.at : null,
        by: typeof data.by === 'string' && data.by ? data.by : null,
      };
    },
    set(price95, by, now = Date.now()) {
      if (!isValidPrice(price95)) throw new RangeError(`크리스탈 가격은 ${MIN_PRICE.toLocaleString('ko-KR')}~${MAX_PRICE.toLocaleString('ko-KR')} 사이여야 해요`);
      const record = { price95, at: now, by: typeof by === 'string' && by.trim() ? by.trim().slice(0, 50) : null };
      writeJsonAtomic(path, record);
      return record;
    },
    isStale(setting = this.get(), now = Date.now()) {
      return setting !== null && (setting.at === null || now - setting.at > STALE_AFTER_MS);
    },
  };
}

export const crystalStore = createCrystalStore();
