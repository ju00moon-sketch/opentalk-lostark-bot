// 출석 체크 저장소 — 방마다 하루(한국 시간 자정 기준) 한 번 1~3P를 무작위로 주고 누적한다.
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

// v2: 방별 사용자 기록과, 방을 알 수 없는 기존 공통 기록을 함께 보관한다.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isEntry = (entry) => isObject(entry) && isCount(entry.points) && isCount(entry.count)
  && (entry.last === null || (typeof entry.last === 'string' && DATE_RE.test(entry.last)));
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;
// 한국 시간 연월로 나눈다. 월초에 봇이 꺼져 있어도 다음 조회/출석부터 새 달로 계산한다.
const isThisMonth = (entry, date) => entry.last?.slice(0, 7) === date.slice(0, 7);

function validateEntries(entries, storePath, withNames = false) {
  if (!isObject(entries)) throw new CorruptStoreError(storePath, new Error('사용자 기록이 객체가 아님'));
  for (const entry of Object.values(entries)) {
    if (!isEntry(entry) || (withNames && (typeof entry.name !== 'string' || !entry.name.trim()))) {
      throw new CorruptStoreError(storePath, new Error('출석 항목 형식 오류'));
    }
  }
}

function loadStore(storePath) {
  const store = readJson(storePath, {});
  if (!isObject(store)) throw new CorruptStoreError(storePath, new Error('루트가 객체가 아님'));
  if (store.version !== 2) {
    // 기존 기록에는 방 정보가 없다. 조회만으로 파일을 바꾸거나 어느 방에 적립하지 않는다.
    validateEntries(store, storePath);
    return { version: 2, rooms: {}, legacy: store };
  }
  if (!isObject(store.rooms) || !isObject(store.legacy)
    || Object.keys(store).some((key) => !['version', 'rooms', 'legacy'].includes(key))) {
    throw new CorruptStoreError(storePath, new Error('방별 저장 구조 오류'));
  }
  validateEntries(store.legacy, storePath);
  for (const entries of Object.values(store.rooms)) validateEntries(entries, storePath, true);
  return store;
}

function requireKey(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('방 이름과 사용자 식별자가 필요해요');
  return value.trim();
}

export function checkIn(userId, { roomName, name, now = Date.now, random = Math.random, storePath = STORE_PATH } = {}) {
  const room = requireKey(roomName);
  const id = requireKey(userId);
  const store = loadStore(storePath);
  const date = kstDate(now());
  const entries = own(store.rooms, room) ?? {};
  const entry = own(entries, id) ?? { points: 0, count: 0, last: null };
  if (entry.last === date) return { status: 'already', total: entry.points, count: entry.count, date };
  const totals = isThisMonth(entry, date) ? entry : { points: 0, count: 0 };
  const gained = rollPoints(random);
  const next = {
    name: typeof name === 'string' && name.trim() ? name.trim() : entry.name ?? id.replace(/^kakao:oc:/, ''),
    points: totals.points + gained, count: totals.count + 1, last: date,
  };
  if (!isEntry(next)) throw new RangeError('출석 포인트 또는 횟수의 저장 범위를 넘었어요');
  // 계산된 속성은 __proto__ 같은 방/사용자 이름도 일반 키로 저장한다.
  store.rooms = { ...store.rooms, [room]: { ...entries, [id]: next } };
  writeJsonAtomic(storePath, store);
  return { status: 'done', gained, total: next.points, count: next.count, date };
}

// 이번 달 출석 기록이 있는 참여자만 조회한다. 파일 생성이나 변환 저장은 하지 않는다.
export function getAttendanceStatus(roomName, { now = Date.now, storePath = STORE_PATH } = {}) {
  const room = requireKey(roomName);
  const store = loadStore(storePath);
  const date = kstDate(now());
  const members = Object.entries(own(store.rooms, room) ?? {})
    .filter(([, entry]) => isThisMonth(entry, date)).map(([userId, entry]) => ({
    userId, ...entry, attendedToday: entry.last === date,
  })).sort((a, b) => b.points - a.points || b.count - a.count
    || a.name.localeCompare(b.name, 'ko') || a.userId.localeCompare(b.userId, 'ko'));
  return { roomName: room, date, todayCount: members.filter((entry) => entry.attendedToday).length, members };
}
