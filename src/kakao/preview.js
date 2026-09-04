// 카카오톡 링크 미리보기 카드용 페이지. 폰 봇은 그림을 못 보내지만, 메시지에 URL이 있으면 카톡이 그 페이지의
// og:image·og:title·og:description을 긁어 카드로 그려 준다. 그래서 이미지 대신 "이 페이지 주소"를 방에 보낸다.
//   GET /p/emo/<키워드>   이모티콘 카드 (이미지 = assets/emoticons/<키워드>.png)
//   GET /p/chart/<이름>   차트 카드   (이미지 = assets/charts/<이름>.png, 예: chembang)
//   GET /p/char/<닉네임>  캐릭터 카드 (이미지 = 전투정보실 캐릭터 이미지, 제목 = 칭호 + 닉네임, 설명 = 직업·서버·템렙)
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEmoticonFile, parseEmoticonKeyword } from '../emoticons.js';
import { getCharacterProfile } from '../lostark.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHARTS_DIR = path.join(ROOT, 'assets', 'charts');

const escapeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function page({ title, description, image, url }) {
  const t = escapeHtml(title);
  const d = escapeHtml(description);
  const i = escapeHtml(image);
  const u = escapeHtml(url);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="website">
<meta property="og:site_name" content="포근해용">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${d}">
<meta property="og:image" content="${i}">
<meta property="og:url" content="${u}">
<meta name="twitter:card" content="summary_large_image">
<title>${t} — 포근해용</title>
<style>body{margin:0;background:#16120e;color:#f2ece3;font-family:sans-serif;display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px}img{max-width:min(90vw,480px);border-radius:12px}h1{font-size:1.2rem;margin:0}p{margin:0;color:#a89a89}</style>
</head>
<body><img src="${i}" alt="${t}"><h1>${t}</h1><p>${d}</p></body>
</html>
`;
}

const notFound = { status: 404, html: '<!DOCTYPE html><meta charset="utf-8"><title>없음</title>없는 카드예요.' };

// kind·id로 카드 페이지를 만든다 → { status, html }. 실패는 404.
export async function renderPreview(kind, rawId, { baseUrl, emoticonsEnabled = true }) {
  let id;
  try { id = decodeURIComponent(rawId).trim(); } catch { return notFound; }
  if (!id || id.length > 30) return notFound;

  if (kind === 'emo') {
    if (!emoticonsEnabled || !parseEmoticonKeyword(`[${id}`)) return notFound;
    const file = findEmoticonFile(id);
    if (!file) return notFound;
    const image = `${baseUrl}/assets/emoticons/${encodeURIComponent(path.basename(file))}`;
    return { status: 200, html: page({ title: id, description: '포근해용 이모티콘', image, url: `${baseUrl}/p/emo/${encodeURIComponent(id)}` }) };
  }

  if (kind === 'chart') {
    if (!/^[A-Za-z0-9_-]+$/.test(id) || !existsSync(path.join(CHARTS_DIR, `${id}.png`))) return notFound;
    const image = `${baseUrl}/assets/charts/${id}.png`;
    return { status: 200, html: page({ title: '직업별 체방 계수', description: '포근해용 · /체방', image, url: `${baseUrl}/p/chart/${id}` }) };
  }

  if (kind === 'char') {
    let profile = null;
    try { profile = await getCharacterProfile(id); } catch { /* 닉네임에 못 쓰는 문자 등 — 404로 */ }
    if (!profile?.CharacterImage) return notFound;
    const title = `${profile.Title ? `${profile.Title} ` : ''}${profile.CharacterName}`;
    const description = `${profile.CharacterClassName} · ${profile.ServerName} · Lv.${profile.ItemAvgLevel}`;
    return {
      status: 200,
      html: page({ title, description, image: profile.CharacterImage, url: `${baseUrl}/p/char/${encodeURIComponent(profile.CharacterName)}` }),
    };
  }
  return notFound;
}
