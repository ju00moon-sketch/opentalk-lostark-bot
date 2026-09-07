// 출석 체크 저장소 — 하루(한국 시간 자정 기준) 한 번 1~3P를 무작위로 주고 누적한다.
// user-links.json과 같은 방식으로 루트 attendance.json에 저장해 배포(src/ 교체)에도 유지된다.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic, CorruptStoreError } from './json-store.js';

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'attendance.json');
const KST_OFFSET = 9 * 60 * 60 * 1000;
export const POINT_MIN = 1;
export const POINT_MAX = 3;

// epoch ms → 한국 시간 날짜 'YYYY-MM-DD'
export const kstDate = (ms) => new Date(ms + KST_OFFSET).toISOString().slice(0, 10);

// 1·2·3을 같은 확률로. random은 [0, 1) 값을 주는 함수(테스트에서 주입).
export const rollPoints = (random = Math.random) => POINT_MIN + Math.floor(random() * (POINT_MAX - POINT_MIN + 1));

// { userId: { points, count, last } }. 깨진 파일은 readJson이 CorruptStoreError를 던져 저장을 막는다(빈 상태로 덮어쓰면 기록 전부가 날아간다).
// 파싱은 되지만 구조가 다른 파일(배열 루트, 문자열 points 등)도 같은 이유로 손상으로 본다 — 배열 위에 저장하면 기록이 사라지고, '5' + 2는 '52'가 된다.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isCount = (n) => Number.isInteger(n) && n >= 0;
const isEntry = (e) => e && typeof e === 'object' && !Array.isArray(e) && isCount(e.points) && isCount(e.count) && (e.last === null || (typeof e.last === 'string' && DATE_RE.test(e.last)));
function loadStore(storePath) {
  const store = readJson(storePath, {});
  if (!store || typeof store !== 'object' || Array.isArray(store)) throw new CorruptStoreError(storePath, new Error('루트가 객체가 아님'));
  for (const [id, entry] of Object.entries(store)) {
    if (!isEntry(entry)) throw new CorruptStoreError(storePath, new Error(`항목 형식 오류: ${id}`));
  }
  return store;
}

export function checkIn(userId, { now = Date.now, random = Math.random, storePath = STORE_PATH } = {}) {
  const store = loadStore(storePath);
  const date = kstDate(now());
  const entry = store[userId] ?? { points: 0, count: 0, last: null };
  if (entry.last === date) return { status: 'already', total: entry.points, count: entry.count, date };
  const gained = rollPoints(random);
  const next = { points: entry.points + gained, count: entry.count + 1, last: date };
  store[userId] = next;
  writeJsonAtomic(storePath, store);
  return { status: 'done', gained, total: next.points, count: next.count, date };
}
