import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getNotices } from '../lostark.js';
import { trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('공지')
  .setDescription('로스트아크 최신 공지사항');

export async function execute(interaction) {
  await interaction.deferReply();

  const notices = await getNotices();
  if (!notices || notices.length === 0) {
    await interaction.editReply('공지사항을 가져오지 못했어요.');
    return;
  }

  const lines = notices.slice(0, 6).map(
    (n) => `\`${n.Type}\` [**${n.Title}**](${n.Link}) — ${String(n.Date).slice(5, 10).replace('-', '.')}`,
  );

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('📢 최신 공지사항')
    .setDescription(trunc(lines.join('\n'), 4096))
    .setFooter({ text: '제목을 누르면 공식 공지로 이동해요' });

  await interaction.editReply({ embeds: [embed] });
}
