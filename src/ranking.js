// /랭킹(길드 스펙)·/체급(원정대 체급) 공용 로직 — 이 서버 멤버 중 등록자 추리기, 순위 표기, 임베드 조립.
import { EmbedBuilder, ButtonStyle } from 'discord.js';
import { trunc, EMBED_COLOR } from './format.js';
import { optionButtons } from './buttons.js';
import { getAllLinks } from './user-store.js';
import { TITLE, NOTE, row, section, blocks, wrapItems } from './kakao/layout.js';

const MEDALS = ['🥇', '🥈', '🥉'];
export const rankLabel = (i) => MEDALS[i] ?? `**${i + 1}.**`;

export const toLevel = (s) => parseFloat(String(s ?? '0').replace(/,/g, ''));
export const num = (n, digits = 1) =>
  Number(n).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const signed = (n, digits = 1) => `${n >= 0 ? '+' : '-'}${num(Math.abs(n), digits)}`;

// 집계 대상 → [{ userId, character }]: 이 서버 멤버인 디스코드 등록자 + 카카오톡(kakao:…)에서 등록한 사람.
// 게이트웨이 멤버 요청은 특정 ID 조회라 GUILD_MEMBERS 인텐트가 없어도 되지만, 목록에 스노플레이크가 아닌 값이
// 하나라도 섞이면 응답이 안 와서 기본 120초를 기다리다 죽는다 — ID를 걸러 보내고 대기 시간도 짧게 잡는다.
const SNOWFLAKE = /^\d{17,20}$/;
const KAKAO_KEY = /^kakao:/;

export async function registeredMembers(guild) {
  const links = getAllLinks();
  const ids = Object.keys(links).filter((id) => SNOWFLAKE.test(id));
  const entries = [];
  if (ids.length > 0) {
    const members = await guild.members.fetch({ user: ids, time: 15_000 });
    entries.push(...[...members.keys()].map((userId) => ({ userId, character: links[userId] })));
  }
  // 카카오톡에서 /등록한 사람도 같은 판에 (사용자 요청 2026-09-04). 카톡 등록은 서버 멤버 여부를 알 수 없으니 전부 넣고,
  // 같은 캐릭터가 디스코드로도 등록돼 있으면 디스코드 쪽 하나만 남긴다(← 나 표시가 디스코드 사용자에게 붙도록).
  const seen = new Set(entries.map((e) => e.character));
  for (const [key, character] of Object.entries(links)) {
    if (!KAKAO_KEY.test(key) || seen.has(character)) continue;
    seen.add(character);
    entries.push({ userId: key, character });
  }
  return entries;
}

// 항목(한 사람 = 줄 하나, 안에 줄바꿈 포함) 단위로 max자 이하 덩어리를 만든다 → [{ text, count }].
// 글자 수로 뚝 자르면 마지막 사람이 반쯤 잘리거나 통째로 사라지는데 푸터 인원수는 그대로라 어긋난다.
function chunkItems(items, max) {
  const chunks = [];
  let text = '';
  let count = 0;
  const flush = () => { if (text) chunks.push({ text, count }); text = ''; count = 0; };
  for (const raw of items) {
    const item = raw.length > max ? trunc(raw, max) : raw;
    if (text && text.length + 1 + item.length > max) flush();
    text = text ? `${text}\n${item}` : item;
    count++;
  }
  flush();
  return chunks;
}

const EMBED_TOTAL_MAX = 6000;   // 디스코드 임베드 전체 글자 한도
const EMBED_FIELDS_MAX = 25;
const CONTINUATION_NAME = '\u200b'; // 이어지는 덩어리는 제목 없이(제로폭 공백)

// 한 쪽에 담는 인원. 25명 x 두 줄이면 임베드 한도(6,000자) 안에 넉넉히 들어간다.
export const PAGE_SIZE = 25;

// 판을 쪽 단위로 자른다 — 구획 순서를 지키며 항목만 [start, end) 범위로 남기고, 비는 구획은 뺀다.
function sliceBoard(board, page) {
  const items = board.sections.flatMap((section, si) => section.lines.map((line, i) => ({ si, line, entry: section.ranked[i] })));
  const start = (page - 1) * PAGE_SIZE;
  const kept = items.slice(start, start + PAGE_SIZE);
  const sections = board.sections
    .map((section, si) => {
      const mine = kept.filter((it) => it.si === si);
      return { ...section, lines: mine.map((it) => it.line), ranked: mine.map((it) => it.entry) };
    })
    .filter((section) => section.lines.length > 0);
  return { ...board, sections };
}

const pageCount = (board) => Math.max(1, Math.ceil(board.sections.reduce((n, s) => n + s.lines.length, 0) / PAGE_SIZE));

// 쪽 넘김 버튼 한 줄: ◀ 이전 · 현재/전체 · 다음 ▶
function pageButtons(command, page, pages) {
  return optionButtons(command, [
    { label: '◀ 이전', options: { 페이지: Math.max(1, page - 1) }, disabled: page <= 1 },
    { label: `${page}/${pages}쪽`, options: { 페이지: page }, disabled: true },
    { label: '다음 ▶', options: { 페이지: Math.min(pages, page + 1) }, disabled: page >= pages, style: ButtonStyle.Primary },
  ]);
}

// 디스코드 임베드 판. 첫 구획은 설명란에, 나머지는 필드에 — 모두 항목 단위로 나눠 담고,
// 임베드 전체 한도에 걸리면 사람 단위로 멈추고 "외 N명"을 밝힌다(조용히 잘리지 않게).
function discordBoard(board, total, { page = 1, pages = 1 } = {}) {
  const [first, ...rest] = board.sections;
  const head = first.name ? `**${first.name}**\n` : '';
  const firstChunks = chunkItems(first.lines, 4096 - head.length);
  const footer = `${total}명${pages > 1 ? ` · ${page}/${pages}쪽` : ''} · ${board.footer}`;

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(board.title)
    .setDescription(head + (firstChunks[0]?.text ?? '아직 없음'))
    .setFooter({ text: footer });

  let used = board.title.length + head.length + (firstChunks[0]?.text.length ?? 4) + footer.length;
  let shown = firstChunks[0]?.count ?? 0;
  let fieldCount = 0;

  const queue = [
    ...firstChunks.slice(1).map((c) => ({ name: CONTINUATION_NAME, ...c })),
    ...rest.flatMap((section) => chunkItems(section.lines, 1024)
      .map((c, i) => ({ name: i === 0 ? section.name : CONTINUATION_NAME, ...c }))),
  ];
  const failedField = board.failed.length > 0
    ? { name: '조회 안 됨', value: trunc(`${board.failed.map((n) => `\`${n}\``).join(' ')}\n${board.failedHint}`, 1024) }
    : null;
  const reserve = (failedField ? failedField.name.length + failedField.value.length : 0) + 80; // 조회 안 됨 + "외 N명" 자리

  for (const item of queue) {
    const size = item.name.length + item.text.length;
    if (used + size + reserve > EMBED_TOTAL_MAX || fieldCount + 1 >= EMBED_FIELDS_MAX - (failedField ? 1 : 0)) {
      const left = board.sections.reduce((n, s) => n + s.lines.length, 0) - shown;
      embed.addFields({ name: CONTINUATION_NAME, value: `… 외 ${left}명은 이 쪽에 다 담지 못했어요. 페이지 옵션이나 아래 버튼으로 넘겨 보세요.` });
      fieldCount++;
      break;
    }
    embed.addFields({ name: item.name, value: item.text });
    used += size;
    shown += item.count;
    fieldCount++;
  }
  if (failedField) embed.addFields(failedField);
  return embed;
}

// 카카오톡 평문 판. 제목이 "이름 — 기준" 꼴이면 기준을 따로 떼어 한 줄로 세운다.
function kakaoBoard(board, total, { page = 1, pages = 1 } = {}) {
  const [head, ...basis] = board.title.replace(/^\p{Extended_Pictographic}+\s*/u, '').split(' — ');
  // 순위 목록이 길면 방에 다 안 들어가고 뒤가 잘린다(전문은 전체 보기 링크로 간다).
  // 그래서 집계 수치·조회 실패·기준 설명을 목록보다 앞에 두어 주의사항이 항상 방에 남게 한다.
  return blocks(
    TITLE(head),
    section(null, [row('집계', `${total}명${pages > 1 ? ` · ${page}/${pages}쪽` : ''}`), basis.length > 0 ? row('기준', basis.join(' — ')) : null]),
    board.failed.length > 0 ? section('조회 안 됨', [...wrapItems(board.failed, 4), board.failedHint]) : null,
    NOTE(board.footer),
    board.sections.filter((s) => s.lines.length > 0).map((s) => section(s.name ?? '순위', s.lines)),
  );
}

// 공통 실행 흐름: 서버 확인 → 등록자 추리기 → build(entries)로 판 만들기 → 임베드(+버튼) 응답.
// build는 { title, footer, sections: [{ name, ranked, lines }], failed, failedHint }를 돌려준다.
//   command — 쪽 넘김 버튼이 다시 부를 커맨드 이름('랭킹'·'체급'). 없으면 버튼을 만들지 않는다.
// 쪽: 디스코드는 언제나 PAGE_SIZE명씩 나눠 보여 주고(인원이 적으면 1쪽뿐이라 예전과 같다),
//     카톡은 전체를 한 번에 주되(뒤는 전체 보기로) 쪽을 명시하면 그 쪽만 준다.
export async function runBoard(interaction, build, components = [], { command = null } = {}) {
  if (!interaction.guild) {
    await interaction.reply('랭킹은 서버 채널에서 사용해 주세요.');
    return;
  }
  await interaction.deferReply();

  const entries = await registeredMembers(interaction.guild);
  if (entries.length === 0) {
    await interaction.editReply('이 서버에 등록된 캐릭터가 아직 없어요. `/등록`으로 등록하면 랭킹에 올라가요!');
    return;
  }

  const board = await build(entries);

  // 호출한 사람 줄 표시
  for (const section of board.sections) {
    const me = section.ranked.findIndex((e) => e.userId === interaction.user?.id);
    if (me >= 0) section.lines[me] = section.lines[me].replace('\n', ' ← 나\n');
  }

  const total = board.sections.reduce((n, s) => n + s.ranked.length, 0);

  const pages = pageCount(board);
  const requested = interaction.options.getInteger?.('페이지');
  const explicit = Number.isInteger(requested) && requested >= 1;
  const page = Math.min(Math.max(explicit ? requested : 1, 1), pages);
  const nav = command && pages > 1 ? pageButtons(command, page, pages) : [];

  // 카카오톡: 집계 인원을 맨 위로 올리고 구획을 항목으로 나눈 뒤, 긴 기준 설명은 맨 아래 주의줄로 내린다.
  // 순위 줄 자체는 디스코드와 같은 문자열이라(마크다운만 벗겨진다) 수치·순위·조회 실패 목록이 그대로 남는다.
  if (interaction.platform === 'kakao') {
    const shown = explicit && pages > 1 ? sliceBoard(board, page) : board;
    await interaction.editReply({
      content: kakaoBoard(shown, total, explicit ? { page, pages } : {}),
      components: [...components, ...(explicit ? nav : [])],
    });
    return;
  }
  const shown = pages > 1 ? sliceBoard(board, page) : board;
  await interaction.editReply({ embeds: [discordBoard(shown, total, { page, pages })], components: [...components, ...nav] });
}
