// lopec.kr에서 공식 API에 없는 지표를 가져온다 (환산 점수·순위·팔찌 효율).
// 서버 렌더링된 HTML을 읽으므로 사이트 개편에 깨질 수 있다. 실패하면 null을 돌려주고
// 커맨드는 해당 부분만 빼고 정상 출력한다.
const BASE_URL = 'https://lopec.kr';
const CACHE_MS = 5 * 60 * 1000;

const pageCache = new Map();
const efficiencyCache = new Map();

export const BACKSLASH = String.fromCharCode(92);

export async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; OpenTalkBot/1.0)' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// 문자열과 중첩 괄호를 건너뛰며 여는 괄호의 짝을 찾는다.
export function matchBrace(source, openIndex) {
  let depth = 0;
  let quote = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === BACKSLASH) i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Next.js가 조각내어 심어 둔 flight 페이로드를 원래 문자열로 이어 붙인다.
export function flightPayload(html) {
  const marker = 'self.__next_f.push([1,"';
  let payload = '';
  let cursor = 0;
  for (;;) {
    const start = html.indexOf(marker, cursor);
    if (start === -1) break;
    let i = start + marker.length;
    let raw = '';
    while (i < html.length && html[i] !== '"') {
      if (html[i] === BACKSLASH) {
        raw += html[i] + html[i + 1];
        i += 2;
        continue;
      }
      raw += html[i];
      i += 1;
    }
    try {
      payload += JSON.parse(`"${raw}"`);
    } catch {
      // 조각 하나가 깨져도 나머지로 계속 시도한다
    }
    cursor = i + 1;
  }
  return payload;
}

// key 바로 뒤에 오는 객체를 파싱한다 (예: '"lostarkParser":').
export function objectAfter(payload, key) {
  const at = payload.indexOf(key);
  if (at === -1) return null;
  const open = payload.indexOf('{', at);
  const close = matchBrace(payload, open);
  if (close === -1) return null;
  try {
    return JSON.parse(payload.slice(open, close + 1));
  } catch {
    return null;
  }
}

// key를 품고 있는 객체를 파싱한다. 객체가 startsWith로 시작한다는 걸 알고 있을 때 쓴다.
function objectContaining(payload, key, startsWith) {
  const at = payload.indexOf(key);
  if (at === -1) return null;
  const open = payload.lastIndexOf(startsWith, at);
  if (open === -1) return null;
  const close = matchBrace(payload, open);
  if (close === -1 || close < at) return null;
  try {
    return JSON.parse(payload.slice(open, close + 1));
  } catch {
    return null;
  }
}

// 캐릭터 페이지 HTML (5분 캐시) — /로펙과 /팔찌가 같이 쓴다.
export async function getSpecPointHtml(characterName) {
  const hit = pageCache.get(characterName);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.html;
  const html = await fetchText(
    `${BASE_URL}/character/specPoint/${encodeURIComponent(characterName)}`,
  );
  pageCache.set(characterName, { at: Date.now(), html });
  return html;
}

// 로펙 환산 점수와 순위. 조회 실패·미갱신 캐릭터면 null.
export async function getLopecScore(characterName) {
  try {
    const payload = flightPayload(await getSpecPointHtml(characterName));
    const summary = objectContaining(payload, '"specPoint":', '{"name":"');
    if (!summary?.specPoint) return null;
    return {
      ...summary,
      combatPower: objectAfter(payload, '"stats":')?.combatPower ?? null,
      // 달성 최고 점수 — 로펙 DB에 저장된 이 캐릭터의 최고 환산 점수. 로펙 랭킹(classRank 등)의 기준값이고,
      // 현재 specPoint는 장비를 옮겨 뒀거나 로펙이 보석을 못 읽었을 때 훨씬 낮게 나올 수 있다.
      dbScore: Number(/"dbScore":([\d.]+)/.exec(payload)?.[1]) || null,
      median: Number(/"nowMedian":([\d.]+)/.exec(payload)?.[1]) || null,
      gemMedian: Number(/"arkgridGemMedian":([\d.]+)/.exec(payload)?.[1]) || null,
      cardData: objectAfter(payload, '"cardData":'),
    };
  } catch (err) {
    console.error('[로펙 점수]', err.message);
    return null;
  }
}

// idx를 감싸는 가장 안쪽 { … } 객체를 파싱한다 (뒤로 훑어 여는 괄호를 찾고 matchBrace로 닫는다).
function enclosingObject(payload, idx) {
  let depth = 0;
  for (let i = idx; i >= 0; i -= 1) {
    const c = payload[i];
    if (c === '}') depth += 1;
    else if (c === '{') {
      if (depth === 0) {
        const close = matchBrace(payload, i);
        if (close === -1) return null;
        try {
          return JSON.parse(payload.slice(i, close + 1));
        } catch {
          return null;
        }
      }
      depth -= 1;
    }
  }
  return null;
}

// 로펙 "원정대" 탭 — 계정의 모든 캐릭터와 각각의 로펙 점수(DB에 저장된 최고 환산 점수)를 한 번에 준다.
// 환산 점수는 딜러·서포터를 같은 척도로 매기므로 원정대 체급(/체급) 합산에 쓴다. 5분 캐시.
// 항목: { nickname, characterClass, itemLevel, lopecScore(없으면 null), combatPower, role: 'dealer'|'support'|null }
export async function getLopecExpedition(characterName) {
  const key = `expedition:${characterName}`;
  const hit = pageCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  try {
    const html = await fetchText(`${BASE_URL}/character/expedition/${encodeURIComponent(characterName)}`);
    const payload = flightPayload(html);
    const byName = new Map();
    for (const m of payload.matchAll(/"lopecScore":/g)) {
      const o = enclosingObject(payload, m.index);
      if (o?.nickname && !byName.has(o.nickname)) byName.set(o.nickname, o);
    }
    const data = byName.size > 0 ? [...byName.values()] : null;
    pageCache.set(key, { at: Date.now(), data });
    return data;
  } catch (err) {
    console.error('[로펙 원정대]', err.message);
    return null;
  }
}

// 효율표 대시보드의 카드 값 (예: "팔찌 효율" → 12.41). 없으면 null.
// 정규식 대신 위치 검색으로 읽는다 — 라벨과 값 사이 마크업이 바뀌어도 덜 깨진다.
function readCard(html, label) {
  const labelAt = html.indexOf(label + '</h3>');
  if (labelAt === -1) return null;
  const valueAt = html.indexOf('cardValue', labelAt);
  if (valueAt === -1 || valueAt - labelAt > 400) return null;
  const open = html.indexOf('>', valueAt);
  const close = html.indexOf('<', open);
  const value = Number(html.slice(open + 1, close));
  return Number.isFinite(value) ? value : null;
}

// 효율표 기준 팔찌 효율(%). 캐릭터 페이지 배지값(lopec-sim.js)이 안 나올 때의 예비값.
export async function getBraceletEfficiency(characterName) {
  const hit = efficiencyCache.get(characterName);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  let value = null;
  try {
    const html = await fetchText(
      `${BASE_URL}/character/efficiency/${encodeURIComponent(characterName)}`,
    );
    value = readCard(html, '팔찌 효율');
  } catch {
    // 타임아웃·네트워크 오류는 조용히 넘긴다 — 팔찌 정보 자체는 보여줘야 한다
  }
  efficiencyCache.set(characterName, { at: Date.now(), value });
  return value;
}
