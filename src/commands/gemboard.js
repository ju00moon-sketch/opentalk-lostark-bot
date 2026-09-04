import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { searchAuctionItems } from '../lostark.js';
import { gold, EMBED_COLOR } from '../format.js';

const GEM_CATEGORY = 210000;
const TYPES = ['겁화', '작열', '광휘'];
const LEVELS = [10, 9, 8, 7];
const CACHE_TTL = 5 * 60 * 1000; // 경매장 12회 조회라 5분 캐시로 API를 아낀다

export const data = new SlashCommandBuilder()
  .setName('보석현황')
  .setDescription('4티어 보석 레벨별 최저가 한눈에 (겁화 · 작열 · 광휘)');

let cache = null;
let cachedAt = 0;
let inFlight = null; // 진행 중인 조회 — 캐시가 빈 사이 여럿이 동시에 부르면 경매장을 12번씩 거듭 두드리게 된다

async function fetchBoard() {
  const board = {};
  for (const type of TYPES) {
    board[type] = [];
    for (const level of LEVELS) {
      const result = await searchAuctionItems(GEM_CATEGORY, `${level}레벨 ${type}의 보석`);
      const cheapest = (result?.Items ?? []).find((i) => i.AuctionInfo?.BuyPrice > 0);
      board[type].push({ level, price: cheapest?.AuctionInfo.BuyPrice ?? null });
    }
  }
  return board;
}

// 5분 캐시 + 진행 중 조회 공유. 캐시가 비었을 때 동시에 들어온 요청은 같은 조회 하나를 함께 기다린다.
// 실패하면 진행 중 표시를 지우므로 다음 요청에서 다시 시도한다.
function loadBoard() {
  if (cache && Date.now() - cachedAt <= CACHE_TTL) return Promise.resolve(cache);
  inFlight ??= fetchBoard()
    .then((board) => {
      cache = board;
      cachedAt = Date.now();
      return board;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

export async function execute(interaction) {
  await interaction.deferReply();

  const board = await loadBoard();

  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('💎 보석 시세 현황 (즉시 구매 최저가)');
  for (const type of TYPES) {
    const lines = board[type].map(
      (row) => `${row.level}레벨 — ${row.price === null ? '매물 없음' : `**${gold(row.price)}**`}`,
    );
    embed.addFields({ name: type, value: lines.join('\n'), inline: true });
  }
  const ageMin = Math.floor((Date.now() - cachedAt) / 60000);
  embed.setFooter({ text: ageMin > 0 ? `${ageMin}분 전 시세 (5분마다 갱신)` : '방금 조회한 시세' });

  await interaction.editReply({ embeds: [embed] });
}
