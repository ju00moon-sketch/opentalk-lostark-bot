import { SlashCommandBuilder } from 'discord.js';
import { getLopecScore } from '../lopec.js';
import { rankLabel, num, signed, runBoard } from '../ranking.js';
import { commandButtons } from '../buttons.js';

// 길드 내 스펙 랭킹: 이 서버 멤버 중 /등록한 사람들의 로펙 "달성 최고 점수"(dbScore) 내림차순.
// 로펙이 기억하는 그 캐릭터의 최고 환산 점수라 악세·보석을 다른 캐릭에 옮겨 둔 동안 현재 점수가 떨어져도
// 흔들리지 않는다. 서폿은 점수 스케일이 달라 딜러와 나눠서 보여 준다. 원정대 체급은 /체급.
export const data = new SlashCommandBuilder()
  .setName('랭킹')
  .setDescription('길드 내 스펙 랭킹 — 등록된 길드원의 로펙 달성 최고 점수 순 (딜러/서포터 구분)');

// 같은 레벨 로펙 중앙값 대비 최고 점수가 얼마나 위/아래인지
const medianDiff = (s) => (s.median ? ` · 중앙값 ${signed(s.dbScore - s.median)}` : '');

const specLine = (e, i) => {
  const s = e.score;
  const rank = s.classRank ? ` · ${s.firstClass} ${s.classRank.toLocaleString('ko-KR')}위 (상위 ${s.classPercent}%)` : '';
  return `${rankLabel(i)} **${s.name}** · ${s.firstClass} ${num(s.itemLevel)}\n`
    + `└ 최고 **${num(s.dbScore, 2)}**점${medianDiff(s)}${rank}`;
};

// 로펙 달성 최고 점수 내림차순, 딜러/서포터 따로. 로펙에 없거나 최고 점수가 아직 없는 캐릭터는 failed로 분리.
export async function specBoard(entries) {
  const scores = await Promise.all(entries.map((e) => getLopecScore(e.character)));
  const dealers = [];
  const supports = [];
  const failed = [];
  entries.forEach((e, i) => {
    const score = scores[i];
    if (!score?.dbScore) failed.push(e.character);
    else (score.supportCheck ? supports : dealers).push({ ...e, score });
  });
  const byScore = (a, b) => b.score.dbScore - a.score.dbScore;
  dealers.sort(byScore);
  supports.sort(byScore);

  return {
    title: '🏆 길드 내 스펙 랭킹',
    footer: '로펙 달성 최고 점수 순 — 로펙이 기억하는 각 캐릭터의 최고 환산 점수라 장비를 옮겨 둬도 유지 · 중앙값 = 같은 레벨 로펙 중앙값 · lopec.kr',
    sections: [
      { name: '⚔️ 딜러', ranked: dealers, lines: dealers.map(specLine) },
      { name: '🛡️ 서포터', ranked: supports, lines: supports.map(specLine) },
    ],
    failed,
    failedHint: 'lopec.kr에서 한 번 검색(갱신)하면 다음부터 집계돼요.',
  };
}

export async function execute(interaction) {
  await runBoard(interaction, specBoard, commandButtons([{ cmd: '체급', label: '원정대 체급 랭킹 보기' }]));
}
