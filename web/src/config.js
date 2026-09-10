import { isAbsolute } from 'node:path';

function credential(value) {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.length > 4096 || /[\s\x00-\x1f\x7f]/.test(value)) {
    throw new Error('Invalid authentication configuration');
  }
  return value;
}

export function validateConfig(config, allowHttpForTests = false) {
  const origin = new URL(config.origin);
  if (origin.origin !== config.origin || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !(allowHttpForTests && origin.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)))) {
    throw new Error('A canonical HTTPS WEB_ORIGIN is required');
  }
  if (config.host !== '127.0.0.1' || !Number.isInteger(config.port) || config.port < 0 || config.port > 65535) {
    throw new Error('The authentication listener must use 127.0.0.1 and a valid port');
  }
  if (typeof config.dbPath !== 'string' || !isAbsolute(config.dbPath)) {
    throw new Error('WEB_DB_PATH must be an absolute dedicated database path');
  }
  const providers = {};
  for (const name of ['discord', 'kakao']) {
    providers[name] = Object.freeze({
      clientId: credential(config.providers?.[name]?.clientId),
      clientSecret: credential(config.providers?.[name]?.clientSecret),
      ...(name === 'kakao' ? { adminKey: credential(config.providers?.kakao?.adminKey), appId: credential(config.providers?.kakao?.appId) } : {}),
    });
  }
  if (providers.kakao.appId && !/^[1-9][0-9]{0,15}$/.test(providers.kakao.appId)) throw new Error('Invalid Kakao application configuration');
  const automatic = config.automaticApproval || {};
  const discordGuildId = credential(automatic.discordGuildId);
  const discordRoleId = credential(automatic.discordRoleId);
  const lostArkApiKey = credential(automatic.lostArkApiKey);
  for (const id of [discordGuildId, discordRoleId]) {
    if (id && (!/^[1-9][0-9]{0,19}$/.test(id) || BigInt(id) > 18446744073709551615n)) throw new Error('Invalid automatic approval configuration');
  }
  const automaticApproval = Object.freeze({ discordGuildId, discordRoleId, lostArkApiKey,
    enabled: automatic.enabled === true && Boolean(discordGuildId && discordRoleId && lostArkApiKey && providers.discord.clientId && providers.discord.clientSecret) });
  return Object.freeze({ origin: origin.origin, host: config.host, port: config.port, dbPath: config.dbPath, providers: Object.freeze(providers), automaticApproval });
}

export function loadConfig(env = process.env) {
  return validateConfig({
    origin: env.WEB_ORIGIN,
    host: env.WEB_HOST || '127.0.0.1',
    port: Number(env.WEB_PORT || 8090),
    dbPath: env.WEB_DB_PATH,
    automaticApproval: { enabled: env.GUILD_AUTO_APPROVAL_ENABLED === 'true', discordGuildId: env.GUILD_AUTO_DISCORD_GUILD_ID,
      discordRoleId: env.GUILD_AUTO_DISCORD_ROLE_ID, lostArkApiKey: env.LOSTARK_API_KEY },
    providers: {
      discord: { clientId: env.DISCORD_OAUTH_CLIENT_ID, clientSecret: env.DISCORD_OAUTH_CLIENT_SECRET },
      kakao: { clientId: env.KAKAO_OAUTH_CLIENT_ID, clientSecret: env.KAKAO_OAUTH_CLIENT_SECRET, adminKey: env.KAKAO_ADMIN_KEY, appId: env.KAKAO_APP_ID },
    },
  });
}
