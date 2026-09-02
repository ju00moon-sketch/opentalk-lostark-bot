import { SlashCommandBuilder } from 'discord.js';
import { getLopecExpedition } from '../lopec.js';
import { rankLabel, num, toLevel, runBoard } from '../ranking.js';
import { commandButtons } from '../buttons.js';

// 원정대 체급 랭킹: 이 서버 멤버 중 /등록한 사람들의 1720 이상 캐릭터 전부의 로펙 환산 점수 합 = 캐릭 수 × 평균.
// 로펙 점수는 딜러·서포터를 같은 척도로 매기고(전투력은 서폿이 구조적으로 낮다), 캐릭터마다 보석·장비·악세까지
// 반영된 값이라 "여러 직업을 키우고 각각 세팅까지 맞춘 사람"이 위로 간다. 개인 스펙은 /랭킹.
export const data = new SlashCommandBuilder()
  .setName('체급')
  .setDescription('길드 내 원정대 체급 랭킹 — 등록된 길드원의 1720 이상 캐릭터 로펙 점수 합 (딜러·서포터 같은 척도)');

const RAID_LEVEL = 1720; // 원정대 체급에 넣는 최소 레벨

export async function expeditionBoard(entries) {
  const results = await Promise.all(entries.map((e) => getLopecExpedition(e.character)));
  const ranked = [];
  const failed = [];
  entries.forEach((e, i) => {
    const chars = results[i];
    if (!chars) {
      failed.push(e.character);
      return;
    }
    const raid = chars.filter((c) => toLevel(c.itemLevel) >= RAID_LEVEL);
    const scores = raid.map((c) => Number(c.lopecScore) || 0);
    ranked.push({
      ...e,
      sum: scores.reduce((a, b) => a + b, 0),
      raidCount: raid.length,
      dealers: raid.filter((c) => c.role === 'dealer').length,
      supports: raid.filter((c) => c.role === 'support').length,
      unscored: scores.filter((s) => !s).length,
      levelSum: raid.reduce((a, c) => a + toLevel(c.itemLevel), 0),
      best: Math.max(0, ...raid.map((c) => toLevel(c.itemLevel))),
      total: chars.length,
    });
  });
  ranked.sort((a, b) => b.sum - a.sum || b.raidCount - a.raidCount);

  const lines = ranked.map((e, i) => {
    if (e.raidCount === 0) {
      return `${rankLabel(i)} **${e.character}**\n└ ${RAID_LEVEL}↑ 캐릭 없음 · 총 ${e.total}캐`;
    }
    const roles = ` (딜 ${e.dealers} · 폿 ${e.supports})`;
    const unscored = e.unscored ? ` · 점수 없음 ${e.unscored}캐` : '';
    return `${rankLabel(i)} **${e.character}** · 최고 ${num(e.best)}\n`
      + `└ 로펙 합 **${num(e.sum, 0)}** · ${RAID_LEVEL}↑ **${e.raidCount}캐**${roles} · 평균 ${num(e.sum / e.raidCount, 0)}`
      + ` · 템렙 합 ${num(e.levelSum, 0)}${unscored}`;
  });
  return {
    title: `🏆 길드 내 원정대 체급 랭킹 — ${RAID_LEVEL}↑ 로펙 점수 합`,
    footer: `${RAID_LEVEL} 이상 캐릭터의 로펙 환산 점수 합(캐릭 수 × 평균) — 딜러·서포터 같은 척도, 보석·장비 반영 · ${RAID_LEVEL} 미만 제외 · lopec.kr`,
    sections: [{ name: null, ranked, lines }],
    failed,
    failedHint: 'lopec.kr에서 원정대를 못 불러왔어요. 캐릭터를 한 번 검색(갱신)하면 다음부터 집계돼요.',
  };
}

export async function execute(interaction) {
  await runBoard(interaction, expeditionBoard, commandButtons([{ cmd: '랭킹', label: '길드 스펙 랭킹 보기' }]));
}
