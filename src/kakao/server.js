// 카카오톡용 HTTP 서버. 디스코드 봇과 같은 프로세스에서 KAKAO_PORT가 있을 때만 켜진다.
//   POST /bridge/message/<KAKAO_SKILL_SECRET>  오픈채팅방 브리지 — 폰의 메신저봇R이 { room, sender, text }를 보내고 { text }를 받음
//   POST /kakao/skill/<KAKAO_SKILL_SECRET>     오픈빌더 스킬 요청 (채널 1:1 챗봇용, 항상 200 + JSON — 오류도 문구로)
//   GET  /health                               ok
//   GET  /assets/emoticons/<파일> · /assets/charts/<파일>  이미지 공개 서빙 (두 폴더의 직접 자식만)
// 웹서버의 예외는 여기서 전부 잡아 디스코드 클라이언트에 영향을 주지 않는다.
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleSkillRequest, handleBridgeMessage } from './handler.js';
import { textResponse } from './render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIRS = {
  emoticons: path.join(ROOT, 'assets', 'emoticons'),
  charts: path.join(ROOT, 'assets', 'charts'),
};
const CONTENT_TYPES = { '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_BODY = 1024 * 1024;
const TOO_LARGE = Symbol('too large');

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// 본문을 읽어 JSON으로. 1MB 초과면 TOO_LARGE, JSON이 아니면 undefined.
function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        // 더 모으지 않고 나머지는 흘려보낸다 — 끊어 버리면 클라이언트가 413을 못 받는다
        req.removeAllListeners('data');
        req.resume();
        resolve(TOO_LARGE);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(undefined); }
    });
    req.on('error', () => resolve(undefined));
  });
}

async function serveAsset(res, dir, rawName) {
  let name;
  try { name = decodeURIComponent(rawName); } catch { return sendText(res, 404, 'not found'); }
  // 파일명 하나만 — 경로 구분자·상위 이동·숨김 파일은 거절
  if (!name || name !== path.basename(name) || name.startsWith('.')) return sendText(res, 404, 'not found');
  const type = CONTENT_TYPES[path.extname(name).toLowerCase()];
  if (!type) return sendText(res, 404, 'not found');
  let real;
  let stat;
  try {
    real = await fs.realpath(path.join(dir, name));
    stat = await fs.stat(real);
  } catch { return sendText(res, 404, 'not found'); }
  // 심볼릭 링크로 폴더 밖을 가리키는 것도 거절
  if (!stat.isFile() || path.dirname(real) !== await fs.realpath(dir)) return sendText(res, 404, 'not found');
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' });
  createReadStream(real).pipe(res);
}

async function route(req, res, { commandMap, secret, baseUrl }) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') return sendText(res, 200, 'ok');

  const asset = /^\/assets\/(emoticons|charts)\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && asset) return serveAsset(res, PUBLIC_DIRS[asset[1]], asset[2]);

  const isSkill = url.pathname === `/kakao/skill/${secret}`;
  const isBridge = url.pathname === `/bridge/message/${secret}`;
  if (req.method === 'POST' && (isSkill || isBridge)) {
    const body = await readJson(req);
    if (body === TOO_LARGE) return sendText(res, 413, 'payload too large');
    if (body === undefined || typeof body !== 'object') return sendText(res, 400, 'invalid json');
    const response = isSkill
      ? await handleSkillRequest(body, commandMap, { baseUrl })
      : await handleBridgeMessage(body, commandMap, { baseUrl });
    return sendJson(res, 200, response);
  }
  return sendText(res, 404, 'not found');
}

export function startKakaoServer(commandMap, env = process.env) {
  const port = Number(env.KAKAO_PORT);
  if (!port) {
    console.log('카카오 스킬 서버: 꺼짐(KAKAO_PORT 없음)');
    return null;
  }
  const secret = env.KAKAO_SKILL_SECRET;
  const baseUrl = String(env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  if (!secret || !baseUrl) {
    console.error('카카오 스킬 서버: KAKAO_SKILL_SECRET과 PUBLIC_BASE_URL이 필요해요 — 켜지 않음');
    return null;
  }

  const server = createServer((req, res) => {
    route(req, res, { commandMap, secret, baseUrl }).catch((err) => {
      console.error('[카카오 서버]', err);
      if (!res.headersSent) sendJson(res, 200, textResponse(`오류가 발생했어요: ${err.message}`));
      else res.end();
    });
  });
  server.on('error', (err) => console.error('카카오 스킬 서버 오류:', err.message));
  server.listen(port, () => console.log(`카카오 스킬 서버: :${port} (이미지 ${baseUrl})`));
  return server;
}
