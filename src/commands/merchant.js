import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { SERVERS, getMerchantBoard, getMerchantServer } from '../merchant.js';
import { trunc, EMBED_COLOR } from '../format.js';
import { TITLE, NOTE, blocks } from '../kakao/layout.js';

export const data = new SlashCommandBuilder()
  .setName('떠상')
  .setDescription('떠돌이 상인 — 전체 서버 전설 호감도·전설 카드 요약, 서버를 넣으면 대륙별 판매 품목')
  .addStringOption((option) =>
    option.setName('서버').setDescription('서버 이름 (비우면 전체 요약)')
      .addChoices(...SERVERS.map((s) => ({ name: s.name, value: s.name }))),
  );

export const FAILED = '떠돌이 상인 정보를 가져오지 못했어요. 잠시 후 다시 시도해 주세요';
export const UNKNOWN_SERVER = `서버 이름을 확인해 주세요 (${SERVERS.map((s) => s.name).join('·')})`;
export const SOURCE = '자료: 클로아(KORLARK) 제보';

// 시각은 코어가 epoch ms로 주고 여기서만 KST로 바꾼다(스펙 5절).
const KST_OFFSET = 9 * 60 * 60 * 1000;
const kst = (ms) => new Date(ms + KST_OFFSET);
const two = (n) => String(n).padStart(2, '0');
export const clock = (ms) => { const d = kst(ms); return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`; };
const spanText = (ms) => { const m = Math.max(0, Math.round(ms / 60000)); const h = Math.floor(m / 60); return h > 0 ? `${h}시간 ${m % 60}분` : `${m}분`; };
export const remainText = (endsAt, now) => spanText(endsAt - now);
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const kstDayIndex = (ms) => Math.floor((ms + KST_OFFSET) / 86_400_000);

export function nextText(next, now) {
  if (!next) return '다음 출현 시각을 알 수 없어요';
  const dayDiff = kstDayIndex(next.startsAt) - kstDayIndex(now);
  const label = dayDiff === 0 ? '오늘' : dayDiff === 1 ? '내일' : `${DAY_NAMES[kst(next.startsAt).getUTCDay()]}요일`;
  const duration = Number.isFinite(next.endsAt) ? spanText(next.endsAt - next.startsAt) : '5시간 30분';
  return `다음 출현: ${label} ${clock(next.startsAt)} (${duration} 판매)`;
}
export const noMerchantText = (next, now) => `지금은 떠돌이 상인이 없어요\n${nextText(next, now)}`;
const activeWindow = (data, now) => (data.window && data.window.startsAt <= now && now < data.window.endsAt ? data.window : null);

// 전체 요약 한 줄: "카단: 전설호감도 0개, 에스더 시엔, 태초의 주머니" — 전설 호감도는 개수, 전설 카드·기타 전설은 이름. 조회 실패 서버는 "조회 실패".
export const serverLine = (s) => (s.ok
  ? [`${s.name}: 전설호감도 ${s.legendaryRapport}개`, ...s.legendaryCards, ...(s.legendaryEtc ?? [])].join(', ')
  : `${s.name}: 조회 실패`);

const latestOf = (times) => times.filter((t) => Number.isFinite(t)).reduce((a, b) => Math.max(a, b), 0);
const noteFor = (latest, { unreported = true } = {}) =>
  [latest ? `제보 기준 ${clock(latest)}` : null, unreported ? '미제보 대륙은 빠질 수 있어요' : null, SOURCE].filter(Boolean).join(' · ');

export function boardTexts(board, now) {
  const lines = board.servers.map(serverLine);
  const deadline = `판매 마감까지 ${remainText(board.window.endsAt, now)} 남았습니다 (${clock(board.window.endsAt)}까지)`;
  const note = noteFor(latestOf(board.servers.map((s) => (s.ok ? s.latestReportAt : null))));
  return {
    title: '전체 서버 떠상 정보',
    body: [lines.join('\n'), deadline],
    note,
  };
}

// 서버 상세: 대륙 · 상인: 품목(전설은 ★). 미제보 대륙은 마지막 줄.
export function detailTexts(detail, now) {
  const itemText = (item) => `${item.grade === 4 ? '★' : ''}${item.name}`;
  const regionLines = detail.regions.map((r) => `${r.regionName} · ${r.npcName}: ${r.items.map(itemText).join(', ')}`);
  const unreported = detail.unreportedRegions.length
    ? `미제보: ${detail.unreportedRegions.map((r) => `${r.regionName}(${r.npcName})`).join(', ')}` : null;
  const note = noteFor(latestOf(detail.regions.map((r) => r.reportedAt)), { unreported: false });
  return {
    title: `${detail.name} 떠상 정보 (판매 마감까지 ${remainText(detail.window.endsAt, now)})`,
    body: [regionLines.length ? regionLines.join('\n') : '아직 제보된 대륙이 없어요', unreported].filter(Boolean),
    note,
  };
}

const boardEmbed = (texts) => new EmbedBuilder()
  .setColor(EMBED_COLOR)
  .setTitle(`🧭 ${texts.title}`)
  .setDescription(trunc(texts.body.join('\n\n'), 4096))
  .setFooter({ text: texts.note });

async function send(interaction, texts) {
  if (interaction.platform === 'kakao') {
    await interaction.editReply({ content: blocks(TITLE(texts.title), ...texts.body, NOTE(texts.note)) });
    return;
  }
  await interaction.editReply({ embeds: [boardEmbed(texts)] });
}

// 자동 알림(merchant-notify.js)이 보낼 페이로드 — /떠상 전체 판과 같은 임베드.
// 판을 못 만들거나 판매 창 밖이거나 제보된 대륙이 한 곳도 없으면 null — 빈 판을 보내고 끝내는 대신 알림 쪽 재시도가 제보를 기다린다.
// (수동 /떠상은 빈 판도 그대로 보여 준다.)
export const NOTICE_CONTENT = '🧭 떠돌이 상인이 왔어요!';
export async function buildMerchantNotice({ getMerchantBoard: loadBoard = getMerchantBoard, now = Date.now } = {}) {
  const board = await loadBoard();
  const at = now();
  if (!board || !activeWindow(board, at)) return null;
  if (!board.servers.some((s) => s.ok && s.reportedRegions > 0)) return null;
  return { content: NOTICE_CONTENT, embeds: [boardEmbed(boardTexts(board, at))] };
}

// 의존성을 주입할 수 있게 실행 함수를 만드는 공장 — 테스트에서 코어와 현재 시각을 대역으로 바꾼다.
export function createExecute({ getMerchantBoard, getMerchantServer, now = Date.now }) {
  return async function execute(interaction) {
    const serverName = interaction.options.getString('서버')?.trim() || null;
    const server = serverName ? SERVERS.find((s) => s.name === serverName) : null;
    if (serverName && !server) {
      await interaction.reply(UNKNOWN_SERVER);
      return;
    }
    await interaction.deferReply();
    const data = server ? await getMerchantServer(server.id) : await getMerchantBoard();
    // 시각은 조회가 끝난 뒤에 잰다 — 조회 중 출현 경계를 넘기면 조회 전 시각으로는 정상 창을 '없음'으로 판단한다.
    const at = now();
    if (!data) {
      await interaction.editReply(FAILED);
      return;
    }
    if (!activeWindow(data, at)) {
      await interaction.editReply(noMerchantText(data.next, at));
      return;
    }
    await send(interaction, server ? detailTexts(data, at) : boardTexts(data, at));
  };
}

export const execute = createExecute({ getMerchantBoard, getMerchantServer });
