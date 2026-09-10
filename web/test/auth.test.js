import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, readdir, rename, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createWebServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

const ORIGIN = 'https://pogeunhaeyong.duckdns.org';
const SESSION = '__Host-web_session';
const BINDING = '__Host-web_binding';
const DAY = 86400000;

function cookieValue(response, name) {
  return response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))?.split(';')[0];
}

async function assertRevoked(h, auth, csrfToken) {
  const response = await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } });
  assert.deepEqual(await response.json(), { authenticated: false, providers: { discord: true, kakao: true } });
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  for (const [path, method] of [['/api/auth/logout', 'POST'], ['/api/auth/account', 'DELETE']]) {
    const denied = await h.request(path, { method, headers: { Cookie: auth.cookie, Origin: ORIGIN, 'X-CSRF-Token': csrfToken } });
    assert.equal(denied.status, 403);
    assert.deepEqual(await denied.json(), { error: 'forbidden' });
  }
}

async function assertRateLimit(response, retryAfter) {
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), retryAfter);
  assert.match(response.headers.get('content-type'), /^text\/html; charset=utf-8$/);
  const body = await response.text();
  assert.ok(body.includes('로그인 요청이 잠시 많아졌어요. 잠시 후 다시 시도해 주세요.'));
  assert.match(body, /<a href="\/account\.html">[^<]+<\/a>/);
  assert.doesNotMatch(body, /<script|https?:\/\//i);
}

async function harness(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'web-auth-test-'));
  const config = {
    origin: ORIGIN, host: '127.0.0.1', port: 0, dbPath: join(dir, 'auth.sqlite'),
    providers: {
      discord: { clientId: '123456789012345678', clientSecret: 'discord-test-secret' },
      kakao: { clientId: 'kakao-test-client', clientSecret: 'kakao-test-secret', adminKey: 'kakao-admin-secret', appId: '123456' },
    },
    ...options.config,
  };
  let timestamp = 1790000000000;
  let service;
  let base;
  let mode = 'normal';
  const calls = [];
  const authorize = new Map();
  const fakeFetch = async (url, init = {}) => {
    const target = new URL(url);
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    calls.push(target.pathname);
    if (options.fetchImpl) return options.fetchImpl(url, init);
    if (target.pathname === '/v1/user/unlink') {
      assert.equal(init.headers.Authorization, 'KakaoAK kakao-admin-secret');
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('target_id_type'), 'user_id');
      assert.equal(body.get('target_id'), '3456789012');
      if (options.beforeUnlink) await options.beforeUnlink();
      if (mode === 'unlink-failure') return Response.json({ code: -401, msg: 'private-provider-error' }, { status: 401 });
      if (mode === 'already-unlinked') return Response.json({ code: -101, msg: 'NotRegisteredUserException' }, { status: 400 });
      if (mode === 'forged-unlink-success') return Response.json({ alreadyUnlinked: true });
      return Response.json({ id: mode === 'wrong-unlink-id' ? 999 : 3456789012 });
    }
    if (mode === 'failure') return Response.json({ error: 'provider-secret-do-not-expose' }, { status: 400 });
    if (mode === 'oversize') return new Response('x'.repeat(70000), { headers: { 'content-type': 'application/json' } });
    if (mode === 'timeout') return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    if (target.pathname.endsWith('/token')) {
      assert.match(init.headers['Content-Type'], /application\/x-www-form-urlencoded/);
      const body = new URLSearchParams(init.body);
      const provider = target.hostname === 'discord.com' ? 'discord' : 'kakao';
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('client_id'), config.providers[provider].clientId);
      assert.equal(body.get('client_secret'), config.providers[provider].clientSecret);
      assert.equal(body.get('redirect_uri'), `${ORIGIN}/auth/${provider}/callback`);
      const challenge = createHash('sha256').update(body.get('code_verifier')).digest('base64url');
      assert.equal(challenge, authorize.get(body.get('code')));
      return Response.json({ access_token: `${provider}-access-secret`, token_type: 'Bearer', expires_in: 3600, refresh_token: 'refresh-secret' });
    }
    const provider = target.hostname === 'discord.com' ? 'discord' : 'kakao';
    assert.equal(init.headers.Authorization, `Bearer ${provider}-access-secret`);
    if (options.beforeProfile) await options.beforeProfile();
    if (provider === 'discord') {
      assert.equal(target.pathname, '/api/v10/users/@me');
      return Response.json({ id: '765432109876543210', username: 'member', global_name: mode === 'rename' ? '새 닉네임' : '같은 닉네임', avatar: null });
    }
    assert.equal(target.pathname, '/v2/user/me');
    return Response.json({ id: mode === 'unsafe-id' ? 9007199254740992 : mode === 'other-user' ? 3456789999 : 3456789012, kakao_account: { profile: { nickname: '같은 닉네임' } } });
  };
  async function open() {
    service = createWebServer({ config, fetchImpl: fakeFetch, now: () => timestamp });
    service.server.listen(0, '127.0.0.1');
    await once(service.server, 'listening');
    base = `http://127.0.0.1:${service.server.address().port}`;
  }
  await open();
  t.after(async () => { await service.close(); await rm(dir, { recursive: true, force: true }); });
  const request = (path, init = {}) => fetch(`${base}${path}`, { redirect: 'manual', ...init });
  async function start(provider = 'discord', cookie, headers = {}) {
    const response = await request(`/auth/${provider}/start`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers } });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    const state = location.searchParams.get('state');
    authorize.set(state, location.searchParams.get('code_challenge'));
    const otherCookies = cookie?.split(';').map((value) => value.trim()).filter((value) => !value.startsWith(`${BINDING}=`)) || [];
    return { response, location, state, cookie: [cookieValue(response, BINDING), ...otherCookies].filter(Boolean).join('; ') };
  }
  const callback = (flow, provider = 'discord', query = `code=${flow.state}&state=${flow.state}`, cookie = flow.cookie) =>
    request(`/auth/${provider}/callback?${query}`, { headers: { Cookie: cookie || '' } });
  async function login(provider = 'discord', cookie) {
    const flow = await start(provider, cookie);
    const response = await callback(flow, provider);
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/account.html');
    return { flow, response, cookie: cookieValue(response, SESSION) };
  }
  return { config, request, start, callback, login, calls, setMode: (next) => { mode = next; }, advance: (ms) => { timestamp += ms; }, restart: async () => { await service.close(); await open(); } };
}

test('anonymous session, health and unavailable providers expose no credentials', async (t) => {
  const h = await harness(t, { config: { providers: { discord: {}, kakao: {} } } });
  const response = await h.request('/api/auth/session');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { authenticated: false, providers: { discord: false, kakao: false } });
  assert.deepEqual(await (await h.request('/api/auth/health')).json(), { ok: true });
  assert.equal((await h.request('/auth/kakao/start')).headers.get('location'), '/account.html?error=provider_unavailable');
});

test('both provider flows use PKCE, secure cookies and distinct stable member identities', async (t) => {
  const h = await harness(t);
  const discord = await h.login();
  assert.equal(discord.flow.location.origin, 'https://discord.com');
  assert.equal(discord.flow.location.searchParams.get('scope'), 'identify');
  assert.equal(discord.flow.location.searchParams.get('code_challenge_method'), 'S256');
  assert.match(discord.flow.state, /^[A-Za-z0-9_-]{43}$/);
  for (const response of [discord.flow.response, discord.response]) {
    assert.ok(response.headers.getSetCookie().length);
    for (const value of response.headers.getSetCookie()) {
      assert.match(value, /^__Host-/);
      assert.match(value, /; Secure/);
      assert.match(value, /; HttpOnly/);
      assert.match(value, /; SameSite=Lax/);
      assert.match(value, /; Path=\//);
      assert.doesNotMatch(value, /Domain=/i);
    }
  }
  const first = await (await h.request('/api/auth/session', { headers: { Cookie: discord.cookie } })).json();
  assert.equal(first.authenticated, true);
  assert.equal(first.user.provider, 'discord');
  assert.equal(first.user.displayName, '같은 닉네임');
  assert.match(first.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  const kakao = await h.login('kakao');
  for (const auth of [discord, kakao]) {
    assert.match(auth.flow.response.headers.get('set-cookie'), /; Max-Age=300(?:;|$)/);
    assert.match(auth.response.headers.get('set-cookie'), /; Max-Age=604800(?:;|$)/);
  }
  assert.equal(kakao.flow.location.origin, 'https://kauth.kakao.com');
  assert.equal(kakao.flow.location.searchParams.get('scope'), 'profile_nickname');
  const second = await (await h.request('/api/auth/session', { headers: { Cookie: kakao.cookie } })).json();
  assert.notEqual(first.user.id, second.user.id);
  assert.equal(second.user.provider, 'kakao');
});

test('state is browser/provider bound and cannot be absent, duplicated, forged or reused', async (t) => {
  const h = await harness(t);
  const flow = await h.start();
  for (const query of [`code=${flow.state}`, `code=${flow.state}&state=forged`, `code=${flow.state}&state=${flow.state}&state=${flow.state}`, `code=a&code=b&state=${flow.state}`]) {
    assert.equal((await h.callback(flow, 'discord', query)).headers.get('location'), '/account.html?error=invalid_request');
  }
  assert.equal((await h.callback(flow, 'kakao')).headers.get('location'), '/account.html?error=invalid_request');
  assert.equal((await h.callback(flow, 'discord', undefined, `${BINDING}=${'A'.repeat(43)}`)).headers.get('location'), '/account.html?error=invalid_request');
  assert.equal(h.calls.length, 0);
  assert.equal((await h.callback(flow)).headers.get('location'), '/account.html');
  assert.equal((await h.callback(flow)).headers.get('location'), '/account.html?error=invalid_request');
  assert.equal(h.calls.length, 2);
});

test('denial consumes only a valid bound transaction and expired states fail closed', async (t) => {
  const h = await harness(t);
  const flow = await h.start();
  const denial = `error=access_denied&error_description=private-details&state=${flow.state}`;
  assert.equal((await h.callback(flow, 'discord', denial, '')).headers.get('location'), '/account.html?error=invalid_request');
  assert.equal((await h.callback(flow, 'discord', denial)).headers.get('location'), '/account.html?error=access_denied');
  assert.equal((await h.callback(flow)).headers.get('location'), '/account.html?error=invalid_request');
  assert.equal(h.calls.length, 0);
  const almostExpired = await h.start();
  h.advance(299999);
  assert.equal((await h.callback(almostExpired)).headers.get('location'), '/account.html');
  const expired = await h.start();
  h.advance(300000);
  assert.equal((await h.callback(expired)).headers.get('location'), '/account.html?error=invalid_request');
  assert.equal(h.calls.length, 2);
});

test('parallel callbacks consume a state once and repeated login keeps one member', async (t) => {
  const h = await harness(t);
  const flow = await h.start();
  const replies = await Promise.all([h.callback(flow), h.callback(flow)]);
  assert.deepEqual(replies.map((r) => r.headers.get('location')).sort(), ['/account.html', '/account.html?error=invalid_request']);
  const oldCookie = cookieValue(replies.find((r) => r.headers.get('location') === '/account.html'), SESSION);
  const original = await (await h.request('/api/auth/session', { headers: { Cookie: oldCookie } })).json();
  h.setMode('rename');
  const replacement = await h.login('discord', `${flow.cookie}; ${oldCookie}`);
  const current = await (await h.request('/api/auth/session', { headers: { Cookie: replacement.cookie } })).json();
  assert.equal(current.user.id, original.user.id);
  assert.equal(current.user.displayName, '새 닉네임');
  assert.equal((await (await h.request('/api/auth/session', { headers: { Cookie: oldCookie } })).json()).authenticated, false);
  const db = new DatabaseSync(h.config.dbPath, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  db.close();
});

test('session survives restart, expires after seven days, and stores no raw credentials', async (t) => {
  const h = await harness(t);
  const auth = await h.login();
  await h.restart();
  const status = () => h.request('/api/auth/session', { headers: { Cookie: auth.cookie } });
  assert.equal((await (await status()).json()).authenticated, true);
  const bytes = await readFile(h.config.dbPath);
  for (const value of [auth.cookie.split('=')[1], auth.flow.cookie.split('=')[1], auth.flow.state, 'discord-access-secret', 'refresh-secret', 'discord-test-secret']) {
    assert.equal(bytes.includes(Buffer.from(value)), false);
  }
  h.advance(7 * DAY);
  assert.equal((await (await status()).json()).authenticated, false);
});

test('logout requires same-origin CSRF token and invalidates the server session', async (t) => {
  const h = await harness(t);
  const auth = await h.login();
  const status = await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json();
  for (const headers of [{ Origin: 'https://evil.example', 'X-CSRF-Token': status.csrfToken }, { Origin: ORIGIN }, { Origin: ORIGIN, 'X-CSRF-Token': 'wrong' }]) {
    assert.equal((await h.request('/api/auth/logout', { method: 'POST', headers: { Cookie: auth.cookie, ...headers } })).status, 403);
  }
  const response = await h.request('/api/auth/logout', { method: 'POST', headers: { Cookie: auth.cookie, Origin: ORIGIN, 'X-CSRF-Token': status.csrfToken } });
  assert.equal(response.status, 204);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json()).authenticated, false);
});

test('provider errors, oversized bodies and unsafe IDs create no account or leaked response', async (t) => {
  const h = await harness(t);
  for (const [mode, provider] of [['failure', 'discord'], ['oversize', 'discord'], ['unsafe-id', 'kakao']]) {
    h.setMode(mode);
    const flow = await h.start(provider);
    const response = await h.callback(flow, provider);
    assert.equal(response.headers.get('location'), '/account.html?error=provider_error');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.doesNotMatch(await response.text(), /secret|access_token|refresh_token|stack/i);
  }
  const db = new DatabaseSync(h.config.dbPath, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  db.close();
});

test('external token exchange aborts within eight seconds', { timeout: 11000 }, async (t) => {
  const h = await harness(t);
  h.setMode('timeout');
  const flow = await h.start();
  const began = performance.now();
  const response = await h.callback(flow);
  assert.equal(response.headers.get('location'), '/account.html?error=provider_error');
  assert.ok(performance.now() - began < 9000);
});

test('routes reject unsupported methods, excess URL/cookie/body and duplicate session cookies', async (t) => {
  const h = await harness(t);
  assert.equal((await h.request('/api/auth/missing')).status, 404);
  assert.equal((await h.request('/api/auth/session', { method: 'POST' })).status, 405);
  assert.equal((await h.request('/api/auth/logout')).status, 405);
  assert.equal((await h.request(`/api/auth/session?x=${'x'.repeat(4200)}`)).status, 414);
  assert.equal((await h.request('/api/auth/session', { headers: { Cookie: `x=${'x'.repeat(4200)}` } })).status, 431);
  assert.equal((await h.request('/api/auth/logout', { method: 'POST', body: 'x'.repeat(2000) })).status, 413);
  const duplicate = `${SESSION}=${'A'.repeat(43)}; ${SESSION}=${'B'.repeat(43)}`;
  assert.equal((await h.request('/api/auth/session', { headers: { Cookie: duplicate } })).status, 400);
});

test('auth traffic is bounded by IP and the global pending transaction limit', async (t) => {
  const h = await harness(t);
  const results = [];
  for (let i = 0; i < 31; i++) results.push(await h.request('/auth/discord/start'));
  await assertRateLimit(results.at(-1), '600');
  h.advance(600000);
  assert.equal((await h.request('/auth/discord/start')).status, 302);
  for (let i = 0; i < 1000; i++) {
    await h.request('/auth/discord/start', { headers: { 'X-Real-IP': `10.0.${Math.floor(i / 250)}.${i % 250 + 1}` } });
  }
  await assertRateLimit(await h.request('/auth/discord/start', { headers: { 'X-Real-IP': '10.100.0.1' } }), '300');
});

test('deletion requires recent same-origin CSRF authentication and removes every Discord session', async (t) => {
  const h = await harness(t);
  const first = await h.login();
  const second = await h.login();
  const status = await (await h.request('/api/auth/session', { headers: { Cookie: first.cookie } })).json();
  const headers = { Cookie: first.cookie, Origin: ORIGIN, 'X-CSRF-Token': status.csrfToken };
  assert.equal((await h.request('/api/auth/account', { method: 'DELETE', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
  h.advance(300001);
  const old = await h.request('/api/auth/account', { method: 'DELETE', headers });
  assert.equal(old.status, 401);
  assert.deepEqual(await old.json(), { error: 'reauthentication_required' });
  const fresh = await h.login();
  const current = await (await h.request('/api/auth/session', { headers: { Cookie: fresh.cookie } })).json();
  const deleted = await h.request('/api/auth/account', { method: 'DELETE', headers: { Cookie: fresh.cookie, Origin: ORIGIN, 'X-CSRF-Token': current.csrfToken } });
  assert.equal(deleted.status, 204);
  for (const item of [first, second, fresh]) assert.equal((await (await h.request('/api/auth/session', { headers: { Cookie: item.cookie } })).json()).authenticated, false);
  const db = new DatabaseSync(h.config.dbPath, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  db.close();
});

test('Kakao withdrawal verifies remote identity and durable retry completes an already-unlinked account', async (t) => {
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const h = await harness(t, { beforeUnlink: () => { entered(); return blocked; } });
  const auth = await h.login('kakao');
  const status = await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json();
  const headers = { Cookie: auth.cookie, Origin: ORIGIN, 'X-CSRF-Token': status.csrfToken };
  h.setMode('wrong-unlink-id');
  const deleting = h.request('/api/auth/account', { method: 'DELETE', headers });
  await started;
  try {
    await assertRevoked(h, auth, status.csrfToken);
    assert.equal((await h.request('/api/auth/health')).status, 503);
  } finally { release(); }
  const failed = await deleting;
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), { error: 'provider_error' });
  await assertRevoked(h, auth, status.csrfToken);
  let db = new DatabaseSync(h.config.dbPath, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM deletion_intents').get().count, 1);
  db.close();
  const flow = await h.start('kakao');
  assert.equal((await h.callback(flow, 'kakao')).headers.get('location'), '/account.html?error=deletion_pending');
  h.setMode('already-unlinked');
  h.advance(120000);
  await h.restart();
  for (let i = 0; i < 100; i++) {
    if ((await h.request('/api/auth/health')).status === 200) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json()).authenticated, false);
  db = new DatabaseSync(h.config.dbPath, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM deletion_intents').get().count, 0);
  db.close();
});

test('unlink confirmation write failure revokes every session before and after restart until retry', async (t) => {
  const h = await harness(t);
  const first = await h.login('kakao');
  const second = await h.login('kakao');
  const discord = await h.login('discord');
  h.setMode('other-user');
  const otherKakao = await h.login('kakao');
  h.setMode('normal');
  const firstSession = await (await h.request('/api/auth/session', { headers: { Cookie: first.cookie } })).json();
  const secondSession = await (await h.request('/api/auth/session', { headers: { Cookie: second.cookie } })).json();
  const discordSession = await (await h.request('/api/auth/session', { headers: { Cookie: discord.cookie } })).json();
  const otherKakaoSession = await (await h.request('/api/auth/session', { headers: { Cookie: otherKakao.cookie } })).json();
  const db = new DatabaseSync(h.config.dbPath);
  db.exec("CREATE TRIGGER confirmation_failure BEFORE UPDATE OF confirmed ON deletion_intents BEGIN SELECT RAISE(ABORT, 'confirmation unavailable'); END;");
  try {
    const failed = await h.request('/api/auth/account', { method: 'DELETE', headers: { Cookie: first.cookie, Origin: ORIGIN, 'X-CSRF-Token': firstSession.csrfToken } });
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: 'storage_unavailable' });
    assert.equal(h.calls.filter((path) => path === '/v1/user/unlink').length, 1);
    assert.equal(db.prepare('SELECT confirmed FROM deletion_intents').get().confirmed, 0);
    for (const restart of [false, true]) {
      if (restart) await h.restart();
      await assertRevoked(h, first, firstSession.csrfToken);
      await assertRevoked(h, second, secondSession.csrfToken);
      assert.equal((await h.request('/api/auth/health')).status, 503);
      assert.deepEqual(await (await h.request('/api/auth/session', { headers: { Cookie: discord.cookie } })).json(), discordSession);
      assert.deepEqual(await (await h.request('/api/auth/session', { headers: { Cookie: otherKakao.cookie } })).json(), otherKakaoSession);
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 4);
    }
  } finally {
    db.exec('DROP TRIGGER confirmation_failure');
    db.close();
  }
  h.setMode('already-unlinked');
  h.advance(60001);
  await h.restart();
  for (let i = 0; i < 100; i++) {
    if ((await h.request('/api/auth/health')).status === 200) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal((await h.request('/api/auth/health')).status, 200);
  assert.equal((await (await h.request('/api/auth/session', { headers: { Cookie: second.cookie } })).json()).authenticated, false);
  assert.deepEqual(await (await h.request('/api/auth/session', { headers: { Cookie: discord.cookie } })).json(), discordSession);
  assert.deepEqual(await (await h.request('/api/auth/session', { headers: { Cookie: otherKakao.cookie } })).json(), otherKakaoSession);
  assert.equal(h.calls.filter((path) => path === '/v1/user/unlink').length, 2);
  const recovered = new DatabaseSync(h.config.dbPath, { readOnly: true });
  assert.equal(recovered.prepare('SELECT COUNT(*) AS count FROM deletion_intents').get().count, 0);
  assert.equal(recovered.prepare('SELECT COUNT(*) AS count FROM users').get().count, 2);
  assert.equal(recovered.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 2);
  recovered.close();
});

test('failure to persist deletion intent never calls the provider or revokes sessions', async (t) => {
  const h = await harness(t);
  const auth = await h.login('kakao');
  const session = await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json();
  const db = new DatabaseSync(h.config.dbPath);
  db.exec("CREATE TRIGGER intent_failure BEFORE INSERT ON deletion_intents BEGIN SELECT RAISE(ABORT, 'intent unavailable'); END;");
  try {
    const failed = await h.request('/api/auth/account', { method: 'DELETE', headers: { Cookie: auth.cookie, Origin: ORIGIN, 'X-CSRF-Token': session.csrfToken } });
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: 'storage_unavailable' });
    assert.equal(h.calls.filter((path) => path === '/v1/user/unlink').length, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM deletion_intents').get().count, 0);
    assert.deepEqual(await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json(), session);
  } finally {
    db.exec('DROP TRIGGER intent_failure');
    db.close();
  }
});

test('Kakao webhook authenticates, validates app and user, deletes sessions and is idempotent', async (t) => {
  const h = await harness(t);
  const auth = await h.login('kakao');
  const discord = await h.login();
  const post = (body, authorization = 'KakaoAK kakao-admin-secret') => h.request('/api/auth/kakao/unlink', {
    method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const payload = 'app_id=123456&user_id=3456789012&referrer_type=UNLINK_FROM_APPS';
  assert.equal((await post(payload, 'KakaoAK wrong')).status, 403);
  assert.equal((await post(payload.replace('123456', '999'))).status, 400);
  assert.equal((await post(`${payload}&user_id=765432109876543210`)).status, 400);
  const before = performance.now();
  assert.equal((await post(payload)).status, 200);
  assert.ok(performance.now() - before < 3000);
  assert.equal((await post(payload)).status, 200);
  assert.equal((await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json()).authenticated, false);
  assert.equal((await (await h.request('/api/auth/session', { headers: { Cookie: discord.cookie } })).json()).authenticated, true);
  assert.equal(h.calls.filter((path) => path === '/v1/user/unlink').length, 0);
});

test('missing Kakao lifecycle keys disable login and unsafe production settings are rejected', async (t) => {
  const h = await harness(t, { config: { providers: { discord: {}, kakao: { clientId: 'present', clientSecret: 'present' } } } });
  assert.equal((await (await h.request('/api/auth/session')).json()).providers.kakao, false);
  assert.throws(() => loadConfig({ WEB_ORIGIN: 'http://pogeunhaeyong.duckdns.org', WEB_DB_PATH: h.config.dbPath }));
  assert.throws(() => loadConfig({ WEB_ORIGIN: ORIGIN, WEB_DB_PATH: h.config.dbPath, WEB_HOST: '0.0.0.0' }));
  assert.throws(() => loadConfig({ WEB_ORIGIN: ORIGIN, WEB_DB_PATH: 'relative.sqlite' }));
});

test('a malformed unlink success cannot bypass matching the provider ID', async (t) => {
  const h = await harness(t);
  const auth = await h.login('kakao');
  const session = await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json();
  h.setMode('forged-unlink-success');
  const reply = await h.request('/api/auth/account', { method: 'DELETE', headers: { Cookie: auth.cookie, Origin: ORIGIN, 'X-CSRF-Token': session.csrfToken } });
  assert.equal(reply.status, 502);
});

test('confirmed remote unlink remains recoverable after local deletion failure', async (t) => {
  const h = await harness(t);
  const auth = await h.login('kakao');
  const older = await h.login('kakao');
  const olderSession = await (await h.request('/api/auth/session', { headers: { Cookie: older.cookie } })).json();
  const session = await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json();
  const db = new DatabaseSync(h.config.dbPath);
  db.exec("CREATE TRIGGER simulate_storage_failure BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'storage unavailable'); END;");
  try {
    const failed = await h.request('/api/auth/account', { method: 'DELETE', headers: { Cookie: auth.cookie, Origin: ORIGIN, 'X-CSRF-Token': session.csrfToken } });
    assert.equal(failed.status, 503);
    assert.deepEqual(await failed.json(), { error: 'storage_unavailable' });
    assert.equal(db.prepare('SELECT confirmed FROM deletion_intents').get().confirmed, 1);
    assert.equal((await h.request('/api/auth/health')).status, 503);
    await assertRevoked(h, auth, session.csrfToken);
    await assertRevoked(h, older, olderSession.csrfToken);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 2);
  } finally {
    db.exec('DROP TRIGGER simulate_storage_failure');
    db.close();
  }
  h.advance(120000);
  await h.restart();
  assert.equal((await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json()).authenticated, false);
  assert.equal(h.calls.filter((path) => path === '/v1/user/unlink').length, 1);
});

test('external unlink prevents an in-flight callback from recreating a deleted account', async (t) => {
  let entered;
  let release;
  const started = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  const h = await harness(t, { beforeProfile: () => { entered(); return blocked; } });
  const flow = await h.start('kakao');
  const completion = h.callback(flow, 'kakao');
  await started;
  const webhook = await h.request('/api/auth/kakao/unlink', {
    method: 'POST', headers: { Authorization: 'KakaoAK kakao-admin-secret', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'app_id=123456&user_id=3456789012&referrer_type=UNLINK_FROM_APPS',
  });
  release();
  assert.equal(webhook.status, 200);
  assert.equal((await completion).headers.get('location'), '/account.html?error=invalid_request');
  const db = new DatabaseSync(h.config.dbPath, { readOnly: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  db.close();
});

test('a locked store durably queues unlink within three seconds and replays after restart', async (t) => {
  const h = await harness(t);
  const auth = await h.login('kakao');
  const session = await (await h.request('/api/auth/session', { headers: { Cookie: auth.cookie } })).json();
  const db = new DatabaseSync(h.config.dbPath);
  db.exec('BEGIN IMMEDIATE');
  const began = performance.now();
  const response = await h.request('/api/auth/kakao/unlink', {
    method: 'POST', headers: { Authorization: 'KakaoAK kakao-admin-secret', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'app_id=123456&user_id=3456789012&referrer_type=UNLINK_FROM_APPS',
  });
  db.exec('ROLLBACK');
  db.close();
  assert.equal(response.status, 200);
  assert.ok(performance.now() - began < 3000);
  const directory = `${h.config.dbPath}.unlink-inbox`;
  const files = await readdir(directory);
  assert.equal(files.length, 1);
  assert.deepEqual(JSON.parse(await readFile(join(directory, files[0]), 'utf8')), { userId: '3456789012' });
  await assertRevoked(h, auth, session.csrfToken);
  await h.restart();
  assert.deepEqual(await readdir(directory), []);
  const verified = new DatabaseSync(h.config.dbPath, { readOnly: true });
  assert.equal(verified.prepare('SELECT COUNT(*) AS count FROM users').get().count, 0);
  verified.close();
});

test('webhook does not acknowledge if database and durable inbox both fail', async (t) => {
  const h = await harness(t);
  const directory = `${h.config.dbPath}.unlink-inbox`;
  await mkdir(directory, { recursive: true });
  await rename(directory, `${directory}.saved`);
  await writeFile(directory, 'unavailable');
  const db = new DatabaseSync(h.config.dbPath);
  db.exec('BEGIN IMMEDIATE');
  let response;
  try {
    response = await h.request('/api/auth/kakao/unlink', {
      method: 'POST', headers: { Authorization: 'KakaoAK kakao-admin-secret', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'app_id=123456&user_id=3456789012&referrer_type=UNLINK_FROM_APPS',
    });
  } finally {
    db.exec('ROLLBACK');
    db.close();
    await rm(directory);
    await rename(`${directory}.saved`, directory);
  }
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'storage_unavailable' });
});
