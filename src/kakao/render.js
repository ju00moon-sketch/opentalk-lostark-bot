// 디스코드 응답 페이로드({ content, embeds, files, components }) → 카카오 오픈빌더 스킬 응답(v2.0).
// 카카오는 마크다운·고정폭 글꼴이 없어 임베드를 평문으로 펴고, 버튼은 바로가기(quickReplies)로,
// 첨부 이미지는 우리 서버가 공개 서빙하는 URL(simpleImage)로 바꾼다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// 공개 서빙을 허용하는 폴더 — 이 둘의 직접 자식 파일만 URL이 나온다 (server.js의 라우트와 짝)
const PUBLIC_DIRS = {
  emoticons: path.join(ROOT, 'assets', 'emoticons'),
  charts: path.join(ROOT, 'assets', 'charts'),
};

const TEXT_MAX = 1000;     // simpleText 글자수 제한
const OUTPUTS_MAX = 3;     // outputs 개수 제한
const QUICK_MAX = 10;      // quickReplies 개수 제한
const LABEL_MAX = 14;      // quickReplies label 글자수 제한

export function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/```[^\n]*\n?/g, '')                          // 코드블록 펜스 (언어 표기 포함)
    .replace(/\*\*|__|~~/g, '')
    .replace(/`/g, '')
    .replace(/^-# /gm, '')                                 // 작은 글씨
    .replace(/^#{1,3} /gm, '')                             // 제목
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2') // [텍스트](링크) → 텍스트 링크
    .replace(/<#\d+>|<@[!&]?\d+>/g, '')                    // 채널·유저·역할 멘션
    .replace(/[^\S\n]{2,}/g, ' ')                          // 표 정렬용 연속 공백 → 한 칸 (줄바꿈은 유지)
    .replace(/^[^\S\n]+|[^\S\n]+$/gm, '')                  // 줄 앞뒤 공백
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

// 줄 단위로 max자 이하 조각을 만든다. parts개를 넘기면 마지막 조각 끝을 …로 자른다.
export function splitText(text, max = TEXT_MAX, parts = OUTPUTS_MAX) {
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
  if (chunks.length <= parts) return chunks;
  const kept = chunks.slice(0, parts);
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
      const [tag, cmd, nick] = String(c.custom_id ?? c.customId ?? '').split(':');
      if (!cmd || (tag !== 'run' && tag !== 'cmd')) continue;
      const messageText = tag === 'run' && nick ? `/${cmd} ${nick}` : `/${cmd}`;
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

export function textResponse(text, quickReplies = []) {
  const template = { outputs: splitText(text).map((t) => ({ simpleText: { text: t } })) };
  if (quickReplies.length > 0) template.quickReplies = quickReplies.slice(0, QUICK_MAX);
  return { version: '2.0', template };
}

// reply()/editReply()에 넘겼던 페이로드 목록을 하나의 카카오 응답으로. 텍스트가 앞, 이미지가 뒤.
export function toKakaoResponse(payloads, { baseUrl }) {
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

  const textParts = Math.max(1, OUTPUTS_MAX - Math.min(images.length, OUTPUTS_MAX - 1));
  const outputs = [
    ...splitText(texts.filter(Boolean).join('\n\n'), TEXT_MAX, textParts).map((t) => ({ simpleText: { text: t } })),
    ...images,
  ].slice(0, OUTPUTS_MAX);
  if (outputs.length === 0) outputs.push({ simpleText: { text: '(응답이 없어요)' } });

  const template = { outputs };
  if (quickReplies.length > 0) template.quickReplies = quickReplies.slice(0, QUICK_MAX);
  return { version: '2.0', template };
}
