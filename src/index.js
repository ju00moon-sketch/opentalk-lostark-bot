import { Client, Collection, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './commands/index.js';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commandMap = new Collection();
for (const command of commands) {
  commandMap.set(command.data.name, command);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`로그인 완료: ${readyClient.user.tag} (커맨드 ${commandMap.size}개)`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[${interaction.commandName}]`, err);
    const message = `오류가 발생했어요: ${err.message}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(message);
    } else {
      await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
