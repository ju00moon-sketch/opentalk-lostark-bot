import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getEvents } from '../lostark.js';
import { trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('이벤트')
  .setDescription('진행 중인 공식 이벤트 목록');

const dateLabel = (iso) => (iso ? iso.slice(5, 10).replace('-', '.') : '?');

export async function execute(interaction) {
  await interaction.deferReply();

  const events = await getEvents();
  if (!events || events.length === 0) {
    await interaction.editReply('진행 중인 이벤트가 없어요.');
    return;
  }

  // 종료일이 가까운 순으로
  const sorted = [...events].sort((a, b) => String(a.EndDate).localeCompare(String(b.EndDate)));
  const lines = sorted.map(
    (e) => `[**${e.Title}**](${e.Link}) — ~${dateLabel(e.EndDate)}`,
  );

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🎉 진행 중인 이벤트 (${events.length}개)`)
    .setDescription(trunc(lines.join('\n'), 4096))
    .setThumbnail(sorted[0].Thumbnail ?? null)
    .setFooter({ text: '제목을 누르면 공식 안내 페이지로 이동해요' });

  await interaction.editReply({ embeds: [embed] });
}
