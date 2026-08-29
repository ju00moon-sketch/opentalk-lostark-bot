import { SlashCommandBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits, ChannelType } from 'discord.js';
import { setNotifyChannel, removeNotifyChannel, getNotifyChannels } from '../notify-store.js';
import { EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('알림설정')
  .setDescription('모험섬 아침 알림(매일 8시)을 이 서버에 설정합니다')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('켜기')
      .setDescription('알림을 받을 채널을 지정합니다')
      .addChannelOption((option) =>
        option
          .setName('채널')
          .setDescription('알림 받을 채널 (비우면 지금 이 채널)')
          .addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((sub) => sub.setName('끄기').setDescription('이 서버의 모험섬 알림을 해제합니다'))
  .addSubcommand((sub) => sub.setName('상태').setDescription('현재 알림 설정을 확인합니다'));

export async function execute(interaction) {
  if (!interaction.guildId) {
    await interaction.reply({ content: '서버 안에서만 사용할 수 있어요.', flags: MessageFlags.Ephemeral });
    return;
  }
  const sub = interaction.options.getSubcommand();

  if (sub === '켜기') {
    const channel = interaction.options.getChannel('채널') ?? interaction.channel;
    setNotifyChannel(interaction.guildId, channel.id);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(EMBED_COLOR)
          .setDescription(`✅ 매일 아침 8시에 <#${channel.id}> 채널로 오늘의 모험 섬을 알려드릴게요!`),
      ],
    });
    return;
  }

  if (sub === '끄기') {
    const had = removeNotifyChannel(interaction.guildId);
    await interaction.reply({
      content: had ? '🔕 이 서버의 모험섬 알림을 껐어요.' : '이 서버에는 설정된 알림이 없어요.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const channelId = getNotifyChannels()[interaction.guildId];
  await interaction.reply({
    content: channelId
      ? `🔔 현재 <#${channelId}> 채널로 매일 아침 8시에 알림이 발송돼요.`
      : '이 서버에는 설정된 알림이 없어요. `/알림설정 켜기`로 켤 수 있어요.',
    flags: MessageFlags.Ephemeral,
  });
}
