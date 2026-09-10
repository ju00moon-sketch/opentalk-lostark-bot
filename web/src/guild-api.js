import { GuildError, validCharacter, validUserId } from './guild-store.js';

export const guildRoutes = Object.freeze({
  '/api/auth/guild': 'GET',
  '/api/auth/guild/apply': 'POST',
  '/api/auth/guild/verification': 'POST',
  '/api/auth/guild/automatic': 'POST',
  '/api/auth/guild/sheet': 'GET',
  '/api/auth/guild/members': 'GET',
  '/api/auth/guild/review': 'POST',
  '/api/auth/guild/role': 'POST',
});
const sheetUrl = 'https://docs.google.com/spreadsheets/d/1xZcFNNDC3mCEHWvZe4Q648aWBBJ2JjKDjpRWwtgnVcQ/preview?gid=1363852094';
const invalid = () => { throw new GuildError(400, 'invalid_request'); };

function fields(body, names, approval = false) {
  let value;
  try { value = JSON.parse(body); } catch { invalid(); }
  if (approval && value?.status === 'approved') names = [...names, 'verificationCode', 'verifiedInGame'];
  if (!value || Array.isArray(value) || typeof value !== 'object' ||
      Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) invalid();
  return value;
}

export function handleGuild({ store, user, url, body, request, timestamp, targetAvailable }) {
  const path = url.pathname;
  if (path !== '/api/auth/guild/members' && url.search) invalid();
  if (request.method === 'POST' && request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') invalid();
  if (path === '/api/auth/guild') return store.guild.state(user.id, timestamp);
  if (path === '/api/auth/guild/sheet') {
    if (!store.guild.state(user.id).canViewSheet) throw new GuildError(403, 'forbidden');
    return { title: '길드 일정 조율 시트', url: sheetUrl, embedUrl: sheetUrl };
  }
  if (path === '/api/auth/guild/apply') {
    const { characterName } = fields(body, ['characterName']);
    if (!validCharacter(characterName)) invalid();
    return store.guild.apply(user.id, characterName, timestamp);
  }
  if (path === '/api/auth/guild/verification') {
    const { revision } = fields(body, ['revision']);
    if (!Number.isSafeInteger(revision) || revision < 1) invalid();
    return store.guild.renewVerification(user.id, revision, timestamp);
  }
  if (path === '/api/auth/guild/members') {
    const params = url.searchParams;
    if ([...params.keys()].some(key => !['status', 'cursor'].includes(key)) || params.getAll('status').length > 1 || params.getAll('cursor').length > 1) invalid();
    const status = params.get('status') || '';
    const cursor = params.get('cursor') || '';
    if ((status && !['pending', 'approved', 'rejected', 'revoked'].includes(status)) || (cursor && !validUserId(cursor))) invalid();
    const result = store.guild.members(user.id, { status, cursor });
    result.items = result.items.filter(item => targetAvailable(item.userId));
    return result;
  }
  const roleChange = path === '/api/auth/guild/role';
  const actor = store.guild.state(user.id);
  if (!actor.canViewSheet || (roleChange ? actor.role !== 'owner' : !['admin', 'owner'].includes(actor.role))) {
    throw new GuildError(403, 'forbidden');
  }
  const input = fields(body, ['userId', roleChange ? 'role' : 'status', 'revision'], !roleChange);
  if (!validUserId(input.userId) || !Number.isSafeInteger(input.revision) || input.revision < 1 ||
      (roleChange ? !['member', 'admin'].includes(input.role) : !['approved', 'rejected', 'revoked'].includes(input.status))) invalid();
  if (!roleChange && input.status === 'approved' && (input.verifiedInGame !== true || typeof input.verificationCode !== 'string' || !/^\d{8}$/.test(input.verificationCode))) invalid();
  if (!targetAvailable(input.userId)) throw new GuildError(409, 'state_changed');
  if (roleChange) store.guild.setRole(user.id, input.userId, input.role, input.revision, timestamp);
  else store.guild.review(user.id, input.userId, input.status, input.revision, timestamp, input);
  return { ok: true };
}
