import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './commands/index.js';
import { startIslandNotifier } from './notify.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commandMap = new Collection();
for (const command of commands) {
  commandMap.set(command.data.name, command);
}

// ALLOWED_CHANNEL_IDS가 설정돼 있으면 그 채널에서만 커맨드를 허용한다.
const allowedChannels = (process.env.ALLOWED_CHANNEL_IDS ?? '')
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);

client.once(Events.ClientReady, (readyClient) => {
  console.log(`로그인 완료: ${readyClient.user.tag} (커맨드 ${commandMap.size}개)`);
  startIslandNotifier(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  if (allowedChannels.length > 0 && !allowedChannels.includes(interaction.channelId)) {
    await interaction.reply({
      content: `이 채널에서는 봇을 사용할 수 없어요. <#${allowedChannels[0]}> 채널에서 이용해 주세요!`,
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
