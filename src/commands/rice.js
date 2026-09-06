import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { searchMarketItems } from '../lostark.js';
import { amount, priceDelta, trunc, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('쌀')
  .setDescription('쌀값 — 재련 재료 거래소 최저가 한눈에 + 전일 대비');

const CACHE_TTL = 5 * 60 * 1000; // 거래소 5회 조회라 5분 캐시로 API를 아낀다

// 이름 부분 검색으로 여러 항목을 한 번에 받아 호출을 5회로 줄인다. 에스더의 기운은 재련 하위 분류가 아니라 상위 "강화 재료"에서만 잡힌다.
const QUERIES = [
  { category: 50010, name: '운명의' },
  { category: 50010, name: '명예의 파편 주머니' },
  { category: 50010, name: '아비도스 융화' },
  { category: 50020, name: '숨결' },
  { category: 50000, name: '에스더의 기운' },
];

// 표시 순서. 문자열은 항목 하나, 객체는 소/중/대를 한 줄로 합친 묶음이다. 빈 줄로 묶음을 나눈다.
const GROUPS = [
  ['운명의 파괴석', '운명의 파괴석 결정'],
  ['운명의 수호석', '운명의 수호석 결정'],
  ['운명의 돌파석', '위대한 운명의 돌파석'],
  ['아비도스 융화 재료', '상급 아비도스 융화 재료'],
  [
    { label: '명예의 파편 주머니 소/중/대', names: ['명예의 파편 주머니(소)', '명예의 파편 주머니(중)', '명예의 파편 주머니(대)'] },
    { label: '운명의 파편 주머니 소/중/대', names: ['운명의 파편 주머니(소)', '운명의 파편 주머니(중)', '운명의 파편 주머니(대)'] },
  ],
  ['용암의 숨결', '빙하의 숨결'],
  ['에스더의 기운'],
];
const ALL_NAMES = GROUPS.flat().flatMap((entry) => (typeof entry === 'string' ? [entry] : entry.names));

let cache = null;
let cachedAt = 0;
let inFlight = null; // 진행 중인 조회 — 캐시가 빈 사이 동시에 들어온 요청은 같은 조회를 함께 기다린다

async function fetchBoard(search) {
  const board = new Map();
  for (const { category, name } of QUERIES) {
    // 한 쪽은 10개. 검색 묶음이 그보다 커지면 다음 쪽까지 읽는다.
    for (let page = 1; page <= 3; page++) {
      const result = await search(category, name, { page });
      for (const item of result?.Items ?? []) {
        if (!ALL_NAMES.includes(item.Name) || board.has(item.Name)) continue;
        board.set(item.Name, { price: item.CurrentMinPrice, yday: item.YDayAvgPrice, bundle: item.BundleCount ?? 1 });
      }
      if (page * (result?.PageSize ?? 10) >= (result?.TotalCount ?? 0)) break;
    }
  }
  return board;
}

// 항목이 하나라도 빠진 판(빈 응답·일시 오류)은 캐시하지 않는다 — 5분 동안 "매물 없음"이 굳지 않게 다음 요청에서 다시 조회한다.
function loadBoard(search) {
  if (cache && Date.now() - cachedAt <= CACHE_TTL) return Promise.resolve({ board: cache, at: cachedAt });
  inFlight ??= fetchBoard(search)
    .then((board) => {
      const at = Date.now();
      if (board.size === ALL_NAMES.length) {
        cache = board;
        cachedAt = at;
      }
      return { board, at };
    })
    .finally(() => { inFlight = null; });
  return inFlight;
}

const priceText = (row) => (row && Number.isFinite(row.price) ? amount(row.price) : '매물 없음');
const bundleNote = (row) => (row && row.bundle > 1 ? ` (${row.bundle}개)` : '');

// 본문: 묶음별 최저가 → 빈 줄 → 전일 대비. 전일 대비는 거래소가 주는 전일 평균 거래가 기준이며 비교할 수 없는 항목은 뺀다.
export function boardLines(board) {
  const lines = [];
  GROUPS.forEach((group, index) => {
    if (index > 0) lines.push('');
    for (const entry of group) {
      if (typeof entry === 'string') {
        const row = board.get(entry);
        lines.push(`${entry}${bundleNote(row)}: ${priceText(row)}`);
      } else {
        lines.push(`${entry.label}: ${entry.names.map((name) => priceText(board.get(name))).join(' / ')}`);
      }
    }
  });
  const deltas = ALL_NAMES.map((name) => {
    const row = board.get(name);
    const delta = row ? priceDelta(row.price, row.yday) : null;
    return delta === null ? null : `${name}: ${delta}`;
  }).filter(Boolean);
  if (deltas.length > 0) lines.push('', '▼ 전일 대비 더보기', ...deltas);
  return lines;
}

// 의존성을 주입할 수 있게 실행 함수를 만드는 공장 — 테스트에서 거래소 검색을 대역으로 바꾼다.
export function createExecute({ search }) {
  return async function execute(interaction) {
    await interaction.deferReply();
    const { board, at } = await loadBoard(search);
    if (board.size === 0) {
      await interaction.editReply('거래소에서 재련 재료 시세를 받지 못했어요. 잠시 후 다시 시도해 주세요');
      return;
    }
    const ageMin = Math.floor((Date.now() - at) / 60000);
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle('🌾 쌀값 정보 (재련 재료 최저가)')
      .setDescription(trunc(boardLines(board).join('\n'), 4096))
      .setFooter({ text: `거래소 최저가 · 전일 대비는 전일 평균 거래가 기준 · ${ageMin > 0 ? `${ageMin}분 전 시세` : '방금 조회한 시세'} (5분마다 갱신)` });
    await interaction.editReply({ embeds: [embed] });
  };
}

export const execute = createExecute({ search: searchMarketItems });

export const __test = { resetCache: () => { cache = null; cachedAt = 0; inFlight = null; } };
