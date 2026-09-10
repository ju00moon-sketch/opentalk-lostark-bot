import { exchangeToken, requestJson } from './providers.js';
import { GuildError, validCharacter } from './guild-store.js';

const normalized = value => typeof value === 'string' ? value.normalize('NFC') : '';
const characterKey = value => validCharacter(normalized(value)) ? normalized(value).toLowerCase() : '';
const deny = code => { throw new GuildError(403, code); };

export async function verifyAutomaticMembership(config, proof, code, fetchImpl) {
  try {
    const token = await exchangeToken('discord', config, code, proof.verifier, fetchImpl);
    const scopes = typeof token.scope === 'string' ? token.scope.split(/\s+/) : [];
    if (!scopes.includes('identify') || !scopes.includes('guilds.members.read')) deny('automatic_permission_denied');
    const options = { method: 'GET', headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' } };
    const identity = await requestJson(fetchImpl, 'https://discord.com/api/v10/users/@me', options);
    if (identity.id !== proof.providerId) deny('automatic_identity_mismatch');
    const member = await requestJson(fetchImpl, `https://discord.com/api/v10/users/@me/guilds/${config.automaticApproval.discordGuildId}/member`, options);
    if (member.user?.id !== proof.providerId) deny('automatic_identity_mismatch');
    if (member.pending === true || !Array.isArray(member.roles) || member.roles.length > 1000 ||
        member.roles.some(role => typeof role !== 'string' || !/^[1-9][0-9]{0,19}$/.test(role)) ||
        !member.roles.includes(config.automaticApproval.discordRoleId)) deny('automatic_role_missing');
    if (!characterKey(member.nick) || characterKey(member.nick) !== characterKey(proof.characterName)) deny('automatic_character_mismatch');
    const profile = await requestJson(fetchImpl, `https://developer-lostark.game.onstove.com/armories/characters/${encodeURIComponent(proof.characterName)}/profiles`, {
      method: 'GET', headers: { Authorization: `bearer ${config.automaticApproval.lostArkApiKey}`, Accept: 'application/json' },
    });
    if (characterKey(profile.CharacterName) !== characterKey(proof.characterName)) deny('automatic_character_mismatch');
    if (normalized(profile.ServerName) !== '루페온' || normalized(profile.GuildName) !== '포근해') deny('automatic_guild_mismatch');
  } catch (error) {
    if (error instanceof GuildError) throw error;
    throw new GuildError(error.status === 429 ? 429 : 502, error.status === 429 ? 'automatic_rate_limited'
      : [401, 403].includes(error.status) ? 'automatic_permission_denied'
      : error.status === 404 ? 'automatic_membership_missing' : 'automatic_unavailable');
  }
}
