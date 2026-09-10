import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { createStore } from '../src/store.js';
import { createWebServer } from '../src/server.js';
import { loadConfig } from '../src/config.js';

const origin = 'https://pogeunhaeyong.duckdns.org';
const digest = s => createHash('sha256').update(s).digest('hex');
const guildId = '660684739056762891';
const roleId = '697681987850338314';
const automaticApproval = { enabled: true, discordGuildId: guildId, discordRoleId: roleId, lostArkApiKey: 'synthetic-game-key' };
async function setup(t, automatic = automaticApproval) {
  const dir = await mkdtemp(join(tmpdir(), 'guild-automatic-'));
  const path = join(dir, 'auth.sqlite');
  const store = createStore(path);
  let clock = 1790000000000;
  const accounts = {};
  for (const [i, name] of ['member', 'other', 'owner', 'kakao'].entries()) {
    const token = randomBytes(32).toString('base64url');
    store.createSession({ provider: name === 'kakao' ? 'kakao' : 'discord', providerId: String(1000 + i), displayName: '길드원', tokenHash: digest(token), expiresAt: clock + 86400000, epoch: 0 }, clock);
    accounts[name] = { ...store.getSession(digest(token), clock), providerId: String(1000 + i), token };
  }
  store.guild.bootstrapOwner(accounts.owner.id, clock);
  const calls = [];
  const challenges = new Map();
  const control = { mode: '', hook: null };
  const config = { origin, host: '127.0.0.1', port: 0, dbPath: path,
    providers: { discord: { clientId: '12345678', clientSecret: 'synthetic-client-secret' } }, automaticApproval: automatic };
  const fetchImpl = async (value, init) => {
    const url = new URL(value); calls.push(url.href);
    assert.equal(init.redirect, 'error'); assert.ok(init.signal instanceof AbortSignal);
    if (url.pathname.endsWith('/token')) {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('redirect_uri'), `${origin}/auth/discord/callback`);
      assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), challenges.get(body.get('code')));
      return Response.json({ access_token: 'ephemeral-test-token', token_type: 'Bearer', scope: control.mode === 'scope' ? 'identify' : 'identify guilds.members.read' });
    }
    if (url.pathname === '/api/v10/users/@me') return Response.json({ id: control.mode === 'identity' ? '1001' : '1000', username: '포근한바드' });
    if (url.hostname === 'discord.com') {
      assert.equal(url.pathname, `/api/v10/users/@me/guilds/${guildId}/member`);
      if (/^http-/.test(control.mode)) return Response.json({ message: 'private upstream detail' }, { status: Number(control.mode.slice(5)) });
      if (control.mode === 'oversize') return new Response('x'.repeat(65537), { headers: { 'content-type': 'application/json' } });
      if (control.mode === 'array') return Response.json([]);
      if (control.mode === 'redirect') { const response = Response.json({}); Object.defineProperty(response, 'redirected', { value: true }); return response; }
      if (control.mode === 'timeout') return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
      return Response.json({ user: control.mode === 'member-missing' ? undefined : { id: control.mode === 'member-identity' ? '1001' : '1000' }, nick: control.mode === 'nick' ? null : '포근한바드', roles: control.mode === 'role' ? [] : [roleId], pending: control.mode === 'pending' });
    }
    assert.equal(url.origin, 'https://developer-lostark.game.onstove.com');
    assert.equal(decodeURIComponent(url.pathname), '/armories/characters/포근한바드/profiles');
    assert.equal(init.headers.Authorization, 'bearer synthetic-game-key');
    if (control.hook) await control.hook();
    return Response.json({ CharacterName: control.mode === 'character' ? '다른캐릭터' : '포근한바드', ServerName: control.mode === 'server' ? '카마인' : '루페온', GuildName: control.mode === 'guild' ? '다른길드' : '포근해' });
  };
  const service = createWebServer({ config, fetchImpl, now: () => clock });
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  const base = `http://127.0.0.1:${service.server.address().port}`;
  const request = (route, user = accounts.member, body, headers = {}) => fetch(base + route, { redirect: 'manual', method: body === undefined ? 'GET' : 'POST', headers: {
    ...(user ? { Cookie: `__Host-web_session=${user.token}`, Origin: origin, 'X-CSRF-Token': createHash('sha256').update(`web-csrf:${user.token}`).digest('base64url') } : {}),
    ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  async function apply(user = accounts.member, name = '포근한바드') { const result = await request('/api/auth/guild/apply', user, { characterName: name }); assert.equal(result.status, 200); return result.json(); }
  async function start(user = accounts.member, revision = 1) {
    const response = await request('/api/auth/guild/automatic', user, { revision });
    assert.equal(response.status, 200);
    const data = await response.json(); const url = new URL(data.authorizationUrl);
    const state = url.searchParams.get('state'); challenges.set(state, url.searchParams.get('code_challenge'));
    const binding = response.headers.getSetCookie().find(c => c.startsWith('__Host-web_binding='))?.split(';')[0];
    return { state, url, cookie: `__Host-web_session=${user.token}; ${binding}`, response };
  }
  const callback = (flow, query = `state=${flow.state}&code=${flow.state}`, cookie = flow.cookie) => fetch(`${base}/auth/discord/callback?${query}`, { redirect: 'manual', headers: { Cookie: cookie } });
  t.after(async () => { await service.close(); store.close(); await rm(dir, { recursive: true, force: true }); });
  return { store, path, dir, accounts, request, apply, start, callback, calls, control, advance(ms) { clock += ms; }, now: () => clock };
}

test('automatic approval uses separate consent and keeps the original session and role', async t => {
  const h = await setup(t); const a = h.accounts.member;
  const login = await h.request('/auth/discord/start'); assert.equal(new URL(login.headers.get('location')).searchParams.get('scope'), 'identify');
  const state = await h.apply(); assert.equal(state.automaticApproval.eligible, true);
  const flow = await h.start(); assert.equal(flow.url.searchParams.get('scope'), 'identify guilds.members.read');
  const result = await h.callback(flow); assert.equal(result.headers.get('location'), '/account.html?guild_auto=approved');
  assert.equal(result.headers.getSetCookie().some(c => c.startsWith('__Host-web_session=')), false);
  const final = await (await h.request('/api/auth/guild')).json(); assert.equal(final.membership.status, 'approved'); assert.equal(final.membership.revision, 2); assert.equal(final.role, 'member'); assert.equal(final.verification, null);
  assert.equal((await h.request('/api/auth/guild/sheet')).status, 200);
  assert.equal(h.store.getSession(digest(a.token), h.now()).id, a.id);
  const count = h.calls.length; assert.notEqual((await h.callback(flow)).headers.get('location'), '/account.html?guild_auto=approved'); assert.equal(h.calls.length, count);
  assert.equal((await readFile(h.path)).includes(Buffer.from('ephemeral-test-token')), false);
});

test('disabled and Kakao accounts retain manual verification without an automatic route', async t => {
  const h = await setup(t, { enabled: false });
  const state = await h.apply(); assert.match(state.verification.code, /^\d{8}$/); assert.equal(state.automaticApproval, undefined);
  assert.equal((await h.request('/api/auth/guild/automatic', h.accounts.member, { revision: 1 })).status, 503);
  const k = await setup(t); const stateK = await k.apply(k.accounts.kakao); assert.equal(stateK.automaticApproval.reason, 'discord_required');
  assert.equal((await k.request('/api/auth/guild/automatic', k.accounts.kakao, { revision: 1 })).status, 403);
});

test('automatic starts reject missing sessions, forged CSRF, extra fields and stale revisions', async t => {
  const h = await setup(t); await h.apply();
  assert.equal((await h.request('/api/auth/guild/automatic', null, { revision: 1 })).status, 401);
  assert.equal((await h.request('/api/auth/guild/automatic', h.accounts.member, { revision: 1 }, { 'X-CSRF-Token': 'wrong' })).status, 403);
  for (const body of [{ revision: 1, userId: h.accounts.other.id }, { revision: '1' }, { revision: 0 }, []]) assert.equal((await h.request('/api/auth/guild/automatic', h.accounts.member, body)).status, 400);
  assert.equal((await h.request('/api/auth/guild/automatic', h.accounts.member, { revision: 2 })).status, 409);
  assert.equal(h.calls.length, 0);
});

test('all external identity, role, nickname and game mismatches stay pending', async t => {
  const h = await setup(t); await h.apply();
  for (const mode of ['scope', 'identity', 'member-identity', 'member-missing', 'role', 'nick', 'pending', 'character', 'server', 'guild', 'http-401', 'http-403', 'http-404', 'http-429', 'http-503', 'oversize', 'array', 'redirect']) {
    h.control.mode = mode; const result = await h.callback(await h.start());
    assert.match(result.headers.get('location'), /\/account\.html\?error=automatic_/, mode);
    assert.equal(h.store.guild.state(h.accounts.member.id, h.now()).membership.status, 'pending', mode);
    assert.equal((await h.request('/api/auth/guild/sheet')).status, 403, mode);
    assert.doesNotMatch(result.headers.get('location'), /private|token|synthetic/);
  }
});

test('cancellation, expired state and incorrect binding cannot authorize or swap sessions', async t => {
  const h = await setup(t); await h.apply();
  const flow = await h.start();
  assert.match((await h.callback(flow, `state=${flow.state}&error=access_denied`)).headers.get('location'), /automatic_cancelled/);
  assert.equal(h.calls.length, 0);
  const wrong = await h.start();
  assert.notEqual((await h.callback(wrong, undefined, `__Host-web_session=${h.accounts.other.token}; __Host-web_binding=${randomBytes(32).toString('base64url')}`)).headers.get('location'), '/account.html?guild_auto=approved');
  const expired = await h.start(); h.advance(300001);
  assert.notEqual((await h.callback(expired)).headers.get('location'), '/account.html?guild_auto=approved'); assert.equal(h.calls.length, 0);
});

test('external response races recheck logout, deletion, renewals and manual decisions', async t => {
  for (const action of ['logout', 'delete', 'blocked', 'session-expiry', 'renew', 'reject', 'approve']) {
    const h = await setup(t); const state = await h.apply(); const a = h.accounts.member;
    h.control.hook = () => {
      if (action === 'logout') h.store.deleteSession(digest(a.token));
      else if (action === 'delete') h.store.deleteLocalAccount(a.id);
      else if (action === 'blocked') h.store.beginDeletion({ id: a.id, providerId: a.providerId }, h.now());
      else if (action === 'session-expiry') h.advance(86400001);
      else if (action === 'renew') { h.advance(60000); h.store.guild.renewVerification(a.id, 1, h.now()); }
      else h.store.guild.review(h.accounts.owner.id, a.id, action === 'reject' ? 'rejected' : 'approved', 1, h.now(), { verifiedInGame: true, verificationCode: state.verification.code });
    };
    assert.notEqual((await h.callback(await h.start())).headers.get('location'), '/account.html?guild_auto=approved', action);
    assert.equal(h.store.guild.state(a.id, h.now()).membership?.status, ['delete', 'blocked'].includes(action) ? undefined : action === 'reject' ? 'rejected' : action === 'approve' ? 'approved' : 'pending');
  }
});

test('manual rejection and revocation remain blocked after reapplication and restart', async t => {
  const h = await setup(t); const a = h.accounts.member;
  await h.apply(); h.store.guild.review(h.accounts.owner.id, a.id, 'rejected', 1, h.now());
  await h.apply(); assert.equal((await h.request('/api/auth/guild/automatic', a, { revision: 3 })).status, 403);
  const state = h.store.guild.state(a.id, h.now()); h.store.guild.review(h.accounts.owner.id, a.id, 'approved', 3, h.now(), { verifiedInGame: true, verificationCode: state.verification.code });
  h.store.guild.review(h.accounts.owner.id, a.id, 'revoked', 4, h.now()); await h.apply();
  const reopened = createStore(h.path); reopened.close();
  assert.equal((await h.request('/api/auth/guild')).status, 200);
  assert.equal((await (await h.request('/api/auth/guild')).json()).automaticApproval.reason, 'manual_required');
  assert.equal((await h.request('/api/auth/guild/automatic', a, { revision: 6 })).status, 403);
});

test('automatic approval shares the unique approved-character guard with manual approval', async t => {
  const h = await setup(t); await h.apply(); const other = await h.apply(h.accounts.other);
  h.control.hook = () => h.store.guild.review(h.accounts.owner.id, h.accounts.other.id, 'approved', 1, h.now(), { verifiedInGame: true, verificationCode: other.verification.code });
  assert.match((await h.callback(await h.start())).headers.get('location'), /character_already_verified/);
  assert.equal((await h.request('/api/auth/guild/sheet')).status, 403);
});

test('migration backfills uncertain pending history and cascades proof and blocks on old-style deletion', async t => {
  const h = await setup(t); await h.apply(); h.advance(60000); h.store.guild.renewVerification(h.accounts.member.id, 1, h.now());
  const db = new DatabaseSync(h.path); db.exec('PRAGMA foreign_keys=ON; PRAGMA user_version=3;');
  const upgraded = createStore(h.path); upgraded.close();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 4);
  assert.equal((await (await h.request('/api/auth/guild')).json()).automaticApproval.reason, 'manual_required');
  db.exec('PRAGMA user_version=1;'); db.prepare('DELETE FROM users WHERE id=?').run(h.accounts.member.id);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  const restored = createStore(h.path); restored.close(); db.close();
  assert.equal((await h.request('/api/auth/guild')).status, 401);
});

test('configuration enables approval only with complete credentials and validates IDs', () => {
  const base = { WEB_ORIGIN: origin, WEB_DB_PATH: join(tmpdir(), 'unused.sqlite'), DISCORD_OAUTH_CLIENT_ID: '1234', DISCORD_OAUTH_CLIENT_SECRET: 'test-secret', GUILD_AUTO_APPROVAL_ENABLED: 'true', GUILD_AUTO_DISCORD_GUILD_ID: guildId, GUILD_AUTO_DISCORD_ROLE_ID: roleId, LOSTARK_API_KEY: 'test-key' };
  assert.equal(loadConfig(base).automaticApproval.enabled, true);
  assert.equal(loadConfig({ ...base, LOSTARK_API_KEY: '' }).automaticApproval.enabled, false);
  assert.equal(loadConfig({ ...base, GUILD_AUTO_APPROVAL_ENABLED: '' }).automaticApproval.enabled, false);
  assert.throws(() => loadConfig({ ...base, GUILD_AUTO_DISCORD_GUILD_ID: 'https://wrong.example' }));
});

test('parallel callbacks consume one proof and an external wait cannot extend its deadline', async t => {
  const h = await setup(t); await h.apply(); const flow = await h.start();
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const reached = new Promise(resolve => { entered = resolve; });
  h.control.hook = async () => { entered(); await waiting; };
  const first = h.callback(flow); await reached;
  const second = await h.callback(flow); assert.notEqual(second.headers.get('location'), '/account.html?guild_auto=approved');
  release(); assert.equal((await first).headers.get('location'), '/account.html?guild_auto=approved');
  assert.equal(h.calls.filter(url => url.includes('/profiles')).length, 1);
  const expired = await setup(t); await expired.apply(); expired.control.hook = () => expired.advance(300001);
  assert.match((await expired.callback(await expired.start())).headers.get('location'), /automatic_state_changed/);
  assert.equal((await expired.request('/api/auth/guild/sheet')).status, 403);
});

test('automatic member timeout fails closed and leaves manual confirmation available', async t => {
  const h = await setup(t); const initial = await h.apply(); h.control.mode = 'timeout';
  assert.match((await h.callback(await h.start())).headers.get('location'), /automatic_unavailable/);
  const final = await (await h.request('/api/auth/guild')).json();
  assert.equal(final.membership.status, 'pending'); assert.equal(final.verification.code, initial.verification.code);
});
