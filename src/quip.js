// 오늘의 한마디 — 하루에 건네는 짧은 응원·생각거리. 사용자당 하루 한 번만 새로 만든다.
// 키가 없거나 호출이 실패·지연되거나 봇 전체 하루 상한을 넘기면 고정 목록(src/data/quips.js)에서 뽑는다. 명세 §2.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { readJson, writeJsonAtomic, CorruptStoreError } from './json-store.js';
import { QUIPS, QUIP_TOPICS } from './data/quips.js';

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'quip-daily.json');
const KST_OFFSET = 9 * 60 * 60 * 1000;
export const QUIP_MODEL_DEFAULT = 'gpt-5.6-sol';
const ANTHROPIC_MODEL_DEFAULT = 'claude-haiku-4-5';
export const DAILY_CAP = 300; // 봇 전체 하루 LLM 호출 상한(시도 기준) — 넘으면 고정 목록
export const TIMEOUT_MS = 12000; // 카톡 브리지 25초 예산 안에서 생성 완료를 기다리고, 넘기면 고정 목록
const MAX_CHARS = 80;

const kstDate = (ms) => new Date(ms + KST_OFFSET).toISOString().slice(0, 10);
const pick = (list, random) => list[Math.min(list.length - 1, Math.floor(random() * list.length))];

const textKey = (text) => text.normalize('NFC').replace(/\s+/g, '');
const usedByOthers = (store, userId, date) => new Set(Object.entries(store)
  .filter(([id, entry]) => id !== userId && entry.date === date)
  .map(([, entry]) => textKey(entry.text)));

// 짧은 공통 어미는 허용하고, 같은 첫 문장이나 긴 연속 표현은 피한다.
function expressionKeys(text) {
  const parts = text.normalize('NFC').split(/[.!?。！？\n]+/u)
    .map((part) => part.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  const keys = [];
  if (parts[0]?.length >= 8) keys.push(`first:${parts[0]}`);
  for (const part of parts) {
    for (let i = 0; i + 16 <= part.length; i++) keys.push(`phrase:${part.slice(i, i + 16)}`);
  }
  return keys;
}

function overlapsExpressions(texts) {
  const used = new Set(texts.filter((text) => typeof text === 'string').flatMap(expressionKeys));
  return (text) => expressionKeys(text).some((key) => used.has(key));
}

let topicDeck = [];
let lastTopic = null;
function nextTopic(random) {
  if (topicDeck.length === 0) {
    topicDeck = [...QUIP_TOPICS];
    for (let i = topicDeck.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(random() * (i + 1)));
      [topicDeck[i], topicDeck[j]] = [topicDeck[j], topicDeck[i]];
    }
    const last = topicDeck.length - 1;
    if (topicDeck[last] === lastTopic) [topicDeck[0], topicDeck[last]] = [topicDeck[last], topicDeck[0]];
  }
  lastTopic = topicDeck.pop();
  return lastTopic;
}

// 본인의 직전 문장과 다른 사람의 당일 문장을 피한다. 기본 목록을 모두 썼으면 짧은 두 문장을 묶는다.
export function pickFallback({ random = Math.random, avoid = null, exclude = [], avoidExpressions = [] } = {}) {
  const blocked = new Set([...exclude, avoid].filter((text) => typeof text === 'string').map(textKey));
  const index = Math.min(QUIPS.length - 1, Math.floor(random() * QUIPS.length));
  const ordered = [...QUIPS.slice(index), ...QUIPS.slice(0, index)];
  const overlaps = overlapsExpressions(avoidExpressions);
  const candidates = ordered.filter((text) => !blocked.has(textKey(text)));
  const available = candidates.find((text) => !overlaps(text)) ?? candidates[0];
  if (available) return available;
  const singles = ordered.filter((text) => /^[^.!?\n]+[.!?]$/.test(text));
  for (const first of singles) {
    for (const second of singles) {
      if (first === second) continue;
      const text = `${first}\n${second}`;
      if (text.length <= MAX_CHARS && !blocked.has(textKey(text))) return text;
    }
  }
  throw new Error('오늘 나눌 서로 다른 한마디를 모두 사용했어요');
}

const SYSTEM = [
  '한국어 존댓말 한마디 본문만. 대체로 두 문장·45~75자, 최대 2줄·80자. 이름·호칭·당신·머리말 제외. 이모지는 자연스러울 때만 1개까지.',
  '소재에 맞게 응원·공감·짧은 창작 격언을 전하고, 일상 실수에는 가벼운 농담을 곁들인다. 매번 웃기거나 교훈으로 끝낼 필요는 없다. 창작 격언에 저자나 출처를 붙이지 않는다.',
  '소재는 가정이나 일반적인 상황으로 말한다. 상대가 겪은 일로 단정하거나 성격·계절·날씨를 추측하지 않는다.',
  '웃음은 상황의 반전에서 찾고 사물에 감정·의지를 붙이거나 억지 비유는 쓰지 않는다. 차·커피·물 한 잔·휴식/여유 반복 금지.',
  '훈계·비하·욕설·정치·종교·광고·성공 보장·억지 게임 용어·허위 인용·운세·해시태그 금지.',
].join('\n');

// 요청 본문. 사용자 입력·날짜 없이 일상 소재 하나만 보낸다.
export function buildRequest({ provider = 'openai', model, random = Math.random, topic } = {}) {
  const input = topic ?? pick(QUIP_TOPICS, random);
  if (provider === 'anthropic') return {
    model: model || ANTHROPIC_MODEL_DEFAULT, max_tokens: 200, temperature: 1,
    system: SYSTEM, messages: [{ role: 'user', content: input }],
  };
  const selectedModel = model || QUIP_MODEL_DEFAULT;
  return {
    model: selectedModel, instructions: SYSTEM, input, max_output_tokens: 200, store: false,
    // 이 계열은 추론 없이 짧은 문장 출력에만 예산을 쓴다.
    ...(/^gpt-5\.(4|6)(-|$)/.test(selectedModel) ? { reasoning: { effort: 'none' } } : {}),
  };
}

// 응답 본문 정리: 앞뒤 따옴표·공백 제거. 범위를 넘긴 답을 잘라 보내지 않고 고정 목록으로 대체한다.
function normalize(text) {
  if (typeof text !== 'string') return null;
  const lines = text.trim().replace(/^["'“”「『]+|["'“”」』]+$/g, '').trim().split('\n').map((l) => l.trim()).filter(Boolean);
  const out = lines.join('\n');
  return lines.length > 2 || out.length === 0 || out.length > MAX_CHARS ? null : out;
}

// 명시한 제공자 → 기존 모델 접두어 → 사용 가능한 키 순서. 기존 키만 있는 설치도 유지한다.
export function createClient({ env = process.env, fetchImpl = fetch } = {}) {
  const model = env.QUIP_MODEL?.trim();
  const modelProvider = model?.startsWith('claude-') ? 'anthropic' : model?.startsWith('gpt-') ? 'openai' : null;
  const provider = env.QUIP_PROVIDER?.trim() || modelProvider || (env.OPENAI_API_KEY ? 'openai' : 'anthropic');
  if (modelProvider && provider !== modelProvider) return null;
  if (provider === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const sdk = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    return { provider, model: model || ANTHROPIC_MODEL_DEFAULT, messages: sdk.messages };
  }
  if (provider !== 'openai' || !env.OPENAI_API_KEY) return null;
  return { provider, model: model || QUIP_MODEL_DEFAULT, responses: {
    async create(body, { signal }) {
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST', headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal,
      });
      if (!response.ok) throw Object.assign(new Error('Request failed'), { status: response.status });
      return response.json();
    },
  } };
}

// LLM 호출 1회 → 정리한 한마디 또는 null(실패·지연·거부·빈 응답). 본문·키는 로그에 남기지 않는다.
export async function generateQuip({ client, model, random = Math.random, timeoutMs = TIMEOUT_MS } = {}) {
  if (!client) return null;
  try {
    const provider = client.provider || 'anthropic';
    const request = buildRequest({ provider, model: model || client.model, random, topic: nextTopic(random) });
    // 연결부터 본문 수신까지 하나의 기한. 실패 후 다른 제공자를 호출하지 않는다.
    const options = { timeout: timeoutMs, maxRetries: 0, signal: AbortSignal.timeout(timeoutMs) };
    if (provider === 'openai') {
      const response = await client.responses.create(request, options);
      if (response?.status !== 'completed') return null;
      const messages = (response.output ?? []).filter((item) => item.type === 'message');
      if (messages.some((item) => item.status !== 'completed')) return null;
      const blocks = messages.flatMap((item) => item.content ?? []);
      if (blocks.some((block) => block.type !== 'output_text' || typeof block.text !== 'string')) return null;
      return normalize(blocks.map((block) => block.text).join('\n'));
    }
    const response = await client.messages.create(request, options);
    if (response?.stop_reason !== 'end_turn') return null;
    const blocks = response.content ?? [];
    if (blocks.some((block) => block.type !== 'text' || typeof block.text !== 'string')) return null;
    return normalize(blocks.map((block) => block.text).join('\n'));
  } catch (err) {
    const detail = Number.isInteger(err?.status) ? `HTTP ${err.status}` : /^(AbortError|TimeoutError)$/.test(err?.name) ? '시간 초과' : '요청 오류';
    console.error('한마디 생성 실패:', detail);
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

// { userId: { date, text, source } } — 당일 중복을 정리한 뒤에는 저장된 문장을 다시 준다. 깨진 파일은 저장을 막는다.
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
// 그사이 같은 사용자에게 중복 없는 당일 기록이나 더 뒤 날짜의 기록이 생겼으면 그 기록을 돌려준다.
const inFlight = new Map(); // `${storePath}\n${userId}\n${date}` → Promise
const repeatOf = (entry) => ({ status: 'repeat', text: entry.text, source: entry.source, date: entry.date });

export async function getQuip(userId, { now = Date.now, random = Math.random, generate = defaultGenerate, storePath = STORE_PATH, cap = DAILY_CAP } = {}) {
  const date = kstDate(now());
  const initial = loadStore(storePath);
  const prev = initial[userId] ?? null;
  if (prev?.date === date && !usedByOthers(initial, userId, date).has(textKey(prev.text))) return repeatOf(prev);
  const key = `${storePath}\n${userId}\n${date}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const job = (async () => {
    // 이미 저장된 당일 중복은 추가 생성 없이 요청자의 문장만 바꾼다.
    let text = prev?.date === date ? prev.text : null;
    let source = prev?.date === date ? prev.source : 'list';
    if (prev?.date !== date && generate && tryReserve(date, cap)) {
      text = await generate({ random, now });
      source = text ? 'llm' : 'list';
    }
    const store = loadStore(storePath); // 저장 직전 최신 상태
    const latest = store[userId] ?? null;
    const used = usedByOthers(store, userId, date);
    if (latest && (latest.date > date || (latest.date === date && !used.has(textKey(latest.text))))) return repeatOf(latest);
    const previousText = latest?.text ?? prev?.text ?? null;
    const previousExpressions = Object.entries(store)
      .filter(([id, entry]) => id !== userId && entry.date === date).map(([, entry]) => entry.text);
    if (previousText) previousExpressions.push(previousText);
    if (!text || used.has(textKey(text)) || (previousText && textKey(text) === textKey(previousText)) || overlapsExpressions(previousExpressions)(text)) {
      text = pickFallback({ random, avoid: previousText, exclude: used, avoidExpressions: previousExpressions });
      source = 'list';
    }
    store[userId] = { date, text, source };
    writeJsonAtomic(storePath, store);
    return { status: 'new', text, source, date };
  })().finally(() => { inFlight.delete(key); });
  inFlight.set(key, job);
  return job;
}

export const __test = { resetCounter: () => { counter = { date: null, count: 0 }; inFlight.clear(); topicDeck = []; lastTopic = null; } };
