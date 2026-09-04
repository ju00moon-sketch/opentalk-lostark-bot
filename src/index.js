import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './commands/index.js';
import { startIslandNotifier } from './notify.js';
import { startUpdateNotifier } from './update-notify.js';
import { parseEmoticonKeyword, findEmoticonFile, countEmoticons } from './emoticons.js';
import { handleTextCommand } from './text-commands.js';
import { handleButton } from './buttons.js';
import { startKakaoServer } from './kakao/server.js';
import { createChannelRestrictions } from './channel-restrictions.js';

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

// 채널 제한 — ALLOWED_CHANNEL_IDS의 채널이 속한 서버는 그 채널에서만 커맨드가 동작한다 (channel-restrictions.js).
const allowedChannels = (process.env.ALLOWED_CHANNEL_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const restrictions = createChannelRestrictions(allowedChannels);

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`로그인 완료: ${readyClient.user.tag} (커맨드 ${commandMap.size}개, 이모티콘 ${countEmoticons()}개)`);
  await restrictions.load(readyClient);
  startIslandNotifier(readyClient);
  startUpdateNotifier(readyClient);
  startKakaoServer(commandMap, process.env, { client: readyClient }); // KAKAO_PORT가 있을 때만 켜진다
});

// 텍스트 메시지 처리: ① 초성 커맨드 (ㅂㅂㄱ 4000 등) ② 이모티콘 ([따봉 등)
client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // 초성 커맨드 — 슬래시 커맨드와 같은 채널 제한 적용 (막힌 채널·미확정 서버에서는 조용히 넘어간다)
  const verdict = await restrictions.check(message.guild, message.channelId);
  if (verdict.allowed && (await handleTextCommand(message, commandMap))) return;

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
  // 채널 제한 — 커맨드와 버튼에 같은 판정. 제한 대상인지 아직 확인이 안 끝난 서버는 열어 두지 않고 안내만 한다.
  const verdict = await restrictions.check(interaction.guild, interaction.channelId);

  // 조회 결과에 붙은 후속 조회 버튼 (예: /정보 → [군장] 클릭) — 커맨드와 같은 채널 제한을 먼저 본다.
  // 제한을 걸기 전에 남은 메시지의 버튼으로 계속 조회되는 구멍을 막는다.
  if (interaction.isButton()) {
    if (!verdict.allowed) {
      await interaction.reply({ content: restrictions.messageFor(interaction.guildId, verdict.reason), flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }
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

  if (!verdict.allowed) {
    await interaction.reply({ content: restrictions.messageFor(interaction.guildId, verdict.reason), flags: MessageFlags.Ephemeral });
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
