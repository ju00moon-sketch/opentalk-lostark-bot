// 전투력 조회 전용: 제한된 병렬 요청, 짧은 성공 캐시, 취소 가능한 대기열.
const BASE_URL = 'https://developer-lostark.game.onstove.com';
const keyOf = (name) => String(name ?? '').trim().toLowerCase();
const validSiblings = (value) => Array.isArray(value)
  && value.every((row) => typeof row?.CharacterName === 'string' && row.CharacterName.trim());

function combatPower(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const text = String(value).trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(text)) return null;
  const number = Number(text.replaceAll(',', ''));
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

function waitFor(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

export function createPowerService({
  fetchImpl = (...args) => fetch(...args), now = Date.now,
  concurrency = 3, requestTimeoutMs = 3000, rosterTimeoutMs = 10000,
  cacheMs = 60000, maxEntries = 100,
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const rosterCache = new Map();
  const rosterPending = new Map();
  const queue = [];
  let active = 0;

  function cached(map, key) {
    const entry = map.get(key);
    if (entry?.expires > now()) return entry.value;
    map.delete(key);
    return undefined;
  }
  function remember(map, key, value) {
    map.delete(key);
    map.set(key, { value, expires: now() + cacheMs });
    while (map.size > maxEntries) map.delete(map.keys().next().value);
  }
  function drain() {
    while (active < concurrency && queue.length) {
      const entry = queue.shift();
      entry.signal.removeEventListener('abort', entry.abort);
      if (entry.signal.aborted) { entry.reject(entry.signal.reason); continue; }
      active++;
      entry.resolve(() => { active--; drain(); });
    }
  }
  function acquire(signal) {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal };
      entry.abort = () => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        reject(signal.reason);
      };
      signal.addEventListener('abort', entry.abort, { once: true });
      queue.push(entry);
      drain();
    });
  }
  async function request(path, parentSignal) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('전투력 조회 시간이 초과됐어요.')), requestTimeoutMs);
    const signal = AbortSignal.any([parentSignal, controller.signal]);
    let release;
    try {
      release = await acquire(signal);
      signal.throwIfAborted();
      const response = await fetchImpl(`${BASE_URL}${path}`, {
        headers: { accept: 'application/json', authorization: `bearer ${process.env.LOSTARK_API_KEY}` }, signal,
      });
      if (!response.ok) {
        const error = new Error(response.status === 429
          ? 'API 요청 한도(분당 100회)를 초과했어요. 잠시 후 다시 시도해 주세요.'
          : `로스트아크 API 오류 (HTTP ${response.status})`);
        error.status = response.status;
        throw error;
      }
      const value = await response.json();
      signal.throwIfAborted();
      return value;
    } finally {
      clearTimeout(timer);
      release?.();
    }
  }
  function read(path, signal) {
    if (signal?.aborted) return Promise.reject(signal.reason);
    const saved = cached(cache, path);
    if (saved !== undefined) return Promise.resolve(saved);
    let entry = pending.get(path);
    if (!entry || entry.controller.signal.aborted) {
      if (pending.size >= maxEntries) return Promise.reject(new Error('현재 조회 요청이 많아요. 잠시 후 다시 시도해 주세요.'));
      entry = { controller: new AbortController(), users: 0, done: false };
      const current = entry;
      entry.promise = request(path, entry.controller.signal).then((value) => {
        const valid = path.endsWith('/siblings') ? validSiblings(value)
          : keyOf(value?.CharacterName) === keyOf(decodeURIComponent(path.split('/').at(-2)));
        if (valid) remember(cache, path, value);
        return value;
      }).finally(() => {
        current.done = true;
        if (pending.get(path) === current) pending.delete(path);
      });
      pending.set(path, entry);
    }
    entry.users++;
    return waitFor(entry.promise, signal).finally(() => {
      entry.users--;
      if (!entry.users && !entry.done) entry.controller.abort(new Error('전투력 조회가 종료됐어요.'));
    });
  }
  const getProfile = (name, signal) => read(`/armories/characters/${encodeURIComponent(String(name).trim())}/profiles`, signal);

  async function loadRoster(profile) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('원정대 조회 시간이 초과됐어요.')), rosterTimeoutMs);
    const { signal } = controller;
    try {
      let siblings;
      try {
        siblings = await read(`/characters/${encodeURIComponent(profile.CharacterName)}/siblings`, signal);
        if (!validSiblings(siblings)) {
          throw new Error('원정대 목록 조회 실패');
        }
      } catch {
        return { status: 'unavailable', characters: [], total: null, failed: 0 };
      }
      const seen = new Set([keyOf(profile.CharacterName)]);
      const characters = [];
      for (const sibling of siblings) {
        const name = typeof sibling?.CharacterName === 'string' ? sibling.CharacterName.trim() : '';
        if (!name || seen.has(keyOf(name))) continue;
        seen.add(keyOf(name));
        characters.push({ name,
          className: typeof sibling.CharacterClassName === 'string' ? sibling.CharacterClassName : '-',
          serverName: typeof sibling.ServerName === 'string' ? sibling.ServerName : '-', combatPower: null, state: 'unavailable' });
      }
      let next = 0;
      await Promise.all(Array.from({ length: Math.min(concurrency, characters.length) }, async () => {
        while (next < characters.length && !signal.aborted) {
          const row = characters[next++];
          try {
            const found = await getProfile(row.name, signal);
            if (keyOf(found?.CharacterName) === keyOf(row.name)) {
              row.combatPower = combatPower(found?.CombatPower);
              row.state = row.combatPower === null ? 'missing' : 'available';
            }
          } catch { /* 실패 행도 남겨 조회되지 않은 캐릭터를 표시한다. */ }
        }
      }));
      characters.sort((a, b) => (b.combatPower ?? -1) - (a.combatPower ?? -1) || a.name.localeCompare(b.name, 'ko'));
      const failed = characters.filter((row) => row.state === 'unavailable').length;
      return { status: failed ? (failed === characters.length ? 'unavailable' : 'partial') : 'ok', characters, total: characters.length, failed };
    } finally { clearTimeout(timer); }
  }
  function getRoster(profile) {
    const key = keyOf(profile.CharacterName);
    const saved = cached(rosterCache, key);
    if (saved !== undefined) return Promise.resolve(saved);
    if (rosterPending.has(key)) return rosterPending.get(key);
    if (rosterPending.size >= maxEntries) return Promise.resolve({ status: 'unavailable', characters: [], total: null, failed: 0 });
    const promise = loadRoster(profile).then((result) => {
      if (result.status === 'ok') remember(rosterCache, key, result);
      return result;
    }).finally(() => rosterPending.delete(key));
    rosterPending.set(key, promise);
    return promise;
  }
  return { getProfile, getRoster };
}

const service = createPowerService();
export const getPowerProfile = service.getProfile;
export const getPowerRoster = service.getRoster;
