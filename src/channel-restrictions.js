// 채널 제한: ALLOWED_CHANNEL_IDS에 채널을 넣어 두면 그 채널이 속한 서버는 그 채널에서만 커맨드가 동작한다.
// 목록에 자기 채널이 하나도 없는 서버는 제한 없이 모든 채널에서 쓸 수 있다.
//
// 채널 ID만 있고 서버 ID는 없으므로 로그인 후 채널을 조회해 "서버ID → 허용 채널" 짝을 맞춘다. 이 조회가
// 실패하면 삭제된 채널일 수도, 그 순간 API가 잠깐 안 됐던 것일 수도 있다 — 후자를 "제한 없음"으로 굳히면
// 그 서버가 모든 채널에 열려 버린다. 그래서 못 찾은 채널은 버리지 않고 (1) 부팅 뒤 몇 번 다시 시도하고,
// (2) 요청이 온 서버에서 다시 찾아본다. 그래도 "이 서버 것인지" 판정이 안 나면 그 서버는 판정이 날 때까지 막는다
// (열어 두는 쪽이 아니라 닫아 두는 쪽으로 실패한다). index.js가 커맨드·채팅·버튼 모두에 같은 검사를 건다.

const RETRIES = 5;
const RETRY_MS = 30_000;
// 요청 시점 확인을 기다려 주는 상한. 디스코드는 3초 안에 첫 응답을 요구하므로 그 안쪽에서 끊고 판정한다.
const CHECK_WAIT_MS = 1_500;

// "이 채널은 이 서버 것이 아니다"로 확정할 수 있는 오류. 그 외(네트워크·5xx·429)는 아직 모르는 것이다.
//   10003 Unknown Channel · 50001 Missing Access(봇이 없는 서버의 채널) · GuildChannelUnowned(discord.js: 다른 서버의 채널)
const DEFINITIVE_NOT_MINE = new Set([10003, 50001, 'GuildChannelUnowned']);
const isDefinitiveNotMine = (err) => DEFINITIVE_NOT_MINE.has(err?.code) || DEFINITIVE_NOT_MINE.has(err?.rawError?.code);

export function createChannelRestrictions(allowedChannels, { setTimer = setTimeout, log = console } = {}) {
  const allowedByGuild = new Map();     // 서버ID → 허용 채널 ID Set
  const unresolved = new Set(allowedChannels); // 최초 조회가 끝나기 전에도 미확정으로 취급한다
  const notMine = new Map();            // 서버ID → "이 서버 것이 아님"으로 확정된 채널 ID Set
  const inflight = new Map();           // 서버ID → 진행 중인 요청 시점 확인 (서버당 하나만)

  const admit = (guildId, channelId) => {
    if (!allowedByGuild.has(guildId)) allowedByGuild.set(guildId, new Set());
    allowedByGuild.get(guildId).add(channelId);
    unresolved.delete(channelId);
  };

  // 로그인 직후 한 번, 못 찾은 채널이 남으면 RETRY_MS 간격으로 RETRIES번까지.
  async function load(client, attempt = 1) {
    const targets = attempt === 1 ? allowedChannels : [...unresolved];
    for (const channelId of targets) {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel?.guildId) admit(channel.guildId, channelId);
        else unresolved.delete(channelId); // DM 등 서버 채널이 아니면 제한 대상이 아니다
      } catch (err) {
        unresolved.add(channelId);
        log.error(`허용 채널 확인 실패 (${channelId}, ${attempt}/${RETRIES}):`, err.message);
      }
    }
    const summary = [...allowedByGuild.entries()].map(([g, ids]) => `${g}:${ids.size}개`).join(' · ');
    log.log(`채널 제한: ${summary || '없음(모든 채널 허용)'}${unresolved.size ? ` · 미확인 ${unresolved.size}개(재시도 예정)` : ''}`);
    if (unresolved.size > 0 && attempt < RETRIES) {
      setTimer(() => load(client, attempt + 1), RETRY_MS)?.unref?.();
    }
  }

  const markNotMine = (guildId, channelId) => {
    if (!notMine.has(guildId)) notMine.set(guildId, new Set());
    notMine.get(guildId).add(channelId);
  };

  // 요청 시점 보완: 못 찾은 채널이 남아 있으면 요청이 온 서버에서 찾아본다.
  // 확정 부정(다른 서버의 채널)은 기억해 다시 묻지 않고, 일시 오류는 다음 요청에서 또 시도한다.
  // → 이 서버에 대해 아직 판정이 안 난 채널이 남아 있으면 true(미확정).
  async function ensureFor(guild) {
    if (!guild || unresolved.size === 0) return false;
    let undetermined = false;
    for (const channelId of [...unresolved]) {
      if (notMine.get(guild.id)?.has(channelId)) continue;
      try {
        const channel = await guild.channels.fetch(channelId);
        if (channel) admit(guild.id, channelId);
        else markNotMine(guild.id, channelId);
      } catch (err) {
        if (isDefinitiveNotMine(err)) markNotMine(guild.id, channelId);
        else undetermined = true; // 네트워크·5xx·429 — 이 서버가 제한 대상인지 아직 모른다
      }
    }
    return undetermined;
  }

  // 이 채널에서 커맨드를 써도 되는지. 제한이 걸린 서버가 아니면 항상 true.
  const isAllowed = (guildId, channelId) => {
    const allowed = allowedByGuild.get(guildId);
    return !allowed || allowed.has(channelId);
  };

  // 이 서버에 대해 아직 판정이 안 난 미확인 채널
  const pendingFor = (guildId) => [...unresolved].filter((c) => !notMine.get(guildId)?.has(c));

  // 캐시만 보고 즉시 판정. 아직 모르면 null.
  function decide(guild, channelId) {
    const guildId = guild?.id ?? null;
    if (!isAllowed(guildId, channelId)) return { allowed: false, reason: 'blocked' };
    if (!guild || allowedByGuild.has(guildId) || pendingFor(guildId).length === 0) return { allowed: true };
    return null;
  }

  // 배경 확인 — 서버당 한 번에 하나만 돌리고, 끝나면 캐시(admit/notMine)에 반영된다.
  function lookup(guild) {
    if (!inflight.has(guild.id)) {
      const task = ensureFor(guild).catch(() => true).finally(() => inflight.delete(guild.id));
      inflight.set(guild.id, task);
    }
    return inflight.get(guild.id);
  }

  // 요청 한 건의 판정. 캐시로 바로 답할 수 있으면 조회 없이 답하고(응답 지연 없음), 아직 모르는 서버만
  // 배경 확인을 띄운 뒤 CHECK_WAIT_MS까지만 기다린다 — 디스코드 3초 제한 안에 답하기 위해서다.
  // 그 안에 판정이 안 나면 닫아 두는 쪽(undetermined)으로 답하고, 확인은 뒤에서 계속돼 다음 요청부터 즉시 판정된다.
  //   { allowed: true }                          — 써도 된다
  //   { allowed: false, reason: 'blocked' }      — 제한된 서버의 다른 채널
  //   { allowed: false, reason: 'undetermined' } — 허용 채널 확인이 아직 안 끝난 서버 (잠시 후 다시)
  async function check(guild, channelId, { waitMs = CHECK_WAIT_MS } = {}) {
    const now = decide(guild, channelId);
    if (now) return now;
    const pending = lookup(guild);
    let timer;
    await Promise.race([
      pending,
      new Promise((resolve) => { timer = setTimeout(resolve, waitMs); timer.unref?.(); }),
    ]);
    clearTimeout(timer);
    return decide(guild, channelId) ?? { allowed: false, reason: 'undetermined' };
  }

  const UNDETERMINED_MESSAGE = '봇이 쓸 수 있는 채널을 아직 확인하는 중이에요. 잠시 후 다시 시도해 주세요.';

  const blockedMessage = (guildId) => {
    const [first] = allowedByGuild.get(guildId) ?? [];
    return `이 채널에서는 봇을 사용할 수 없어요. <#${first}> 채널에서 이용해 주세요!`;
  };

  return {
    load, ensureFor, isAllowed, check, blockedMessage,
    messageFor: (guildId, reason) => (reason === 'undetermined' ? UNDETERMINED_MESSAGE : blockedMessage(guildId)),
    // 테스트·로그용 상태 조회
    get unresolvedCount() { return unresolved.size; },
    get restrictedGuilds() { return [...allowedByGuild.keys()]; },
  };
}
