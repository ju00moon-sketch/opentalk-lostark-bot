// 로아툴 일봉의 마지막 종가(블루 크리스탈 95개의 골드 가격)를 시작 시·매일 08:00 KST에 저장한다.
import { crystalStore, isValidPrice } from './crystal-price.js';

export const SOURCE_URL = 'https://loatool.taeu.kr/api/crystal-history/ohlc/1d';
export const REFRESH_HOUR_KST = 8;
export const RETRY_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET = 9 * 60 * 60 * 1000;
const TIMEOUT_MS = 5000;
const USER_AGENT = 'Pogeunhaeyong/1.2 (+https://ju00moon-sketch.github.io/opentalk-lostark-bot/)';
const fail = (error) => ({ value: null, error });

// 오류 사유를 내부 결과로 돌려 단독 조회와 예약 실행 모두 로그를 한 번만 남긴다.
async function readPrice() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(SOURCE_URL, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return fail(`HTTP ${response.status}`);
    const data = await response.json(); // 본문을 다 읽을 때까지 시간 제한을 유지한다.
    if (!Array.isArray(data) || data.length === 0) return fail('비어 있거나 잘못된 시세 목록');
    const last = data.at(-1);
    if (!Number.isFinite(last?.close)) return fail('종가가 유한수가 아님');
    const price95 = Math.round(last.close);
    if (!isValidPrice(price95)) return fail('종가가 허용 범위 밖');
    if (typeof last.dt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(last.dt)) {
      return fail('캔들 시각 형식 오류');
    }
    const candleAt = Date.parse(`${last.dt}+09:00`);
    const age = Date.now() - candleAt;
    if (!Number.isFinite(candleAt)
      || new Date(candleAt + KST_OFFSET).toISOString().slice(0, 19) !== last.dt
      || age < 0 || age > 3 * DAY_MS) return fail('캔들 시각이 잘못됐거나 3일보다 오래됨');
    return { value: { price95, candleAt }, error: null };
  } catch (error) {
    // 응답 본문·예외 전문은 남기지 않는다.
    return fail(controller.signal.aborted ? '5초 조회 제한 초과'
      : error instanceof SyntaxError ? '응답 JSON 형식 오류' : '네트워크 조회 실패');
  } finally {
    clearTimeout(timer);
    controller.abort(); // HTTP 오류 등으로 읽지 않은 본문도 정리한다.
  }
}

export async function fetchCrystalPrice95() {
  const { value, error } = await readPrice();
  if (error) console.error(`크리스탈 자동 갱신: ${error}`);
  return value;
}

function msUntilNextKst(at) {
  const kst = at + KST_OFFSET;
  let target = Math.floor(kst / DAY_MS) * DAY_MS + REFRESH_HOUR_KST * 60 * 60 * 1000;
  if (target <= kst) target += DAY_MS;
  return target - kst;
}

export function startCrystalAutoRefresh({
  store = crystalStore, fetchPrice = fetchCrystalPrice95, setTimer = setTimeout, now = Date.now,
} = {}) {
  let stopped = false;
  let timer = null;

  const run = async () => {
    timer = null;
    if (stopped) return;
    let success = false;
    let message = '조회 실패';
    try {
      const result = fetchPrice === fetchCrystalPrice95
        ? await readPrice()
        : { value: await fetchPrice(), error: null };
      if (stopped) return;
      if (!result.value) {
        message = result.error ?? '시세를 받지 못함';
      } else {
        message = '저장 실패';
        // 조회 도중 수동 설정이 들어올 수 있으므로 저장하는 시점에 우선권을 판정한다.
        const saved = store.setAuto(result.value.price95, now());
        if (saved.saved) {
          success = true;
          message = `95개 ${result.value.price95.toLocaleString('ko-KR')}G 저장 (로아툴)`;
        } else if (saved.reason === 'manual-recent') {
          success = true;
          message = '직접 설정 24시간 우선으로 건너뜀 (manual-recent)';
        }
      }
    } catch {
      // 조회·저장 실패 모두 마지막 정상값을 지우지 않고 재시도한다.
    } finally {
      if (stopped) {
        console.log('크리스탈 자동 갱신: 중단됨');
      } else {
        if (success) console.log(`크리스탈 자동 갱신: ${message}`);
        else console.error(`크리스탈 자동 갱신: ${message}`);
        const regular = msUntilNextKst(now());
        timer = setTimer(run, success ? regular : Math.min(RETRY_MS, regular));
        timer?.unref?.();
      }
    }
  };

  void run();
  return {
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    },
  };
}
