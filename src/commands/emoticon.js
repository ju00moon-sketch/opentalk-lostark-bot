import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { listEmoticons } from '../emoticons.js';
import { trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('이모티콘')
  .setDescription('사용 가능한 이모티콘 목록을 보여줍니다');

export async function execute(interaction) {
  const keywords = listEmoticons();
  if (keywords.length === 0) {
    await interaction.reply({ content: '등록된 이모티콘이 없어요.', flags: MessageFlags.Ephemeral });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`😄 이모티콘 목록 (${keywords.length}개)`)
    .setDescription(trunc(keywords.map((k) => `\`${k}\``).join(' '), 4096))
    .setFooter({ text: '채팅에 [키워드 형태로 입력하면 이미지가 나와요. 예: [따봉' });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
