import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getCalendar } from '../lostark.js';
import { trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('모험섬')
  .setDescription('오늘의 모험 섬과 보상을 알려줍니다');

const dateOf = (iso) => iso.slice(0, 10);
const timeOf = (iso) => iso.slice(11, 16);

// 서버가 어느 시간대에 있든 KST 기준 날짜를 쓴다 (KST = UTC+9, 서머타임 없음)
const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// 보상 이름을 중요도 순으로 정렬하기 위한 점수 (낮을수록 먼저)
function rewardScore(name) {
  if (name.includes('골드')) return 0;
  if (name.includes('카드')) return 1;
  if (name.includes('주화')) return 2;
  if (name.includes('실링')) return 3;
  return 9;
}

function rewardSummary(island) {
  const names = new Set();
  for (const group of island.RewardItems ?? []) {
    for (const item of group.Items ?? []) names.add(item.Name);
  }
  const sorted = [...names].sort((a, b) => rewardScore(a) - rewardScore(b));
  return { top: sorted.slice(0, 4), hasGold: sorted.some((n) => n.includes('골드')) };
}

// 오늘(또는 가장 가까운 다음 일정)의 모험 섬 임베드. 일정이 없으면 null.
export async function buildIslandEmbed() {
  const calendar = await getCalendar();
  const islands = (calendar ?? []).filter((c) => c.CategoryName === '모험 섬');
  if (islands.length === 0) return null;

  const today = todayKst();
  const allDates = [...new Set(islands.flatMap((i) => (i.StartTimes ?? []).map(dateOf)))].sort();
  const targetDate = allDates.includes(today) ? today : allDates.find((d) => d > today);
  if (!targetDate) return null;

  const label = targetDate === today ? '오늘' : `${targetDate} (다음 일정)`;
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`🏝️ ${label}의 모험 섬`);

  for (const island of islands) {
    const times = (island.StartTimes ?? []).filter((t) => dateOf(t) === targetDate).map(timeOf);
    if (times.length === 0) continue;
    const { top, hasGold } = rewardSummary(island);
    const title = `${island.ContentsName}${hasGold ? ' 💰' : ''}`;
    const value = `🕐 ${times.join(', ')}\n🎁 ${top.join(' · ') || '보상 정보 없음'}`;
    embed.addFields({ name: title, value: trunc(value) });
  }

  return embed;
}

export async function execute(interaction) {
  await interaction.deferReply();

  const embed = await buildIslandEmbed();
  if (!embed) {
    await interaction.editReply('모험 섬 일정을 가져오지 못했어요.');
    return;
  }

  await interaction.editReply({ embeds: [embed] });
}
