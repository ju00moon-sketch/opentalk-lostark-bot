import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { validateConfig } from './config.js';
import { createStore } from './store.js';
import { createUnlinkInbox } from './inbox.js';
import { authorizationUrl, exchangeIdentity, unlinkKakao } from './providers.js';
import { guildRoutes, handleGuild } from './guild-api.js';
import { GuildError } from './guild-store.js';
import { verifyAutomaticMembership } from './guild-automatic.js';

const BINDING = '__Host-web_binding';
const SESSION = '__Host-web_session';
const NONCE = /^[A-Za-z0-9_-]{43}$/;
const STATE_TTL_SECONDS = 300;
const SESSION_SECONDS = 7 * 86400;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const nonce = () => randomBytes(32).toString('base64url');
const csrf = (token) => createHash('sha256').update(`web-csrf:${token}`).digest('base64url');
const cookie = (name, value, seconds) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${seconds}`;

function equal(left, right) {
  return typeof left === 'string' && timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
}

class RequestError extends Error {
  constructor(status, code = 'invalid_request') { super(code); this.status = status; this.code = code; }
}

function readCookies(header = '') {
  if (header.length > 4096) throw new RequestError(431);
  const cookies = Object.create(null);
  for (const item of header.split(';')) {
    if (!item.trim()) continue;
    const index = item.indexOf('=');
    if (index < 1) throw new RequestError(400);
    const name = item.slice(0, index).trim();
    const value = item.slice(index + 1).trim();
    if (name !== BINDING && name !== SESSION) continue;
    if (name in cookies || !NONCE.test(value)) throw new RequestError(400);
    cookies[name] = value;
  }
  return cookies;
}

async function checkRequest(request) {
  if (!request.url || request.url.length > 4096) throw new RequestError(414);
  if (!request.url.startsWith('/') || request.url.startsWith('//') || request.rawHeaders.length > 100) throw new RequestError(400);
  if (Number(request.headers['content-length'] || 0) > 1024) throw new RequestError(413);
  const cookies = readCookies(request.headers.cookie);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024) throw new RequestError(413);
    chunks.push(chunk);
  }
  if (size && request.url !== '/api/auth/kakao/unlink' && guildRoutes[request.url.split('?')[0]] !== 'POST') throw new RequestError(400);
  return { cookies, body: Buffer.concat(chunks).toString('utf8') };
}

function requestIp(request) {
  const remote = request.socket.remoteAddress;
  const forwarded = request.headers['x-real-ip'];
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) && typeof forwarded === 'string' && isIP(forwarded)) return forwarded;
  return remote || 'unknown';
}

export function createWebServer({ config: input, fetchImpl = fetch, now = Date.now, allowHttpForTests = false }) {
  const config = validateConfig(input, allowHttpForTests);
  const store = createStore(config.dbPath);
  let inbox;
  try { inbox = createUnlinkInbox(`${config.dbPath}.unlink-inbox`); }
  catch (error) { store.close(); throw error; }
  const providers = Object.fromEntries(Object.entries(config.providers).map(([name, value]) => [name, Boolean(value.clientId && value.clientSecret && (name !== 'kakao' || (value.adminKey && value.appId)))]));
  const attempts = new Map();
  const deletions = new Map();
  let storageFailed = false;
  let closing;
  let retries;

  function executeDeletion(userId) {
    if (deletions.has(userId)) return deletions.get(userId);
    const task = (async () => {
      const intent = store.deletion(userId);
      if (!intent) return;
      if (!intent.confirmed) {
        try { await unlinkKakao(config, intent.providerId, fetchImpl); }
        catch {
          store.retryDeletion(userId, now());
          throw new RequestError(502, 'provider_error');
        }
        store.confirmDeletion(userId);
      }
      store.deleteLocalAccount(userId);
    })().finally(() => deletions.delete(userId));
    deletions.set(userId, task);
    return task;
  }

  function retryDeletions() {
    if (retries || closing || !providers.kakao) return;
    retries = (async () => {
      for (const item of store.pendingDeletions(now())) {
        if (closing) break;
        try { await executeDeletion(item.userId); }
        catch (error) { if (!(error instanceof RequestError)) storageFailed = true; }
      }
    })().catch(() => { storageFailed = true; }).finally(() => { retries = null; });
  }

  function rateAllowed(request, action, timestamp) {
    const key = `${action}:${requestIp(request)}`;
    let entry = attempts.get(key);
    if (!entry || entry.expiresAt <= timestamp) {
      if (!entry && attempts.size >= 10000) return false;
      entry = { count: 0, expiresAt: timestamp + 600000 };
      attempts.set(key, entry);
    }
    entry.count += 1;
    return entry.count <= (action === 'start' ? 30 : 60);
  }
  function cleanup() {
    const timestamp = now();
    for (const [key, value] of attempts) if (value.expiresAt <= timestamp) attempts.delete(key);
    try { store.cleanup(timestamp); storageFailed = false; } catch { storageFailed = true; }
    try {
      for (const userId of inbox.pending()) {
        try { store.externalUnlink(userId); inbox.remove(userId); }
        catch { storageFailed = true; break; }
      }
    } catch { storageFailed = true; }
    retryDeletions();
  }
  cleanup();
  const timer = setInterval(cleanup, 60000);
  timer.unref();

  function json(response, status, value) {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(value));
  }
  function getAuthorizedSession(token, timestamp) {
    if (!token) return undefined;
    const tokenHash = hash(token);
    const account = store.getAccount(tokenHash, timestamp);
    if (account?.provider === 'kakao' && inbox.has(account.providerId)) return undefined;
    return store.getSession(tokenHash, timestamp);
  }
  function redirect(response, error) {
    response.writeHead(303, { Location: `/account.html${error ? `?error=${error}` : ''}` });
    response.end();
  }
  function rateLimited(response, retryAfter) {
    response.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': String(retryAfter) });
    response.end('<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>로그인 요청 제한</title></head><body><main><p>로그인 요청이 잠시 많아졌어요. 잠시 후 다시 시도해 주세요.</p><a href="/account.html">로그인 화면으로 돌아가기</a></main></body></html>');
  }

  const server = createServer({ maxHeaderSize: 8192, requestTimeout: 10000, headersTimeout: 5000, keepAliveTimeout: 5000 }, async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Pragma', 'no-cache');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    let isAuthRoute = false;
    try {
      const { cookies, body } = await checkRequest(request);
      const url = new URL(request.url, config.origin);
      const authRoute = /^\/auth\/(discord|kakao)\/(start|callback)$/.exec(url.pathname);
      isAuthRoute = Boolean(authRoute);
      const guildMethod = Object.hasOwn(guildRoutes, url.pathname) ? guildRoutes[url.pathname] : null;
      const method = guildMethod || (url.pathname === '/api/auth/account' ? 'DELETE' : ['/api/auth/logout', '/api/auth/kakao/unlink'].includes(url.pathname) ? 'POST' : 'GET');
      if (!authRoute && !guildMethod && !['/api/auth/session', '/api/auth/logout', '/api/auth/account', '/api/auth/kakao/unlink', '/api/auth/health'].includes(url.pathname)) return json(response, 404, { error: 'not_found' });
      if (request.method !== method) {
        response.setHeader('Allow', method);
        return json(response, 405, { error: 'method_not_allowed' });
      }
      if (storageFailed && url.pathname !== '/api/auth/kakao/unlink') throw new Error('Storage unavailable');
      const timestamp = now();
      if (url.pathname === '/api/auth/health') {
        if (inbox.hasAny()) throw new Error('Unlink inbox needs recovery');
        store.healthy();
        return json(response, 200, { ok: true });
      }
      const token = cookies[SESSION];
      if (guildMethod) {
        const user = getAuthorizedSession(token, timestamp);
        if (!user) return json(response, 401, { error: 'login_required' });
        if (guildMethod === 'POST') {
          if (request.headers.origin !== config.origin || !equal(request.headers['x-csrf-token'], csrf(token))) return json(response, 403, { error: 'forbidden' });
          if (!rateAllowed(request, 'guild-write', timestamp)) return json(response, 429, { error: 'rate_limited' });
        }
        const targetAvailable = (userId) => {
          const identity = store.identity(userId);
          return Boolean(identity && (identity.provider !== 'kakao' || !inbox.has(identity.providerId)));
        };
        if (url.pathname === '/api/auth/guild/automatic') {
          if (url.search || request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new RequestError(400);
          let value;
          try { value = JSON.parse(body); } catch { throw new RequestError(400); }
          if (!value || Array.isArray(value) || Object.keys(value).length !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new RequestError(400);
          if (!config.automaticApproval.enabled) throw new GuildError(503, 'automatic_unavailable');
          const state = nonce(); const verifier = nonce(); const binding = cookies[BINDING] || nonce();
          store.guild.beginAutomatic({ stateHash: hash(state), userId: user.id, sessionHash: hash(token), bindingHash: hash(binding), verifier, revision: value.revision }, timestamp);
          response.setHeader('Set-Cookie', cookie(BINDING, binding, STATE_TTL_SECONDS));
          return json(response, 200, { authorizationUrl: authorizationUrl('discord', config, state, verifier, true) });
        }
        const result = handleGuild({ store, user, url, body, request, timestamp, targetAvailable });
        if (config.automaticApproval.enabled && ['/api/auth/guild', '/api/auth/guild/apply', '/api/auth/guild/verification'].includes(url.pathname)) {
          const reason = store.guild.automaticReason(user.id);
          result.automaticApproval = { enabled: true, eligible: reason === null, reason };
        }
        return json(response, 200, result);
      }
      if (url.pathname === '/api/auth/kakao/unlink') {
        if (!config.providers.kakao.adminKey || !config.providers.kakao.appId) return json(response, 503, { error: 'provider_unavailable' });
        if (!equal(request.headers.authorization, `KakaoAK ${config.providers.kakao.adminKey}`)) return json(response, 403, { error: 'forbidden' });
        if (request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') throw new RequestError(400);
        const fields = new URLSearchParams(body);
        const appId = fields.get('app_id');
        const userId = fields.get('user_id');
        if (fields.getAll('app_id').length !== 1 || fields.getAll('user_id').length !== 1 || appId !== config.providers.kakao.appId ||
            !/^[1-9][0-9]{0,15}$/.test(userId || '') || !Number.isSafeInteger(Number(userId))) throw new RequestError(400);
        let durable = false;
        try { inbox.enqueue(userId); durable = true; } catch {}
        try {
          store.externalUnlink(userId);
          try { inbox.remove(userId); } catch {}
        } catch {
          if (!durable) throw new Error('Unlink storage unavailable');
        }
        response.writeHead(200);
        return response.end();
      }
      if (url.pathname === '/api/auth/session') {
        const user = getAuthorizedSession(token, timestamp);
        if (token && !user) response.setHeader('Set-Cookie', cookie(SESSION, '', 0));
        return json(response, 200, user ? { authenticated: true, providers, user, csrfToken: csrf(token) } : { authenticated: false, providers });
      }
      if (url.pathname === '/api/auth/logout' || url.pathname === '/api/auth/account') {
        if (request.headers.origin !== config.origin || !token || !equal(request.headers['x-csrf-token'], csrf(token)) || !getAuthorizedSession(token, timestamp)) {
          return json(response, 403, { error: 'forbidden' });
        }
        if (url.pathname === '/api/auth/account') {
          const account = store.getAccount(hash(token), timestamp);
          if (timestamp - account.authenticatedAt > 300000) return json(response, 401, { error: 'reauthentication_required' });
          if (account.provider === 'kakao') {
            if (!providers.kakao) return json(response, 503, { error: 'provider_unavailable' });
            store.beginDeletion(account, timestamp);
            await executeDeletion(account.id);
          } else store.deleteLocalAccount(account.id);
          response.writeHead(204, { 'Set-Cookie': cookie(SESSION, '', 0) });
          return response.end();
        }
        store.deleteSession(hash(token));
        response.writeHead(204, { 'Set-Cookie': cookie(SESSION, '', 0) });
        return response.end();
      }
      const [, provider, action] = authRoute;
      if (!rateAllowed(request, action, timestamp)) {
        return rateLimited(response, 600);
      }
      if (!providers[provider]) return redirect(response, 'provider_unavailable');
      if (provider === 'kakao' && inbox.hasAny()) return redirect(response, 'deletion_pending');
      if (action === 'start') {
        const state = nonce();
        const verifier = nonce();
        const binding = cookies[BINDING] || nonce();
        if (!store.addTransaction({ stateHash: hash(state), provider, bindingHash: hash(binding), verifier, expiresAt: timestamp + STATE_TTL_SECONDS * 1000 }, timestamp)) {
          return rateLimited(response, STATE_TTL_SECONDS);
        }
        response.writeHead(302, { Location: authorizationUrl(provider, config, state, verifier), 'Set-Cookie': cookie(BINDING, binding, STATE_TTL_SECONDS) });
        return response.end();
      }
      const values = url.searchParams;
      const state = values.get('state');
      const code = values.get('code');
      const error = values.get('error');
      if (values.getAll('state').length !== 1 || values.getAll('code').length > 1 || values.getAll('error').length > 1 ||
          !state || !NONCE.test(state) || !cookies[BINDING] || Boolean(code) === Boolean(error) ||
          (code && (code.length > 2048 || /[\x00-\x20\x7f]/.test(code)))) return redirect(response, 'invalid_request');
      const automatic = provider === 'discord' && token
        ? store.guild.consumeAutomatic(hash(state), hash(cookies[BINDING]), hash(token), timestamp) : null;
      if (automatic) {
        if (!config.automaticApproval.enabled) return redirect(response, 'automatic_unavailable');
        if (!getAuthorizedSession(token, timestamp) || getAuthorizedSession(token, timestamp).id !== automatic.userId) return redirect(response, 'automatic_state_changed');
        if (error) return redirect(response, error === 'access_denied' ? 'automatic_cancelled' : 'automatic_unavailable');
        try {
          await verifyAutomaticMembership(config, automatic, code, fetchImpl);
          store.guild.finishAutomatic(automatic, now());
        } catch (failure) { return redirect(response, failure instanceof GuildError ? failure.code : 'automatic_unavailable'); }
        response.writeHead(303, { Location: '/account.html?guild_auto=approved' });
        return response.end();
      }
      const transaction = store.consumeTransaction(hash(state), provider, hash(cookies[BINDING]), timestamp);
      if (!transaction) return redirect(response, 'invalid_request');
      if (error) return redirect(response, error === 'access_denied' ? 'access_denied' : 'provider_error');
      let identity;
      try { identity = await exchangeIdentity(provider, config, code, transaction.verifier, fetchImpl); }
      catch { return redirect(response, 'provider_error'); }
      if (provider === 'kakao' && inbox.has(identity.providerId)) return redirect(response, 'deletion_pending');
      const newToken = nonce();
      const completedAt = now();
      const sessionError = store.createSession({ ...identity, tokenHash: hash(newToken), oldTokenHash: token && hash(token), expiresAt: completedAt + SESSION_SECONDS * 1000, epoch: transaction.epoch }, completedAt);
      if (sessionError) return redirect(response, sessionError);
      response.setHeader('Set-Cookie', cookie(SESSION, newToken, SESSION_SECONDS));
      return redirect(response);
    } catch (error) {
      if (response.destroyed || response.writableEnded) return;
      response.setHeader('Connection', 'close');
      if (error instanceof RequestError || error instanceof GuildError) return json(response, error.status, { error: error.code });
      if (isAuthRoute) return redirect(response, 'server_error');
      return json(response, 503, { error: 'storage_unavailable' });
    }
  });
  server.on('clientError', (error, socket) => {
    if (!socket.writable) return;
    const status = error.code === 'HPE_HEADER_OVERFLOW' ? '431 Request Header Fields Too Large' : '400 Bad Request';
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  });
  return {
    server,
    close() {
      if (closing) return closing;
      clearInterval(timer);
      closing = new Promise((resolve, reject) => {
        const finish = (error) => { try { store.close(); } catch { error ||= new Error('Storage close failed'); } error ? reject(error) : resolve(); };
        const drain = (error) => { void Promise.allSettled([...deletions.values(), ...(retries ? [retries] : [])]).then(() => finish(error)); };
        if (server.listening) server.close(drain);
        else drain();
      });
      return closing;
    },
  };
}
