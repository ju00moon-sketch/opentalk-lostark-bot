// 크리스탈 시세 — /스펙업이 페온 비용을 골드로 환산할 때 쓰는 "블루 크리스탈 95개의 골드 가격".
// 공식 오픈 API·로펙에는 자동 시세가 없고(2026-09-06 조사 — 로펙은 사용자가 직접 입력), 로아툴(LOSPI)의 일봉 API가 인증 없이
// 열려 있어(2026-09-07 조사) src/crystal-auto.js가 매일 08:00 KST에 자동으로 적는다(source 'auto').
// 길드원이 /크리스탈로 직접 적은 값(source 'manual')은 24시간 동안 자동 갱신보다 우선한다.
// 배포는 src/만 갈아 끼우므로 다른 런타임 상태 파일과 같이 저장소 루트에 둔다.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonLenient, writeJsonAtomic } from './json-store.js';

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'crystal-price.json');
export const MIN_PRICE = 1_000; // 95개 가격의 상식적 범위 — 오타(16 · 1662600)를 걸러 낸다
export const MAX_PRICE = 500_000;
export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 이보다 오래된 값은 갱신 안내를 붙인다
export const MANUAL_HOLD_MS = 24 * 60 * 60 * 1000; // 직접 적은 값이 자동 갱신보다 우선하는 시간
export const AUTO_LABEL = '로아툴'; // 자동 갱신 값의 by(출처 표시)

export const isValidPrice = (price95) => Number.isInteger(price95) && price95 >= MIN_PRICE && price95 <= MAX_PRICE;

// 페온 1개의 골드값 — 로펙 스펙업 가이드와 같은 환산(95개 가격 ÷ 95 × 8.5).
export const peonGold = (price95) => (price95 / 95) * 8.5;

const rangeError = () => new RangeError(`크리스탈 가격은 ${MIN_PRICE.toLocaleString('ko-KR')}~${MAX_PRICE.toLocaleString('ko-KR')} 사이여야 해요`);

export function createCrystalStore(path = STORE_PATH) {
  const store = {
    // { price95, at, by, source: 'manual' | 'auto' } 또는 null(미설정·깨진 파일·범위 밖). source가 없는 옛 파일은 수동 설정으로 본다.
    get() {
      const data = readJsonLenient(path, null, '크리스탈 시세 파일');
      if (!isValidPrice(data?.price95)) return null;
      return {
        price95: data.price95,
        at: Number.isFinite(data.at) ? data.at : null,
        by: typeof data.by === 'string' && data.by ? data.by : null,
        source: data.source === 'auto' ? 'auto' : 'manual',
      };
    },
    // /크리스탈 직접 설정 — 항상 저장하며 24시간 동안 자동 갱신보다 우선한다.
    set(price95, by, now = Date.now()) {
      if (!isValidPrice(price95)) throw rangeError();
      const record = { price95, at: now, by: typeof by === 'string' && by.trim() ? by.trim().slice(0, 50) : null, source: 'manual' };
      writeJsonAtomic(path, record);
      return record;
    },
    // 자동 갱신(src/crystal-auto.js) — 24시간 안에 직접 적은 값이 있으면 덮지 않는다.
    // 반환: { saved: true, record } 또는 { saved: false, reason: 'manual-recent', record: 현재값 }.
    setAuto(price95, now = Date.now(), label = AUTO_LABEL) {
      if (!isValidPrice(price95)) throw rangeError();
      const current = store.get();
      if (current?.source === 'manual' && current.at !== null && now - current.at < MANUAL_HOLD_MS) {
        return { saved: false, reason: 'manual-recent', record: current };
      }
      const record = { price95, at: now, by: label, source: 'auto' };
      writeJsonAtomic(path, record);
      return { saved: true, record };
    },
    isStale(setting = store.get(), now = Date.now()) {
      return setting !== null && (setting.at === null || now - setting.at > STALE_AFTER_MS);
    },
  };
  return store;
}

export const crystalStore = createCrystalStore();
