// 떠돌이 상인 조회·집계 — 계약은 specs/2026-09-07-merchant-design.md 5절.
export const SERVERS = [
  { id: 1, name: '루페온' },
  { id: 2, name: '실리안' },
  { id: 3, name: '아만' },
  { id: 4, name: '아브렐슈드' },
  { id: 5, name: '카단' },
  { id: 6, name: '카마인' },
  { id: 7, name: '카제로스' },
  { id: 8, name: '니나브' },
];

const API = 'https://api.korlark.com/lostark/merchant';
const USER_AGENT = 'Pogeunhaeyong/1.2 (+https://ju00moon-sketch.github.io/opentalk-lostark-bot/)';
const REPORT_TTL = 60_000;
const SCHEME_TTL = 24 * 60 * 60_000;
const REQUEST_TIMEOUT = 5_000;
const DAY = 24 * 60 * 60_000;
const KST = 9 * 60 * 60_000;
// 클로아 공개 페이지의 Dd enum: Pending=0, Rejected=1, Accepted=2, Finalized=3.
// 승인·확정 제보만 사용한다. 과거 회차의 확정 제보도 시간 창 검사를 따로 거친다.
const NORMAL_STATUSES = new Set([2, 3]);
const cache = new Map();
const pending = new Map();

function requireValue(condition) {
  if (!condition) throw new Error('unexpected response shape');
}

const hasText = value => typeof value === 'string' && value.trim().length > 0;
const isId = value => hasText(value) || (Number.isSafeInteger(value) && value >= 0);
const byId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });

function timeValue(value, duration = false) {
  requireValue(typeof value === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(value));
  const [h, m, s] = value.split(':').map(Number);
  requireValue(h < 24 && m < 60 && s < 60);
  const ms = ((h * 60 + m) * 60 + s) * 1000;
  requireValue(!duration || ms > 0);
  return ms;
}

function timestamp(value) {
  requireValue(typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value));
  const ms = Date.parse(value);
  requireValue(Number.isFinite(ms));
  return ms;
}

function parseScheme(data) {
  requireValue(Array.isArray(data?.schedules) && data.schedules.length > 0 && Array.isArray(data?.regions) && data.regions.length > 0);
  const regions = data.regions.map(region => {
    requireValue(isId(region?.id) && hasText(region.name) && hasText(region.npcName) && Number.isInteger(region.group) && Array.isArray(region.items));
    const items = new Map(region.items.map(item => {
      requireValue(isId(item?.id) && hasText(item.name) && Number.isInteger(item.type) && Number.isInteger(item.grade) && item.grade >= 0);
      return [String(item.id), { name: item.name, kind: ({ 1: 'card', 2: 'rapport' })[item.type] ?? 'etc', grade: item.grade }];
    }));
    return { id: String(region.id), name: region.name, npcName: region.npcName, group: region.group, items };
  }).sort(byId);
  requireValue(new Set(regions.map(r => r.id)).size === regions.length);
  const schedules = data.schedules.map(schedule => {
    requireValue(Number.isInteger(schedule?.dayOfWeek) && schedule.dayOfWeek >= 0 && schedule.dayOfWeek <= 6 && Array.isArray(schedule.groups) && schedule.groups.length > 0);
    requireValue(schedule.groups.every(group => Number.isInteger(group) && regions.some(r => r.group === group)));
    return { day: schedule.dayOfWeek, start: timeValue(schedule.startTime), duration: timeValue(schedule.duration, true), groups: schedule.groups };
  });
  return { schedules, regions };
}

function parseReports(data) {
  requireValue(Array.isArray(data));
  return data.map(period => {
    const startsAt = timestamp(period?.startTime);
    const endsAt = timestamp(period?.endTime);
    requireValue(endsAt > startsAt && Array.isArray(period.reports));
    const reports = period.reports.map(report => {
      requireValue(Number.isInteger(report?.status) && isId(report.regionId) && Array.isArray(report.itemIds) && report.itemIds.every(isId));
      requireValue(Number.isSafeInteger(report.upVoteCount) && report.upVoteCount >= 0);
      return { status: report.status, regionId: String(report.regionId), itemIds: report.itemIds.map(String), upVotes: report.upVoteCount, reportedAt: timestamp(report.createdAt) };
    });
    return { startsAt, endsAt, reports };
  }).sort((a, b) => b.startsAt - a.startsAt);
}

function kstDay(now) {
  const shifted = now + KST;
  return { day: new Date(shifted).getUTCDay(), midnight: Math.floor(shifted / DAY) * DAY - KST };
}

function nextWindow(scheme, now) {
  const { day, midnight } = kstDay(now);
  let next = null;
  for (const schedule of scheme.schedules) {
    let startsAt = midnight + ((schedule.day - day + 7) % 7) * DAY + schedule.start;
    if (startsAt <= now) startsAt += 7 * DAY;
    if (!next || startsAt < next.startsAt) next = { startsAt, endsAt: startsAt + schedule.duration };
  }
  return next;
}

// 시간표만으로 지금 열려 있는 창을 찾는다(제보 응답과 무관). 창이 자정을 넘기므로 어제 시작한 회차도 본다.
function currentWindow(scheme, now) {
  for (const schedule of scheme.schedules) {
    for (const back of [0, 1]) {
      const { day, midnight } = kstDay(now - back * DAY);
      if (schedule.day !== day) continue;
      const startsAt = midnight + schedule.start;
      if (startsAt <= now && now < startsAt + schedule.duration) return { startsAt, endsAt: startsAt + schedule.duration };
    }
  }
  return null;
}

function reportExpiry(value, at, scheme) {
  let until = at + REPORT_TTL;
  const next = nextWindow(scheme, at);
  if (next) until = Math.min(until, next.startsAt);
  for (const period of value) {
    if (period.startsAt > at) until = Math.min(until, period.startsAt);
    if (period.endsAt > at) until = Math.min(until, period.endsAt);
  }
  return until;
}

// 서버별 원본 스냅샷을 공유해 전체 판↔상세 동시 조회도 서버당 한 번만 요청한다.
// 부분 실패한 판은 실패 서버만 재시도하고 성공한 서버의 실제 조회 시각을 유지한다.
function load(key, path, parse, expiry) {
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return Promise.resolve(cached);
  if (pending.has(key)) return pending.get(key);
  const task = (async () => {
    const controller = new AbortController();
    let timer;
    try {
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('request timeout'));
        }, REQUEST_TIMEOUT);
      });
      const value = await Promise.race([(async () => {
        const response = await fetch(`${API}/${path}`, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
        if (!response.ok) throw new Error('HTTP request failed');
        return parse(await response.json());
      })(), deadline]);
      const at = Date.now();
      const snapshot = { value, at, expiresAt: expiry(value, at) };
      cache.set(key, snapshot);
      return snapshot;
    } catch {
      cache.delete(key);
      return null;
    } finally {
      clearTimeout(timer);
      pending.delete(key);
    }
  })();
  pending.set(key, task);
  return task;
}

const loadScheme = () => load('scheme', 'scheme', parseScheme, (_, at) => at + SCHEME_TTL);
const loadReports = (id, scheme) => load(id, `reports?server=${id}`, parseReports, (value, at) => reportExpiry(value, at, scheme));
const currentPeriod = (snapshot, now) => snapshot.value.find(p => p.startsAt <= now && now < p.endsAt) ?? null;
const windowOf = period => period ? { startsAt: period.startsAt, endsAt: period.endsAt } : null;

function currentRegions(scheme, period) {
  if (!period) return [];
  const { day, midnight } = kstDay(period.startsAt);
  const matches = scheme.schedules.filter(s => s.day === day && midnight + s.start === period.startsAt && s.duration === period.endsAt - period.startsAt);
  if (!matches.length) {
    console.warn('[떠상] 현재 판매 창과 시간표 불일치 — 전체 대륙으로 집계');
    return scheme.regions;
  }
  const groups = new Set(matches.flatMap(s => s.groups));
  return scheme.regions.filter(r => groups.has(r.group));
}

function detailFor(server, snapshot, scheme, now) {
  const period = currentPeriod(snapshot, now);
  const regions = [];
  const unreportedRegions = [];
  const best = new Map();
  for (const report of period?.reports ?? []) {
    if (!NORMAL_STATUSES.has(report.status)) continue;
    const previous = best.get(report.regionId);
    if (!previous || report.upVotes > previous.upVotes || (report.upVotes === previous.upVotes && report.reportedAt > previous.reportedAt)) best.set(report.regionId, report);
  }
  for (const region of currentRegions(scheme, period)) {
    const report = best.get(region.id);
    if (!report) {
      unreportedRegions.push({ regionName: region.name, npcName: region.npcName });
      continue;
    }
    const items = report.itemIds.map(id => ({ ...(region.items.get(id) ?? { name: '알 수 없는 아이템', kind: 'etc', grade: 0 }) }));
    regions.push({ regionId: region.id, regionName: region.name, npcName: region.npcName, items, reportedAt: report.reportedAt, upVotes: report.upVotes });
  }
  return { ...server, fetchedAt: snapshot.at, window: windowOf(period), next: nextWindow(scheme, now), regions, unreportedRegions };
}

// 전설(grade 4)만 센다: 호감도는 아이템 수, 카드·기타는 이름(대륙 id 순, 중복 제거). 모르는 아이템은 grade 0이라 빠진다.
function summarize(server, detail) {
  const cards = new Set();
  const etc = new Set();
  let legendaryRapport = 0;
  let latestReportAt = null;
  for (const region of detail?.regions ?? []) {
    for (const item of region.items) {
      if (item.grade !== 4) continue;
      if (item.kind === 'rapport') legendaryRapport++;
      else if (item.kind === 'card') cards.add(item.name);
      else etc.add(item.name);
    }
    latestReportAt = Math.max(latestReportAt ?? -Infinity, region.reportedAt);
  }
  return { ...server, ok: detail !== null, legendaryRapport, legendaryCards: [...cards], legendaryEtc: [...etc], reportedRegions: detail?.regions.length ?? 0,
    totalRegions: detail ? detail.regions.length + detail.unreportedRegions.length : 0, latestReportAt };
}

export async function getMerchantBoard() {
  const scheme = await loadScheme();
  if (!scheme) return null;
  const snapshots = await Promise.all(SERVERS.map(server => loadReports(server.id, scheme.value)));
  if (snapshots.every(snapshot => !snapshot)) return null;
  const now = Date.now();
  const details = snapshots.map((snapshot, i) => snapshot ? detailFor(SERVERS[i], snapshot, scheme.value, now) : null);
  return {
    fetchedAt: Math.min(...snapshots.filter(Boolean).map(snapshot => snapshot.at)),
    window: details.find(detail => detail?.window)?.window ?? null,
    next: nextWindow(scheme.value, now),
    servers: SERVERS.map((server, i) => summarize(server, details[i])),
  };
}

// 알림 예약용: 시간표 기준 현재 창·다음 창. 시간표를 못 받으면 null.
export async function getMerchantWindows(now = Date.now()) {
  const scheme = await loadScheme();
  if (!scheme) return null;
  return { current: currentWindow(scheme.value, now), next: nextWindow(scheme.value, now) };
}

export async function getMerchantServer(serverId) {
  const server = SERVERS.find(server => server.id === serverId);
  if (!server) return null;
  const scheme = await loadScheme();
  if (!scheme) return null;
  const snapshot = await loadReports(server.id, scheme.value);
  return snapshot ? detailFor(server, snapshot, scheme.value, Date.now()) : null;
}
