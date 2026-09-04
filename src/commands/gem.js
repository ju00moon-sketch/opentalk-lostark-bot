import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { searchAuctionItems } from '../lostark.js';
import { EMBED_COLOR, amount, priceDelta } from '../format.js';
import { recordAndCompare } from '../price-history.js';
import { execute as showEquippedGems } from './gemsof.js';

const GEM_CATEGORY = 210000;

// 인자 없이 부를 때 보여 주는 시세판 — 4티어 딜러 보석 두 종류를 레벨별로.
const BOARD_TYPES = ['겁화', '작열'];
const BOARD_LEVELS = [10, 9, 8, 7];
const CACHE_TTL = 5 * 60 * 1000; // 한 번에 경매장을 8번 두드리므로 /보석현황과 같이 5분 캐시

const GEM_TYPES = ['겁화', '작열', '광휘', '멸화', '홍염'];

export const data = new SlashCommandBuilder()
  .setName('보석')
  .setDescription('보석 최저가 시세판 · 종류+레벨로 단일 조회 · 닉네임으로 그 캐릭터의 장착 보석')
  .addStringOption((option) =>
    option
      .setName('종류')
      .setDescription('보석 종류 (레벨과 함께 쓰면 그 보석 최저가)')
      .addChoices(
        { name: '겁화 (4티어 피해)', value: '겁화' },
        { name: '작열 (4티어 쿨감)', value: '작열' },
        { name: '광휘 (4티어 서포터)', value: '광휘' },
        { name: '멸화 (3티어 피해)', value: '멸화' },
        { name: '홍염 (3티어 쿨감)', value: '홍염' },
      ),
  )
  .addIntegerOption((option) =>
    option.setName('레벨').setDescription('보석 레벨 (1~10)').setMinValue(1).setMaxValue(10),
  )
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('그 캐릭터가 장착한 보석을 봅니다'),
  );

let cache = null;
let cachedAt = 0;
let inFlight = null; // 진행 중인 조회 — 캐시가 빈 사이 여럿이 동시에 부르면 경매장을 8번씩 거듭 두드리게 된다

// 시세판 한 줄 분량 — 키는 "10겁"처럼 짧게 잡아 기록 파일에도 그대로 쓴다.
async function fetchBoard() {
  const rows = [];
  for (const level of BOARD_LEVELS) {
    for (const type of BOARD_TYPES) {
      const result = await searchAuctionItems(GEM_CATEGORY, `${level}레벨 ${type}의 보석`);
      const cheapest = (result?.Items ?? []).find((i) => i.AuctionInfo?.BuyPrice > 0);
      rows.push({ key: `${level}${type[0]}`, level, price: cheapest?.AuctionInfo.BuyPrice ?? null });
    }
  }
  return rows;
}

// 5분 캐시 + 진행 중 조회 공유. 캐시가 비었을 때 동시에 들어온 요청은 같은 조회 하나를 함께 기다린다.
// 실패하면 진행 중 표시를 지우므로 다음 요청에서 다시 시도한다.
function loadBoard() {
  if (cache && Date.now() - cachedAt <= CACHE_TTL) return Promise.resolve(cache);
  inFlight ??= fetchBoard()
    .then((rows) => {
      cache = rows;
      cachedAt = Date.now();
      return rows;
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

// 레벨이 바뀌는 자리마다 빈 줄을 넣어 10 → 9 → 8 → 7 묶음으로 보이게 한다.
function groupByLevel(rows, lineOf) {
  const lines = [];
  let prevLevel = null;
  for (const row of rows) {
    const line = lineOf(row);
    if (line === null) continue;
    if (prevLevel !== null && row.level !== prevLevel) lines.push('');
    lines.push(line);
    prevLevel = row.level;
  }
  return lines;
}

// 전일 대비 기준일 안내. 보석마다 기준일이 갈리면 그 사실을 밝힌다.
function baseNote(baseDates, newestBase, monthDay) {
  if (baseDates.length === 0) return '전일 시세 기록이 없어 전일 대비는 내일부터 나와요';
  if (baseDates.length === 1) return `전일 대비 기준 ${monthDay(newestBase)} 시세`;
  return `전일 대비 기준 ${monthDay(newestBase)} 시세 · 기준일이 다른 줄은 줄 끝에 날짜 표시`;
}

async function showBoard(interaction) {
  await interaction.deferReply();

  const rows = await loadBoard();

  // 경매장 API에는 전일 가격이 없어서 우리가 남긴 어제 기록과 비교한다.
  const baseline = recordAndCompare('보석', Object.fromEntries(rows.map((r) => [r.key, r.price])));

  const lines = groupByLevel(rows, (r) => `${r.key}: ${r.price === null ? '매물 없음' : amount(r.price)}`);

  // 기준 날짜는 보석마다 다를 수 있다 — 그날 매물이 없었으면(가격 null) 그 보석은 기록이 안 남는다.
  // 그래서 가장 최근 기준일을 푸터에 적고, 그보다 오래된 기록과 비교한 줄에는 그 줄에 날짜를 적는다.
  const baseDates = [...new Set(rows.map((r) => baseline[r.key]?.date).filter(Boolean))].sort();
  const newestBase = baseDates.at(-1) ?? null;
  const monthDay = (date) => date.slice(5);

  const deltaLines = groupByLevel(rows, (r) => {
    const base = baseline[r.key];
    const delta = r.price === null || !base ? null : priceDelta(r.price, base.price);
    if (delta === null) return null;
    const when = base.date === newestBase ? '' : ` · ${monthDay(base.date)} 대비`;
    return `${r.key}: ${delta}${when}`;
  });
  if (deltaLines.length > 0) lines.push('', '▼ 전일 대비 더보기', ...deltaLines);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('💎 보석 최저가')
    .setDescription(lines.join('\n'))
    .setFooter({
      text: `즉시 구매가 · 5분마다 갱신 · ${baseNote(baseDates, newestBase, monthDay)}`,
    });

  await interaction.editReply({ embeds: [embed] });
}

async function showSingleGem(interaction, type, level) {
  const gemName = `${level}레벨 ${type}의 보석`;
  await interaction.deferReply();

  const result = await searchAuctionItems(GEM_CATEGORY, gemName);
  const listings = (result?.Items ?? []).filter((i) => i.AuctionInfo?.BuyPrice > 0);

  if (listings.length === 0) {
    await interaction.editReply(`\`${gemName}\` — 지금 경매장에 즉시 구매 가능한 매물이 없어요.`);
    return;
  }

  const cheapest = listings[0];
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`💎 ${gemName}`)
    .setThumbnail(cheapest.Icon ?? null)
    .addFields(
      {
        name: '최저 즉시 구매가',
        value: `**${amount(cheapest.AuctionInfo.BuyPrice)}G**`,
        inline: true,
      },
      { name: '검색된 매물', value: `${result.TotalCount.toLocaleString('ko-KR')}개`, inline: true },
    );

  await interaction.editReply({ embeds: [embed] });
}

export async function execute(interaction) {
  const nickname = interaction.options.getString('닉네임');
  if (nickname) return showEquippedGems(interaction); // /보석 닉네임 → 그 캐릭터의 장착 보석

  const type = interaction.options.getString('종류');
  const level = interaction.options.getInteger('레벨');
  if (type && level) return showSingleGem(interaction, type, level);

  if (type || level) {
    await interaction.reply(
      `단일 보석은 종류와 레벨을 같이 적어 주세요. 예: \`/보석 종류:겁화 레벨:10\` (종류: ${GEM_TYPES.join('·')})`,
    );
    return;
  }

  return showBoard(interaction); // 인자 없이 /보석 → 시세판
}
