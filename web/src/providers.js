import { createHash } from 'node:crypto';

const ENDPOINTS = Object.freeze({
  discord: { authorize: 'https://discord.com/oauth2/authorize', token: 'https://discord.com/api/oauth2/token', user: 'https://discord.com/api/v10/users/@me', scope: 'identify' },
  kakao: { authorize: 'https://kauth.kakao.com/oauth/authorize', token: 'https://kauth.kakao.com/oauth/token', user: 'https://kapi.kakao.com/v2/user/me', scope: 'profile_nickname' },
});
const ALREADY_UNLINKED = Symbol('already-unlinked');

export function authorizationUrl(provider, config, state, verifier, guildApproval = false) {
  const url = new URL(ENDPOINTS[provider].authorize);
  url.search = new URLSearchParams({
    client_id: config.providers[provider].clientId,
    response_type: 'code',
    redirect_uri: `${config.origin}/auth/${provider}/callback`,
    scope: guildApproval && provider === 'discord' ? 'identify guilds.members.read' : ENDPOINTS[provider].scope,
    state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  }).toString();
  if (guildApproval && provider === 'discord') url.searchParams.set('prompt', 'consent');
  return url.href;
}

export async function requestJson(fetchImpl, url, options, allowAlreadyUnlinked = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let reader;
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
    if (!response.ok && !(allowAlreadyUnlinked && response.status === 400)) {
      const error = new Error('Provider request failed'); error.status = response.status; throw error;
    }
    if (response.redirected || !/^application\/json(?:;|$)/i.test(response.headers.get('content-type') || '') ||
        Number(response.headers.get('content-length')) > 65536 || !response.body) throw new Error('Invalid provider response');
    reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) throw new Error('Invalid provider response');
      chunks.push(Buffer.from(value));
    }
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid provider response');
    if (!response.ok) {
      if (allowAlreadyUnlinked && response.status === 400 && data.code === -101) return ALREADY_UNLINKED;
      throw new Error('Invalid provider response');
    }
    return data;
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
  }
}

export async function unlinkKakao(config, providerId, fetchImpl) {
  const result = await requestJson(fetchImpl, 'https://kapi.kakao.com/v1/user/unlink', {
    method: 'POST',
    headers: { Authorization: `KakaoAK ${config.providers.kakao.adminKey}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ target_id_type: 'user_id', target_id: providerId }).toString(),
  }, true);
  if (result === ALREADY_UNLINKED) return;
  if (!Number.isSafeInteger(result.id) || String(result.id) !== providerId) throw new Error('Invalid unlink identity');
}

export async function exchangeToken(provider, config, code, verifier, fetchImpl) {
  const credentials = config.providers[provider];
  const token = await requestJson(fetchImpl, ENDPOINTS[provider].token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', client_id: credentials.clientId, client_secret: credentials.clientSecret,
      redirect_uri: `${config.origin}/auth/${provider}/callback`, code, code_verifier: verifier,
    }).toString(),
  });
  if (typeof token.access_token !== 'string' || token.access_token.length > 4096 || !/^[\x21-\x7e]+$/.test(token.access_token) ||
      typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer') throw new Error('Invalid provider response');
  return token;
}

export async function exchangeIdentity(provider, config, code, verifier, fetchImpl) {
  const token = await exchangeToken(provider, config, code, verifier, fetchImpl);
  const profile = await requestJson(fetchImpl, ENDPOINTS[provider].user, {
    method: 'GET', headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
  });
  let providerId;
  let displayName;
  if (provider === 'discord') {
    if (typeof profile.id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(profile.id) || BigInt(profile.id) > 18446744073709551615n) throw new Error('Invalid provider identity');
    providerId = profile.id;
    displayName = profile.global_name ?? profile.username;
  } else {
    if (!Number.isSafeInteger(profile.id) || profile.id <= 0) throw new Error('Invalid provider identity');
    providerId = String(profile.id);
    displayName = profile.kakao_account?.profile?.nickname;
  }
  if (typeof displayName !== 'string' || !displayName.trim() || [...displayName].length > 100 ||
      /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(displayName)) throw new Error('Invalid provider identity');
  return { provider, providerId, displayName };
}
