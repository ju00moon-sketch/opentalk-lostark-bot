// 디스코드 응답 페이로드({ content, embeds, files, components }) → 카카오 오픈빌더 스킬 응답(v2.0).
// 카카오는 마크다운·고정폭 글꼴이 없어 임베드를 평문으로 펴고, 버튼은 바로가기(quickReplies)로,
// 첨부 이미지는 우리 서버가 공개 서빙하는 URL(simpleImage)로 바꾼다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveResult } from './result-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// 공개 서빙을 허용하는 폴더 — 이 둘의 직접 자식 파일만 URL이 나온다 (server.js의 라우트와 짝)
const PUBLIC_DIRS = {
  emoticons: path.join(ROOT, 'assets', 'emoticons'),
  charts: path.join(ROOT, 'assets', 'charts'),
};

const TEXT_MAX = 1000;     // 오픈빌더 simpleText 글자수 제한 (플랫폼 규격 — 늘릴 수 없다)
const OUTPUTS_MAX = 3;     // 오픈빌더 outputs 개수 제한 (플랫폼 규격)
const QUICK_MAX = 10;      // quickReplies 개수 제한
const LABEL_MAX = 14;      // quickReplies label 글자수 제한

// 오픈채팅 브리지는 폰 봇이 평문 한 덩어리를 그대로 방에 쓰는 구조라 오픈빌더 규격이 적용되지 않는다.
// 그렇다고 방에 벽지 같은 메시지를 쏟으면 읽기 어려우니, 읽을 만한 분량에서 끊고
// 넘치는 만큼은 "전체 보기" 페이지(/p/full/<id>)로 넘긴다.
const BRIDGE_TEXT_MAX = 1500;

export const CHANNEL_LIMITS = {
  skill: { textMax: TEXT_MAX, parts: OUTPUTS_MAX, outputsMax: OUTPUTS_MAX },
  // 브리지는 여기서 자르지 않고 한 덩어리로만 모은다. 방에 나가는 최종 메시지에는 본문 뒤에 후속 안내가
  // 더 붙기 때문에, 길이를 맞추는 일은 그 둘을 합칠 수 있는 fitBridgeMessage에서 한 번에 한다.
  bridge: { textMax: Infinity, parts: 1, outputsMax: 4 },
};

export function stripMarkdown(text) {
  return String(text ?? '')
    // 코드블록 펜스: 구분자(```)와 언어 표기만 지우고 내용은 남긴다. "```코드```안내"처럼 한 줄에 붙어 있으면
    // 줄바꿈으로 바꿔 내용이 앞뒤 글과 붙지 않게 한다 — 예전엔 줄 끝까지 지워 스킬코드가 통째로 사라졌다.
    .replace(/```(?:[A-Za-z0-9_+-]+(?=\n))?\n?/g, (fence, at, whole) => {
      const atLineStart = at === 0 || whole[at - 1] === '\n';
      const endsLine = fence.endsWith('\n') || at + fence.length >= whole.length || whole[at + fence.length] === '\n';
      return atLineStart && endsLine ? '' : '\n';
    })
    .replace(/\*\*|__|~~/g, '')
    .replace(/`/g, '')
    .replace(/^-# /gm, '')                                 // 작은 글씨
    .replace(/^#{1,3} /gm, '')                             // 제목
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2') // [텍스트](링크) → 텍스트 링크
    .replace(/<#\d+>|<@[!&]?\d+>/g, '')                    // 채널·유저·역할 멘션
    .replace(/[^\S\n]{2,}/g, ' ')                          // 표 정렬용 연속 공백 → 한 칸 (줄바꿈은 유지)
    .replace(/^[^\S\n]+|[^\S\n]+$/gm, '')                  // 줄 앞뒤 공백
    .replace(/\n{3,}/g, '\n\n')                              // 펜스를 줄바꿈으로 바꾸며 생긴 빈 줄 겹침 정리
    .trim();
}

const asJson = (builder) => (builder?.toJSON ? builder.toJSON() : builder?.data ?? builder ?? {});
const isBlankName = (name) => !String(name ?? '').replaceAll(String.fromCharCode(0x200b), '').trim(); // 디스코드 빈 필드명(제로폭 공백)도 빈 것으로

// 임베드 → 평문: 제목 → 설명 → 필드 → 외부 이미지 URL → 푸터. 썸네일은 장식이라 뺀다.
// 값이 한 줄인 필드는 "▸ 이름: 값" 한 줄로 붙이고 연달아 쌓는다(디스코드의 inline 필드 격자를 흉내).
// 값이 여러 줄이면 "▸ 이름" 다음 줄부터 값, 앞뒤로 빈 줄.
export function embedToText(embed) {
  const e = asJson(embed);
  const lines = [];
  if (e.author?.name) lines.push(e.author.name);
  if (e.title) lines.push(e.title);
  if (e.url) lines.push(e.url);
  if (e.description) lines.push(e.description);
  let prevMultiline = true; // 첫 필드 앞에는 항상 빈 줄
  for (const field of e.fields ?? []) {
    const value = String(field.value ?? '').trim();
    const single = !value.includes('\n');
    if (!single || prevMultiline) lines.push('');
    if (isBlankName(field.name)) lines.push(value);
    else if (single) lines.push(`▸ ${field.name}: ${value}`);
    else lines.push(`▸ ${field.name}`, value);
    prevMultiline = !single;
  }
  if (e.image?.url && !e.image.url.startsWith('attachment://')) lines.push(e.image.url);
  if (e.footer?.text) lines.push('', e.footer.text);
  return stripMarkdown(lines.join('\n'));
}

// 줄 단위로 max자 이하 조각을 만든다 → { chunks, truncated, rest }.
// rest는 parts개를 넘겨 잘려 나간 뒷부분(전체 보기 페이지에 쓸 판단 재료).
export function splitParts(text, max, parts) {
  const chunks = [];
  let current = '';
  const push = () => { if (current) chunks.push(current); current = ''; };
  for (const line of String(text ?? '').split('\n')) {
    let piece = line;
    while (piece.length > max) {           // 한 줄이 제한보다 길면 강제로 자른다
      push();
      chunks.push(piece.slice(0, max));
      piece = piece.slice(max);
    }
    if (current.length + piece.length + (current ? 1 : 0) > max) push();
    current = current ? `${current}\n${piece}` : piece;
  }
  push();
  if (chunks.length <= parts) return { chunks, truncated: false, rest: '' };
  return { chunks: chunks.slice(0, parts), truncated: true, rest: chunks.slice(parts).join('\n') };
}

// 이어지는 줄 표시 — 이 기호로 시작하는 줄은 앞줄에 딸린 내용이다(랭킹 두 번째 줄 등).
const CONTINUATION = '└';

// 잘린 자리가 항목 한가운데면 머리줄만 덩그러니 남는다 — 딸린 줄이 잘려 나갔으면 머리줄도 같이 뺀다.
function dropOrphanHead(chunks, rest) {
  if (!rest.startsWith(CONTINUATION) || chunks.length === 0) return chunks;
  const kept = [...chunks];
  const lines = kept[kept.length - 1].split('\n');
  lines.pop();
  kept[kept.length - 1] = lines.join('\n');
  return kept.filter(Boolean);
}

// 줄 단위로 max자 이하 조각을 만든다. parts개를 넘기면 마지막 조각 끝을 …로 자른다.
export function splitText(text, max = TEXT_MAX, parts = OUTPUTS_MAX) {
  const { chunks, truncated } = splitParts(text, max, parts);
  if (!truncated) return chunks;
  const kept = [...chunks];
  const last = kept[parts - 1];
  kept[parts - 1] = `${last.slice(0, max - 1).trimEnd()}…`;
  return kept;
}

// 디스코드 버튼 → 카카오 바로가기. run:커맨드:닉네임 → "/커맨드 닉네임", cmd:커맨드 → "/커맨드".
// 링크 버튼은 바로가기로 못 만들어 "라벨: URL" 문자열로 돌려준다(본문 끝에 붙임).
export function buttonsToQuickReplies(rows = []) {
  const quickReplies = [];
  const links = [];
  for (const row of rows ?? []) {
    for (const c of asJson(row).components ?? []) {
      const label = String(c.label ?? '').slice(0, LABEL_MAX);
      if (c.url) { links.push(`${c.label ?? '링크'}: ${c.url}`); continue; }
      if (c.disabled) continue; // 현재 위치 표시 같은 눌리지 않는 버튼
      const id = String(c.custom_id ?? c.customId ?? '');
      const [tag, cmd] = id.split(':');
      const rest = id.slice(tag.length + 1 + (cmd?.length ?? 0) + 1);
      if (!cmd || !['run', 'cmd', 'opt'].includes(tag)) continue;
      let messageText = `/${cmd}`;
      if (tag === 'run' && rest) messageText = `/${cmd} ${rest}`;
      if (tag === 'opt' && rest) {
        // "이름=값&이름=값"의 값들만 순서대로 — 채팅 파서는 위치 인자로 받는다 (예: /랭킹 2)
        const values = rest.split('&').filter(Boolean).map((kv) => decodeURIComponent(kv.slice(kv.indexOf('=') + 1)));
        messageText = `/${cmd} ${values.join(' ')}`.trim();
      }
      quickReplies.push({ label: label || cmd, action: 'message', messageText });
    }
  }
  return { quickReplies: quickReplies.slice(0, QUICK_MAX), links };
}

// 첨부 파일 경로 → 공개 URL. 허용 폴더의 직접 자식이 아니면 null.
export function publicUrlFor(filePath, baseUrl) {
  if (typeof filePath !== 'string') return null;
  const abs = path.resolve(filePath);
  for (const [key, dir] of Object.entries(PUBLIC_DIRS)) {
    if (path.dirname(abs) === dir) return `${baseUrl}/assets/${key}/${encodeURIComponent(path.basename(abs))}`;
  }
  return null;
}

// 전투정보실 캐릭터 이미지 — 임베드 썸네일이 이거면 캐릭터 카드를 붙인다 (아이템 아이콘 썸네일에는 안 붙임)
const CHARACTER_IMAGE = /cdn-lostark\.game\.onstove\.com\/armory\//;

// 방에 먼저 보낼 미리보기 카드 페이지 주소(preview.js). 첨부 이모티콘/차트 → /p/emo·/p/chart, 캐릭터 썸네일 → /p/char/<캐릭터>.
// 카톡이 URL의 og:image를 카드로 그려 주므로 폰 봇이 그림을 못 보내도 이미지가 보인다. 해당 없으면 null.
export function cardLinkFor(payloads, { baseUrl, character = null }) {
  for (const raw of payloads ?? []) {
    const p = typeof raw === 'string' ? {} : raw ?? {};
    // 카카오 전용 평문 응답은 임베드를 안 쓰므로 캐릭터 카드를 직접 지목한다 (payload.characterCard = 캐릭터명)
    if (typeof p.characterCard === 'string' && p.characterCard) {
      return `${baseUrl}/p/char/${encodeURIComponent(p.characterCard)}`;
    }
    for (const file of p.files ?? []) {
      const filePath = typeof file === 'string' ? file : file?.attachment;
      if (typeof filePath !== 'string') continue;
      const abs = path.resolve(filePath);
      const name = path.basename(abs).replace(/\.[^.]+$/, '');
      if (path.dirname(abs) === PUBLIC_DIRS.emoticons) return `${baseUrl}/p/emo/${encodeURIComponent(name)}`;
      if (path.dirname(abs) === PUBLIC_DIRS.charts) return `${baseUrl}/p/chart/${encodeURIComponent(name)}`;
    }
    if (character) {
      for (const embed of p.embeds ?? []) {
        const url = asJson(embed).thumbnail?.url ?? '';
        if (CHARACTER_IMAGE.test(url)) return `${baseUrl}/p/char/${encodeURIComponent(character)}`;
      }
    }
  }
  return null;
}

// 분량을 넘기면 읽을 만큼만 남기고 마지막 조각에 "전체 보기" 주소를 붙인다.
// 제한을 늘려 긴 메시지를 통째로 밀어 넣는 대신, 전문은 페이지에서 보게 하는 쪽이다.
const MORE_LABEL = '📄 뒤가 잘렸어요 · 전체 보기';

function fitText(text, { textMax, parts, baseUrl, fullTitle }) {
  const first = splitParts(text, textMax, parts);
  if (!first.truncated) return first.chunks;
  if (!baseUrl) return splitText(text, textMax, parts); // 주소를 못 만들면 예전처럼 …로 자른다

  const linkLine = `${MORE_LABEL} ${baseUrl}/p/full/${saveResult(text, fullTitle)}`;
  const room = Math.max(1, textMax - linkLine.length - 2); // 링크 줄이 들어갈 자리를 미리 비운다
  const second = splitParts(text, room, parts);
  const chunks = dropOrphanHead(second.chunks, second.rest);
  const kept = chunks.length > 0 ? [...chunks] : [''];
  kept[kept.length - 1] = `${kept[kept.length - 1]}

${linkLine}`.trim();
  return kept;
}

// 오픈채팅방에 나갈 최종 메시지를 BRIDGE_TEXT_MAX에 맞춘다.
//   body — 본문(임베드·이미지 URL 등을 편 것)
//   tail — 뒤에 붙는 후속 안내("▸ 이어서 쓸 수 있어요 …")
// 안내는 잘리면 쓸모가 없어지므로 자리를 먼저 빼 두고 본문만 줄인다. 그래서 안내까지 합친 최종 길이가 한도를 지킨다.
export function fitBridgeMessage(body, tail = null, { baseUrl, fullTitle = '조회 결과' } = {}) {
  if (!body) return tail || null;
  const reserve = tail ? tail.length + 2 : 0;
  const [fitted] = fitText(body, {
    textMax: Math.max(1, BRIDGE_TEXT_MAX - reserve), parts: 1, baseUrl, fullTitle,
  });
  return [fitted, tail].filter(Boolean).join('\n\n');
}

export function textResponse(text, quickReplies = []) {
  const template = { outputs: splitText(text).map((t) => ({ simpleText: { text: t } })) };
  if (quickReplies.length > 0) template.quickReplies = quickReplies.slice(0, QUICK_MAX);
  return { version: '2.0', template };
}

// reply()/editReply()에 넘겼던 페이로드 목록을 하나의 카카오 응답으로. 텍스트가 앞, 이미지가 뒤.
//   limits    — 채널별 분량 규격 (CHANNEL_LIMITS.skill | CHANNEL_LIMITS.bridge)
//   fullTitle — 분량을 넘겨 잘릴 때 만드는 "전체 보기" 페이지의 제목
export function toKakaoResponse(payloads, { baseUrl, limits = CHANNEL_LIMITS.skill, fullTitle = '조회 결과' }) {
  const texts = [];
  const images = [];
  const links = [];
  let quickReplies = [];
  for (const raw of payloads ?? []) {
    const p = typeof raw === 'string' ? { content: raw } : raw ?? {};
    if (p.content) texts.push(stripMarkdown(p.content));
    for (const embed of p.embeds ?? []) {
      const text = embedToText(embed);
      if (text) texts.push(text);
    }
    for (const file of p.files ?? []) {
      const filePath = typeof file === 'string' ? file : file?.attachment;
      const url = publicUrlFor(filePath, baseUrl);
      if (url) images.push({ simpleImage: { imageUrl: url, altText: path.basename(filePath).slice(0, 50) } });
    }
    const buttons = buttonsToQuickReplies(p.components);
    quickReplies = quickReplies.concat(buttons.quickReplies);
    links.push(...buttons.links);
  }
  if (links.length > 0) texts.push(links.map((l) => `🔗 ${l}`).join('\n'));

  const textParts = Math.max(1, limits.parts - Math.min(images.length, limits.parts - 1));
  const full = texts.filter(Boolean).join('\n\n');
  const outputs = [
    ...fitText(full, { textMax: limits.textMax, parts: textParts, baseUrl, fullTitle }).map((t) => ({ simpleText: { text: t } })),
    ...images,
  ].slice(0, limits.outputsMax);
  if (outputs.length === 0) outputs.push({ simpleText: { text: '(응답이 없어요)' } });

  const template = { outputs };
  if (quickReplies.length > 0) template.quickReplies = quickReplies.slice(0, QUICK_MAX);
  return { version: '2.0', template };
}
