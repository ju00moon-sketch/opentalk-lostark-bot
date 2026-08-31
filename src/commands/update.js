import {
  SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} from 'discord.js';
import { getNotices } from '../lostark.js';
import { trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('업데이트')
  .setDescription('이번 주 업데이트 내역 (수요일 정기 업데이트)');

// 정기 업데이트 글은 "8월 26일(수) 업데이트 내역 안내" 형태로 올라온다.
const UPDATE_TITLE = /업데이트 내역/;

// 공지 분류별 아이콘 — 같은 날 글이 한눈에 구분되게.
const TYPE_ICON = { 공지: '📢', 점검: '🔧', 상점: '🛒', 이벤트: '🎉' };

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const dayKey = (date) => String(date).slice(0, 10);

// "08.26 (수)"
function dateLabel(date) {
  const d = new Date(date);
  return `${String(date).slice(5, 7)}.${String(date).slice(8, 10)} (${WEEKDAYS[d.getDay()]})`;
}

function agoLabel(date) {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  if (days <= 0) return '오늘';
  if (days === 1) return '어제';
  return `${days}일 전`;
}

// 제목에서 날짜 부분을 떼어 낸다. "8월 26일(수) 업데이트 내역 안내" → "업데이트 내역 안내"
const stripDate = (title) => title.replace(/^\d+월\s*\d+일\s*\([일월화수목금토]\)\s*/, '').trim();

export async function execute(interaction) {
  await interaction.deferReply();

  const notices = await getNotices();
  if (!notices || notices.length === 0) {
    await interaction.editReply('공지사항을 가져오지 못했어요.');
    return;
  }

  const updates = notices
    .filter((n) => UPDATE_TITLE.test(n.Title))
    .sort((a, b) => new Date(b.Date) - new Date(a.Date));
  if (updates.length === 0) {
    await interaction.editReply('업데이트 내역 공지를 찾지 못했어요. `/공지`로 전체 목록을 확인해 보세요.');
    return;
  }

  const latest = updates[0];
  const fresh = Date.now() - new Date(latest.Date).getTime() < 7 * 86400000;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setAuthor({ name: fresh ? '이번 주 업데이트' : '가장 최근 업데이트' })
    .setTitle(`📋 ${latest.Title}`)
    .setURL(latest.Link)
    .setDescription(
      `\`${dateLabel(latest.Date)}\` · ${agoLabel(latest.Date)}\n`
      + `아래 **버튼**을 누르면 공식 공지가 열려요.`,
    )
    .setTimestamp(new Date(latest.Date));

  // 같은 날 함께 올라온 공지 — 점검·신규 상품·이벤트가 보통 같이 올라온다
  const sameDay = notices
    .filter((n) => dayKey(n.Date) === dayKey(latest.Date) && n.Link !== latest.Link)
    .sort((a, b) => (a.Type === '점검' ? -1 : 0) - (b.Type === '점검' ? -1 : 0));
  if (sameDay.length > 0) {
    const lines = sameDay.map(
      (n) => `${TYPE_ICON[n.Type] ?? '•'} [${stripDate(n.Title)}](${n.Link})`,
    );
    embed.addFields({ name: '\u200b', value: `**함께 올라온 공지**\n${trunc(lines.join('\n'), 1000)}` });
  }

  const previous = updates.slice(1, 4);
  if (previous.length > 0) {
    const lines = previous.map((n) => `[\`${dateLabel(n.Date)}\`](${n.Link})`).join('  ·  ');
    embed.addFields({ name: '\u200b', value: `**지난 업데이트**\n${lines}` });
  }

  embed.setFooter({ text: '로스트아크 · 매주 수요일 오전 정기 업데이트' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setLabel('업데이트 내역 열기').setEmoji('🔗').setStyle(ButtonStyle.Link).setURL(latest.Link),
    new ButtonBuilder().setLabel('공지 전체').setStyle(ButtonStyle.Link)
      .setURL('https://lostark.game.onstove.com/News/Notice/List'),
  );

  await interaction.editReply({ embeds: [embed], components: [row] });
}
