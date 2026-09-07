// 오늘의 한마디 — 클로드 API로 길드 채팅용 한마디 1~2줄을 만들고, 사용자당 하루 한 번만 새로 만든다.
// 키가 없거나 호출이 실패·지연되거나 봇 전체 하루 상한을 넘기면 고정 목록(src/data/quips.js)에서 뽑는다. 명세 §2.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { readJson, writeJsonAtomic, CorruptStoreError } from './json-store.js';
import { QUIPS, QUIP_TOPICS } from './data/quips.js';

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'quip-daily.json');
const KST_OFFSET = 9 * 60 * 60 * 1000;
export const QUIP_MODEL_DEFAULT = 'claude-haiku-4-5'; // 가장 저렴한 모델. 환경변수 QUIP_MODEL로 바꾼다.
export const DAILY_CAP = 300; // 봇 전체 하루 LLM 호출 상한(시도 기준) — 넘으면 고정 목록
export const TIMEOUT_MS = 4000; // 카톡 25초 예산 안에서 넉넉히, 넘기면 고정 목록
const MAX_CHARS = 120;
const TONES = ['유머', '응원', '짧은 명언'];

const kstDate = (ms) => new Date(ms + KST_OFFSET).toISOString().slice(0, 10);
const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

// 고정 목록에서 하나. avoid(직전에 받은 문장)와 같으면 다음 것.
export function pickFallback({ random = Math.random, avoid = null } = {}) {
  const index = Math.min(QUIPS.length - 1, Math.floor(random() * QUIPS.length));
  return QUIPS[index] === avoid ? QUIPS[(index + 1) % QUIPS.length] : QUIPS[index];
}

const SYSTEM = [
  '너는 로스트아크 길드의 디스코드·카카오톡 봇이다. 요청마다 길드원에게 건네는 "오늘의 한마디"를 한국어로 만든다.',
  '규칙: 1~2줄, 전체 60자 이내. 톤은 요청에 적힌 것(유머·응원·짧은 명언)을 따르되 뻔하지 않게.',
  '읽는 길드원 한 사람에게 직접 건네는 존댓말로 쓴다. 봇이 앞에 "○○님"을 붙여 보내므로 이름·호칭·"당신"으로 시작하지 않고 바로 이어질 말로 시작한다(예: "오늘 숙제는 하나만 끝내도 충분해요").',
  '로스트아크 용어(숙제, 재련, 레이드, 골드, 카오스 던전, 모험섬, 떠상 등)는 자연스러울 때만 섞는다.',
  '특정 사람 이름·욕설·비하·정치·종교·광고를 넣지 않는다. 이모지는 최대 1개.',
  '따옴표·머리말·설명·해시태그 없이 한마디 문장만 출력한다.',
].join('\n');

// 요청 본문. 사용자 입력은 넣지 않고 주제·톤·날짜만 무작위로 섞어 매번 다르게 만든다.
export function buildRequest({ model = process.env.QUIP_MODEL || QUIP_MODEL_DEFAULT, random = Math.random, date = kstDate(Date.now()) } = {}) {
  return {
    model,
    max_tokens: 200,
    temperature: 1,
    system: SYSTEM,
    messages: [{ role: 'user', content: `주제 힌트: ${pick(QUIP_TOPICS, random)} · 톤: ${pick(TONES, random)} · 오늘 날짜: ${date}\n오늘의 한마디를 만들어 줘.` }],
  };
}

// 응답 본문 정리: 앞뒤 따옴표·공백 제거, 빈 줄 제거, 최대 2줄. 비어 있거나 너무 길면 null.
function normalize(text) {
  const lines = String(text ?? '').trim().replace(/^["'“”「『]+|["'“”」』]+$/g, '').trim().split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);
  const out = lines.join('\n');
  return out.length === 0 || out.length > MAX_CHARS ? null : out;
}

// 키가 있을 때만 클라이언트를 만든다(SDK가 ANTHROPIC_API_KEY를 읽는다). 없으면 null → 항상 고정 목록.
export function createClient() {
  return process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
}

// LLM 호출 1회 → 정리한 한마디 또는 null(실패·지연·거부·빈 응답). 본문·키는 로그에 남기지 않는다.
export async function generateQuip({ client, model, random = Math.random, now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  if (!client) return null;
  try {
    // timeout은 연결·헤더까지만 막고 본문 수신은 제한하지 않아 AbortSignal.timeout도 함께 넘긴다(기술 검토 P2-2).
    const response = await client.messages.create(buildRequest({ model, random, date: kstDate(now()) }), { timeout: timeoutMs, maxRetries: 0, signal: AbortSignal.timeout(timeoutMs) });
    if (response?.stop_reason === 'refusal') return null;
    const block = (response?.content ?? []).find((b) => b.type === 'text');
    return normalize(block?.text);
  } catch (err) {
    console.error('한마디 생성 실패:', err?.status ? `HTTP ${err.status}` : err?.name ?? err?.message);
    return null;
  }
}

// 봇 전체 하루 시도 횟수(메모리, 재시작 시 0)
let counter = { date: null, count: 0 };
function tryReserve(date, cap) {
  if (counter.date !== date) counter = { date, count: 0 };
  if (counter.count >= cap) return false;
  counter.count += 1;
  return true;
}

let defaultClient;
const defaultGenerate = (opts) => {
  defaultClient ??= createClient();
  return generateQuip({ client: defaultClient, ...opts });
};

// { userId: { date, text, source } } — 같은 날은 저장된 문장을 다시 준다. 깨진 파일이면 readJson이 예외를 던져 저장을 막는다.
// 파싱은 되지만 구조가 다른 파일(배열 루트, 문자열이 아닌 text 등)도 손상으로 본다 — 배열 위에 저장하면 기록이 사라진다.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isEntry = (e) => e && typeof e === 'object' && !Array.isArray(e) && typeof e.date === 'string' && DATE_RE.test(e.date) && typeof e.text === 'string' && (e.source === 'llm' || e.source === 'list');
function loadStore(storePath) {
  const store = readJson(storePath, {});
  if (!store || typeof store !== 'object' || Array.isArray(store)) throw new CorruptStoreError(storePath, new Error('루트가 객체가 아님'));
  for (const [id, entry] of Object.entries(store)) {
    if (!isEntry(entry)) throw new CorruptStoreError(storePath, new Error(`항목 형식 오류: ${id}`));
  }
  return store;
}

// 생성을 기다리는 동안(수 초) 다른 요청이 저장할 수 있으므로(기술 검토 P2-1):
// 같은 사용자·날짜의 진행 중 요청은 한 프로미스를 공유하고, 저장 직전에 파일을 다시 읽어(검증 포함) 내 항목만 덧붙이며,
// 그사이 같은 사용자에게 같은 날 또는 더 뒤 날짜의 기록이 생겼으면 덮어쓰지 않고 그 기록을 돌려준다.
const inFlight = new Map(); // `${storePath}\n${userId}\n${date}` → Promise
const repeatOf = (entry) => ({ status: 'repeat', text: entry.text, source: entry.source, date: entry.date });

export async function getQuip(userId, { now = Date.now, random = Math.random, generate = defaultGenerate, storePath = STORE_PATH, cap = DAILY_CAP } = {}) {
  const date = kstDate(now());
  const prev = loadStore(storePath)[userId] ?? null;
  if (prev?.date === date) return repeatOf(prev);
  const key = `${storePath}\n${userId}\n${date}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const job = (async () => {
    let text = null;
    if (generate && tryReserve(date, cap)) text = await generate({ random, now });
    const source = text ? 'llm' : 'list';
    const store = loadStore(storePath); // 저장 직전 최신 상태
    const latest = store[userId] ?? null;
    if (latest && latest.date >= date) return repeatOf(latest);
    text ??= pickFallback({ random, avoid: latest?.text ?? prev?.text ?? null });
    store[userId] = { date, text, source };
    writeJsonAtomic(storePath, store);
    return { status: 'new', text, source, date };
  })().finally(() => { inFlight.delete(key); });
  inFlight.set(key, job);
  return job;
}

export const __test = { resetCounter: () => { counter = { date: null, count: 0 }; inFlight.clear(); } };
