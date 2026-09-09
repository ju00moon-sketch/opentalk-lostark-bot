// 수요일에 게시된 공식 공지 전체를 그날 자정까지 휴대전화에 제공한다.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic } from '../json-store.js';

const STATE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'kakao-update-notify.json');
const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 100;
const MISSING = Symbol('missing');
const empty = () => ({ version: 1, ready: false, cursor: 0, events: [] });
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const kstDay = (ms) => Math.floor((ms + KST_MS) / DAY_MS);
const isWednesday = (ms) => new Date(ms + KST_MS).getUTCDay() === 3;

function noticeLink(value) {
  try {
    const url = new URL(value);
    if (url.origin !== 'https://lostark.game.onstove.com' || url.username || url.password) return null;
    const match = /^\/News\/Notice\/Views\/([1-9]\d*)\/?$/.exec(url.pathname);
    const id = Number(match?.[1]);
    return integer(id) && id > 0 ? { id, url: `${url.origin}/News/Notice/Views/${id}` } : null;
  } catch { return null; }
}

function normalizeNotice(notice, now) {
  if (!notice || typeof notice.Title !== 'string' || typeof notice.Date !== 'string') return null;
  const link = noticeLink(notice.Link);
  // 공식 API의 시간대 없는 ISO 일시는 한국 시간이다. 오프셋이 있으면 그대로 해석한다.
  if (!link || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})?$/.test(notice.Date)) return null;
  const calendarDay = Date.parse(`${notice.Date.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendarDay) || new Date(calendarDay).toISOString().slice(0, 10) !== notice.Date.slice(0, 10)
    || Number(notice.Date.slice(11, 13)) > 23) return null;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(notice.Date) ? notice.Date : `${notice.Date}+09:00`;
  const publishedAt = Date.parse(zoned);
  if (!Number.isFinite(publishedAt) || publishedAt > now) return null;
  const title = notice.Title.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 300);
  const type = typeof notice.Type === 'string'
    ? notice.Type.replace(/[\u0000-\u001f\u007f\[\]]/g, ' ').trim().slice(0, 20) || '공지' : '공지';
  return title ? { ...link, title, type, publishedAt } : null;
}

function validate(state) {
  if (!state || state.version !== 1 || typeof state.ready !== 'boolean' || !integer(state.cursor)
    || !Array.isArray(state.events) || state.events.length > MAX_EVENTS
    || (!state.ready && (state.cursor !== 0 || state.events.length))) throw new Error('카톡 업데이트 저장 형식 오류');
  let previous = 0;
  for (const event of state.events) {
    if (!event || !integer(event.id) || event.id <= previous || event.id > state.cursor
      || typeof event.text !== 'string' || event.text.length > 700
      || noticeLink(event.text.split('\n').at(-1))?.id !== event.id
      || !integer(event.expiresAt) || event.expiresAt === 0) throw new Error('카톡 업데이트 저장 항목 오류');
    previous = event.id;
  }
  return state;
}

export function createKakaoUpdateFeed({ storePath = STATE_PATH, now = Date.now } = {}) {
  let state;
  const load = () => {
    const disk = readJson(storePath, MISSING);
    if (disk !== MISSING) state = validate(disk);
    else state ??= empty();
    return state;
  };
  const active = (events, clock) => isWednesday(clock) ? events.filter((e) => e.expiresAt > clock) : [];
  return {
    ingest(notices) {
      const current = load();
      if (!Array.isArray(notices)) return;
      const clock = now();
      const parsed = notices.map((n) => normalizeNotice(n, clock)).filter(Boolean);
      if (!parsed.length) return;
      const cursor = Math.max(current.cursor, ...parsed.map((n) => n.id));
      const fresh = isWednesday(clock)
        ? parsed.filter((n) => n.id > current.cursor
          && isWednesday(n.publishedAt) && kstDay(n.publishedAt) === kstDay(clock)) : [];
      const events = new Map(active(current.events, clock).map((e) => [e.id, e]));
      for (const notice of fresh) {
        events.set(notice.id, {
          id: notice.id,
          text: `[${notice.type}] ${notice.title}\n${notice.url}`,
          expiresAt: (kstDay(notice.publishedAt) + 1) * DAY_MS - KST_MS,
        });
      }
      const next = { version: 1, ready: true, cursor, events: [...events.values()].sort((a, b) => a.id - b.id).slice(-MAX_EVENTS) };
      if (JSON.stringify(current) === JSON.stringify(next)) return;
      writeJsonAtomic(storePath, next);
      state = next; // 저장 실패 시 기준점과 새 이벤트를 확인한 것으로 치지 않는다.
    },
    snapshot() {
      const current = load();
      return { ...current, events: active(current.events, now()).map((event) => ({ ...event })) };
    },
  };
}

export const kakaoUpdateFeed = createKakaoUpdateFeed();
