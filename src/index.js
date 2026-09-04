import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './commands/index.js';
import { startIslandNotifier } from './notify.js';
import { startUpdateNotifier } from './update-notify.js';
import { parseEmoticonKeyword, findEmoticonFile, countEmoticons } from './emoticons.js';
import { handleTextCommand } from './text-commands.js';
import { handleButton } from './buttons.js';
import { startKakaoServer } from './kakao/server.js';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // 개발자 포털에서 Message Content Intent 활성화 필요
  ],
});

const commandMap = new Collection();
for (const command of commands) {
  commandMap.set(command.data.name, command);
}

// ALLOWED_CHANNEL_IDS에 채널을 넣어 두면 그 채널이 속한 서버는 그 채널에서만 커맨드가 동작한다.
// 목록에 자기 채널이 하나도 없는 서버는 제한 없이 모든 채널에서 쓸 수 있다 —
// 그래서 서버마다 채널 ID만 추가하면 되고, 넣지 않은 서버는 그대로 자유롭다.
const allowedChannels = (process.env.ALLOWED_CHANNEL_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

// 로그인 후 채널이 어느 서버 것인지 확인해 채운다: 서버ID → 허용 채널 ID Set
const allowedByGuild = new Map();

async function loadChannelRestrictions(client) {
  for (const channelId of allowedChannels) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.guildId) continue;
      if (!allowedByGuild.has(channel.guildId)) allowedByGuild.set(channel.guildId, new Set());
      allowedByGuild.get(channel.guildId).add(channelId);
    } catch (err) {
      // 봇이 못 보는 채널(삭제됐거나 권한 없음)은 건너뛴다 — 그 서버는 제한 없이 동작한다
      console.error(`허용 채널 확인 실패 (${channelId}):`, err.message);
    }
  }
  const summary = [...allowedByGuild.entries()].map(([g, ids]) => `${g}:${ids.size}개`).join(' · ');
  console.log(`채널 제한: ${summary || '없음(모든 채널 허용)'}`);
}

// 이 채널에서 커맨드를 써도 되는지. 제한이 걸린 서버가 아니면 항상 true.
function isChannelAllowed(guildId, channelId) {
  const allowed = allowedByGuild.get(guildId);
  return !allowed || allowed.has(channelId);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`로그인 완료: ${readyClient.user.tag} (커맨드 ${commandMap.size}개, 이모티콘 ${countEmoticons()}개)`);
  await loadChannelRestrictions(readyClient);
  startIslandNotifier(readyClient);
  startUpdateNotifier(readyClient);
  startKakaoServer(commandMap, process.env, { client: readyClient }); // KAKAO_PORT가 있을 때만 켜진다
});

// 텍스트 메시지 처리: ① 초성 커맨드 (ㅂㅂㄱ 4000 등) ② 이모티콘 ([따봉 등)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // 초성 커맨드 — 슬래시 커맨드와 같은 채널 제한 적용
  if (isChannelAllowed(message.guildId, message.channelId)
    && (await handleTextCommand(message, commandMap))) return;

  // 이모티콘은 채널 제한 없이 어디서든
  const keyword = parseEmoticonKeyword(message.content);
  if (!keyword) return;
  const file = findEmoticonFile(keyword);
  if (!file) return;

  try {
    await message.channel.send({ files: [file] });
  } catch (err) {
    console.error(`[이모티콘 ${keyword}]`, err.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  // 조회 결과에 붙은 후속 조회 버튼 (예: /정보 → [군장] 클릭)
  if (interaction.isButton()) {
    try {
      await handleButton(interaction, commandMap);
    } catch (err) {
      console.error(`[버튼 ${interaction.customId}]`, err);
      try {
        const message = `오류가 발생했어요: ${err.message}`;
        if (interaction.deferred || interaction.replied) await interaction.editReply(message);
        else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      } catch {
        // 인터랙션 만료 — 무시
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  // 채널 제한 — ALLOWED_CHANNEL_IDS에 채널을 넣어 둔 서버만 걸린다.
  if (!isChannelAllowed(interaction.guildId, interaction.channelId)) {
    const [first] = allowedByGuild.get(interaction.guildId);
    await interaction.reply({
      content: `이 채널에서는 봇을 사용할 수 없어요. <#${first}> 채널에서 이용해 주세요!`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[${interaction.commandName}]`, err);
    // 오류 안내 전송도 실패할 수 있다(만료된 인터랙션 등). 봇이 죽지 않게 조용히 넘긴다.
    try {
      const message = `오류가 발생했어요: ${err.message}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message);
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    } catch {
      // 인터랙션이 이미 만료됨 — 무시
    }
  }
});

// 'error' 이벤트를 처리하지 않으면 Node가 프로세스를 종료시킨다.
client.on(Events.Error, (err) => {
  console.error('클라이언트 오류:', err);
});

client.login(process.env.DISCORD_TOKEN);
