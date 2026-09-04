// 카카오 오픈빌더 스킬 요청 하나를 처리한다: 발화 → 커맨드 → 실행 → 카카오 응답.
// 카카오는 5초 안에 응답하지 않으면 실패로 보므로 4.5초 예산으로 기다리고, 넘기면
//   · 콜백이 승인된 봇(요청에 callbackUrl)이면 "조회 중" 즉시 응답 후 결과를 콜백 URL로 POST
//   · 아니면 "다시 보내 주세요" 안내 후 실행은 계속 → 결과를 3분 보관 → 같은 발화가 오면 즉시 응답
import { matchTextCommand } from '../text-commands.js';
import { parseEmoticonKeyword, findEmoticonFile } from '../emoticons.js';
import { resolveCharacter } from '../user-store.js';
import { KakaoInteraction } from './interaction.js';
import { toKakaoResponse, textResponse, cardLinkFor, fitBridgeMessage, CHANNEL_LIMITS } from './render.js';

// 카톡에서 커맨드로 보는 접두사. 폰 자판에서 /보다 .이 편해 둘 다 받는다(사용자 요청 2026-09-05).
// 초성 단독(ㅂㅂㄱ 4000)은 여전히 안 받는다 — 잡담과 구분이 안 되므로.
export const KAKAO_PREFIXES = ['/', '.'];
export const hasCommandPrefix = (text) => KAKAO_PREFIXES.some((p) => text.startsWith(p));
export const KAKAO_MATCH_OPTIONS = { prefixes: KAKAO_PREFIXES, bareChosung: false, anyCommand: true };
// 디스코드 채널 개념이 필요한 커맨드 — 카카오에선 항상 제외
export const KAKAO_EXCLUDED = new Set(['알림설정']);
// 디스코드 서버 멤버를 집계하는 커맨드 — KAKAO_GUILD_ID로 서버가 지정돼 있을 때만 카카오에서 허용 (별칭 ㄹㅋ·ㅊㄱ는 대상 이름으로 풀린 뒤 걸린다)
export const KAKAO_GUILD_ONLY = new Set(['랭킹', '체급']);
const excludedFor = (guild) => (guild ? KAKAO_EXCLUDED : new Set([...KAKAO_EXCLUDED, ...KAKAO_GUILD_ONLY]));
// 카카오톡 이모티콘 스위치. 방에서는 이미지 대신 미리보기 카드 링크(/p/emo/키워드)를 보낸다 — false면 방 침묵·안내·이미지 서빙 404.
export const KAKAO_EMOTICONS_ENABLED = true;
const EMOTICONS_OFF = '카카오톡에서는 이모티콘이 잠시 꺼져 있어요. 디스코드에서 [키워드로 쓸 수 있어요.';

const DEFAULT_BUDGET_MS = 4500;
const PENDING_TTL_MS = 3 * 60 * 1000;
const TIMEOUT = Symbol('timeout');

const GUIDE = '명령은 / 또는 .으로 시작해요. 예: /정보 닉네임 · .ㅂㅂㄱ 4000 · /도움말';
const GUIDE_REPLIES = [['도움말', '/도움말'], ['모험섬', '/모험섬'], ['가토', '/가토'], ['업데이트', '/업데이트'], ['유각', '/유각']]
  .map(([label, messageText]) => ({ label, action: 'message', messageText }));
const helpNote = (guild) => '💬 카카오톡에서는 /커맨드 또는 .커맨드 형식으로 써요 (예: /정보 닉네임, .ㅂㅂㄱ 4000, /등록 캐릭터명). '
  + `${[...excludedFor(guild)].join('·')}은 디스코드 전용이에요.`
  + (guild ? ' /랭킹·/체급은 디스코드·카톡에서 /등록한 길드원을 집계해요.' : '')
  + (KAKAO_EMOTICONS_ENABLED ? '' : ' 이모티콘([키워드)은 카톡에서 잠시 꺼져 있어요.');
const WAIT_RETRY = '⏳ 조회에 시간이 걸려요. 잠시 후 같은 명령을 다시 보내 주세요.';
const WAIT_CALLBACK = '⏳ 조회 중이에요…';

// (사용자, 발화) → 실행 중이거나 끝난 결과 Promise. 예산을 넘긴 요청의 결과를 재요청에 돌려주기 위한 것.
const pending = new Map();

const normalize = (utterance) => utterance.trim().replace(/\s+/g, ' ');
const shortKey = (key) => `${String(key).slice(0, 8)}…`;
const guideResponse = () => textResponse(GUIDE, GUIDE_REPLIES);
const plain = (response) => ({ response, link: null });

// 발화 하나를 끝까지 실행한다 (예산과 무관). 절대 reject하지 않는다.
// → { response: 카카오 스킬 응답 JSON, link: 방에 보낼 미리보기 카드 주소(없으면 null) }
async function runUtterance(utterance, userKey, commandMap, baseUrl, { displayName, guild, limits = CHANNEL_LIMITS.skill } = {}) {
  const render = (payloads) => toKakaoResponse(payloads, { baseUrl, limits, fullTitle: utterance });
  const keyword = parseEmoticonKeyword(utterance);
  if (keyword) {
    if (!KAKAO_EMOTICONS_ENABLED) return plain(textResponse(EMOTICONS_OFF));
    const file = findEmoticonFile(keyword);
    if (!file) return plain(textResponse(`'${keyword}' 이모티콘이 없어요. /이모티콘 으로 목록을 볼 수 있어요.`));
    const payloads = [{ files: [file] }];
    return { response: render(payloads), link: cardLinkFor(payloads, { baseUrl }) };
  }
  if (!hasCommandPrefix(utterance)) return plain(guideResponse());

  const match = matchTextCommand(utterance, commandMap, KAKAO_MATCH_OPTIONS);
  if (!match) return plain(guideResponse());
  if (match.usage) return plain(textResponse(`사용법: ${match.usage}`));
  const name = match.command.data.name;
  if (excludedFor(guild).has(name)) return plain(textResponse('이 커맨드는 디스코드에서만 쓸 수 있어요.'));
  if (name === '이모티콘' && !KAKAO_EMOTICONS_ENABLED) return plain(textResponse(EMOTICONS_OFF));

  const interaction = new KakaoInteraction(userKey, match.options, { displayName, guild });
  try {
    await match.command.execute(interaction);
  } catch (err) {
    console.error(`[카카오 ${match.label}]`, err);
    return plain(textResponse(`오류가 발생했어요: ${err.message}`));
  }
  // 카톡 안내(/ 또는 .으로 쓰는 법)는 맨 앞에 — 도움말 전문은 방 분량(1,500자)을 넘어 뒤가 전체 보기로 넘어가므로,
  // 끝에 붙이면 정작 카톡에서 어떻게 치는지가 방에 안 보인다.
  if (name === '도움말') interaction.payloads.unshift({ content: helpNote(guild) });
  // 결과 변환에서 나는 예외도 방 응답으로 바꾼다 — 여기서 새면 위의 pending 체인으로 올라간다
  try {
    // 캐릭터 카드용 — 커맨드가 조회한 캐릭터(입력 > 등록 > 카톡 닉네임). 캐릭터 이미지가 있는 응답에만 카드가 붙는다.
    const character = resolveCharacter(interaction);
    return {
      response: render(interaction.payloads),
      link: cardLinkFor(interaction.payloads, { baseUrl, character }),
    };
  } catch (err) {
    console.error(`[카카오 ${match.label}] 응답 변환 실패:`, err);
    return plain(textResponse('결과를 카카오톡 형식으로 바꾸는 중 오류가 났어요. 잠시 후 다시 시도해 주세요.'));
  }
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(resolve, ms, TIMEOUT).unref?.()),
]);

// 콜백은 오픈빌더가 알려 준 주소로 우리가 POST하는 것이라, 요청 본문에 실린 주소를 그대로 믿으면 내부망·로컬 주소로
// 봇이 요청을 쏘게 만들 수 있다. https + 허용 호스트(기본 kakao.com과 그 하위) + 리다이렉트 금지로 좁힌다.
// 이 모듈의 process()가 전역 process를 가리므로 globalThis로 명시한다
const CALLBACK_HOSTS = (globalThis.process.env.KAKAO_CALLBACK_HOSTS ?? 'kakao.com')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
const IP_LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|\[?[0-9a-f:]+\]?)$/i;

export function isAllowedCallbackUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return false;
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (url.protocol !== 'https:' || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || IP_LITERAL.test(host)) return false;
  return CALLBACK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

async function postCallback(callbackUrl, response, fetchImpl) {
  try {
    const res = await fetchImpl(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
      redirect: 'error', // 허용 호스트에서 다른 곳으로 튕기는 것도 막는다
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error(`[카카오 콜백] HTTP ${res.status}`);
  } catch (err) {
    console.error('[카카오 콜백]', err.message);
  }
}

// 공통 처리: 예산·보류 캐시·콜백. → { response, link }
async function process(body, commandMap, { baseUrl, guild = null, budgetMs = DEFAULT_BUDGET_MS, fetchImpl = fetch, channel = 'skill' } = {}) {
  const limits = CHANNEL_LIMITS[channel] ?? CHANNEL_LIMITS.skill;
  // 요청 필드는 전부 바깥에서 온 값이다 — 문자열이 아니면 없는 것으로 본다(객체를 넣어 예외를 일으키는 요청 등).
  const req = body?.userRequest;
  const utterance = typeof req?.utterance === 'string' ? normalize(req.utterance).slice(0, 500) : '';
  const userKey = typeof req?.user?.id === 'string' ? req.user.id.slice(0, 200) : '';
  const rawCallback = req?.callbackUrl;
  const callbackUrl = isAllowedCallbackUrl(rawCallback) ? rawCallback : null;
  if (rawCallback && !callbackUrl) console.error('[카카오] 허용되지 않은 콜백 주소 무시:', String(rawCallback).slice(0, 120));
  const nickname = req?.user?.properties?.nickname; // 브리지가 넣어 주는 카톡 닉네임 (오픈빌더 요청에는 없음)
  const displayName = typeof nickname === 'string' && nickname.trim() ? nickname.trim().slice(0, 100) : undefined;
  if (!utterance || !userKey) return plain(guideResponse());

  const started = Date.now();
  const key = `${channel}\n${userKey}\n${utterance}`; // 채널마다 분량 규격이 달라 보류 결과를 섞지 않는다
  let task = pending.get(key);
  if (!task) {
    // runUtterance는 절대 reject하지 않도록 만들어 두었지만, 여기서 한 번 더 감싼다 — 이 Promise는 pending에 담겨
    // 여러 요청이 기다리므로, 거절이 처리되지 않은 채 남으면 Node가 프로세스를 통째로 끝내 버린다(디스코드 봇까지).
    task = runUtterance(utterance, userKey, commandMap, baseUrl, { displayName, guild, limits })
      .catch((err) => {
        console.error(`[카카오] 처리 실패 "${utterance}":`, err);
        return plain(textResponse('오류가 발생했어요. 잠시 후 다시 시도해 주세요.'));
      });
    pending.set(key, task);
    // 결과를 아무도 안 가져가도 3분 뒤엔 지운다 (finally가 만드는 새 Promise에도 catch를 달아 둔다)
    task.finally(() => setTimeout(() => { if (pending.get(key) === task) pending.delete(key); }, PENDING_TTL_MS).unref?.())
      .catch(() => {});
  }

  const result = await withTimeout(task, budgetMs);
  const elapsed = `${((Date.now() - started) / 1000).toFixed(1)}s`;
  if (result !== TIMEOUT) {
    pending.delete(key);
    console.log(`[카카오] ${shortKey(userKey)} "${utterance}" ${elapsed}`);
    return result;
  }
  if (callbackUrl) {
    console.log(`[카카오] ${shortKey(userKey)} "${utterance}" ${elapsed} (콜백)`);
    task.then(({ response }) => postCallback(callbackUrl, response, fetchImpl))
      .catch((err) => console.error('[카카오 콜백]', err?.message ?? err))
      .finally(() => pending.delete(key));
    return plain({ version: '2.0', useCallback: true, data: { text: WAIT_CALLBACK } });
  }
  console.log(`[카카오] ${shortKey(userKey)} "${utterance}" ${elapsed} (보류)`);
  return plain(textResponse(WAIT_RETRY));
}

// 오픈빌더 스킬 요청 → 카카오 스킬 응답 JSON. guild: KAKAO_GUILD_ID의 디스코드 서버(없으면 null) — 랭킹 계열 허용·집계용.
export async function handleSkillRequest(body, commandMap, options = {}) {
  try {
    return (await process(body, commandMap, { ...options, channel: 'skill' })).response;
  } catch (err) {
    console.error('[카카오 스킬] 처리 실패:', err);
    return textResponse('오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
  }
}

// ── 오픈채팅방 브리지 — 폰의 메신저봇R(scripts/messengerbot-r.js)이 방 메시지를 그대로 넘기고 평문 답을 받아 방에 쓴다.
// 방에서는 /커맨드와 [이모티콘에만 반응하고 나머지는 침묵(null) — 잡담마다 안내문을 띄우면 방이 시끄러워진다.
// 카카오 5초 제한이 없으므로 예산은 넉넉히. 사람 식별은 닉네임밖에 없어 닉네임으로 등록을 구분한다 —
// 방 이름은 키에 넣지 않는다(방을 옮기거나 제목을 바꿔도 등록이 유지되도록; 한 길드라 방 사이 닉 충돌은 없다고 본다).
const BRIDGE_BUDGET_MS = 25_000;

// 카카오 스킬 응답 JSON → 방에 쓸 평문. 본문(body)과 뒤에 붙는 후속 안내(tail)를 나눠 돌려준다 —
// 분량을 맞출 때 안내 몫을 따로 남겨 둬야 해서다(fitBridgeMessage).
// 이미지는 URL 줄로 두되, 미리보기 카드(link)가 따로 나가면 뺀다 — 카드가 그 이미지를 보여 주니까.
export function flattenParts(response, { skipImages = false } = {}) {
  const outputs = response?.template?.outputs ?? [];
  const parts = outputs
    .map((o) => o.simpleText?.text ?? (skipImages ? '' : o.simpleImage?.imageUrl ?? ''))
    .filter(Boolean);
  if (response?.useCallback && response.data?.text) parts.push(response.data.text);
  const quick = (response?.template?.quickReplies ?? []).map((q) => q.messageText).filter(Boolean);
  const tail = quick.length > 0
    ? '▸ 이어서 쓸 수 있어요\n' + quick.map((q) => `· ${q}`).join('\n')
    : null;
  return { body: parts.join('\n\n') || null, tail };
}

// 본문과 후속 안내를 이어 붙인 평문 한 덩어리 (분량 제한 없음).
export function flattenResponse(response, options = {}) {
  const { body, tail } = flattenParts(response, options);
  return [body, tail].filter(Boolean).join('\n\n') || null;
}

// → { text, link }: text는 방에 쓸 평문(null이면 침묵), link는 먼저 보낼 미리보기 카드 주소(null이면 없음).
export async function handleBridgeMessage(body, commandMap, { baseUrl, guild = null, budgetMs = BRIDGE_BUDGET_MS } = {}) {
  const text = normalize(String(body?.text ?? ''));
  const room = String(body?.room ?? '').trim();
  const sender = String(body?.sender ?? '').trim();
  if (!text || !room || !sender) return { text: null, link: null };
  // 방에서는 /커맨드·.커맨드와 (켜져 있을 때) [이모티콘에만 반응. 이모티콘이 잠겨 있으면 [따봉도 그냥 지나간다 — 방에 안내문을 띄우지 않는다.
  const isEmoticon = KAKAO_EMOTICONS_ENABLED && parseEmoticonKeyword(text);
  if (!hasCommandPrefix(text) && !isEmoticon) return { text: null, link: null };
  // "..."·".ㅋㅋ"처럼 점으로 시작하는 잡담은 흔하다 — .으로 시작했는데 커맨드가 아니면 안내문 없이 침묵한다.
  // (/로 시작하는 오타는 예전처럼 안내문을 준다.)
  if (text.startsWith('.') && !isEmoticon && !matchTextCommand(text, commandMap, KAKAO_MATCH_OPTIONS)) return { text: null, link: null };

  // 닉네임을 같이 넘겨 등록 없이도 "카톡 닉네임 = 캐릭터명"이면 바로 조회되게 한다 (디스코드 서버 닉네임 폴백과 동일)
  const skillBody = { userRequest: { utterance: text, user: { id: `oc:${sender}`, properties: { nickname: sender } } } };
  let response;
  let link = null;
  try {
    ({ response, link } = await process(skillBody, commandMap, { baseUrl, guild, budgetMs, channel: 'bridge' }));
  } catch (err) {
    console.error('[카카오 브리지] 처리 실패:', err);
    response = textResponse('오류가 발생했어요. 잠시 후 다시 시도해 주세요.');
  }
  // 방에 나가는 최종 메시지는 본문 + 후속 안내다 — 둘을 합친 길이로 분량을 맞춘다.
  const { body: message, tail } = flattenParts(response, { skipImages: Boolean(link) });
  return { text: fitBridgeMessage(message, tail, { baseUrl, fullTitle: text }), link };
}
