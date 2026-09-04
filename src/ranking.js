// /랭킹(길드 스펙)·/체급(원정대 체급) 공용 로직 — 이 서버 멤버 중 등록자 추리기, 순위 표기, 임베드 조립.
import { EmbedBuilder } from 'discord.js';
import { trunc, EMBED_COLOR } from './format.js';
import { getAllLinks } from './user-store.js';

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

// 공통 실행 흐름: 서버 확인 → 등록자 추리기 → build(entries)로 판 만들기 → 임베드(+버튼) 응답.
// build는 { title, footer, sections: [{ name, ranked, lines }], failed, failedHint }를 돌려준다.
export async function runBoard(interaction, build, components = []) {
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
  const [first, ...rest] = board.sections;
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(board.title)
    .setDescription(trunc(
      (first.name ? `**${first.name}**\n` : '') + (first.lines.join('\n') || '아직 없음'),
      4096,
    ))
    .setFooter({ text: `${total}명 · ${board.footer}` });

  for (const section of rest) {
    if (section.lines.length > 0) embed.addFields({ name: section.name, value: trunc(section.lines.join('\n'), 1024) });
  }
  if (board.failed.length > 0) {
    embed.addFields({
      name: '조회 안 됨',
      value: trunc(`${board.failed.map((n) => `\`${n}\``).join(' ')}\n${board.failedHint}`, 1024),
    });
  }

  await interaction.editReply({ embeds: [embed], components });
}
