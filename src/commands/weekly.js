import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getSiblings } from '../lostark.js';
import { RAIDS, DATA_DATE, totalGold } from '../data/raids.js';
import { trunc, gold, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';

const GOLD_CHARACTER_LIMIT = 6; // 골드 획득 지정 캐릭터 수
const RAIDS_PER_CHARACTER = 3; // 캐릭터당 골드를 받는 레이드 수

export const data = new SlashCommandBuilder()
  .setName('주급')
  .setDescription('원정대 기준 주간 레이드 골드 수입을 추정합니다')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('원정대 내 아무 캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

const toLevel = (s) => parseFloat(String(s ?? '0').replace(/,/g, ''));

// 캐릭터 레벨로 입장 가능한 레이드 중, 같은 레이드는 골드가 가장 높은 난이도만 남기고
// 골드 상위 N개를 고른다.
function bestRaidsFor(itemLevel) {
  const eligible = RAIDS.filter((r) => itemLevel >= r.ilvl);
  const bestByName = new Map();
  for (const raid of eligible) {
    const current = bestByName.get(raid.name);
    if (!current || totalGold(raid) > totalGold(current)) bestByName.set(raid.name, raid);
  }
  return [...bestByName.values()]
    .sort((a, b) => totalGold(b) - totalGold(a))
    .slice(0, RAIDS_PER_CHARACTER);
}

// "3막: 칠흑, 폭풍의 밤" → "3막", "종막: 최후의 날" → "종막"
const shortName = (name) => name.split(':')[0].trim();
const shortDiff = { 노말: '노', 하드: '하', 싱글: '싱', 나이트메어: '나메', '1단계': '1단', '2단계': '2단', '3단계': '3단' };

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const siblings = await getSiblings(name);
  if (!siblings || siblings.length === 0) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const goldCharacters = [...siblings]
    .sort((a, b) => toLevel(b.ItemAvgLevel) - toLevel(a.ItemAvgLevel))
    .slice(0, GOLD_CHARACTER_LIMIT);

  let grandTotal = 0;
  const lines = goldCharacters.map((c) => {
    const level = toLevel(c.ItemAvgLevel);
    const raids = bestRaidsFor(level);
    const charTotal = raids.reduce((sum, r) => sum + totalGold(r), 0);
    grandTotal += charTotal;
    const raidLabels = raids.map((r) => `${shortName(r.name)}(${shortDiff[r.diff] ?? r.diff})`).join(' + ');
    return `**${c.CharacterName}** ${c.ItemAvgLevel}\n└ ${raidLabels || '입장 가능 레이드 없음'} = **${gold(charTotal)}**`;
  });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`💰 주간 골드 추정 — ${gold(grandTotal)}`)
    .setDescription(trunc(lines.join('\n'), 4096))
    .setFooter({
      text: `상위 ${GOLD_CHARACTER_LIMIT}캐릭 × 골드 상위 ${RAIDS_PER_CHARACTER}레이드 기준 추정 · 더보기 비용 미차감 · ${DATA_DATE}`,
    });

  await interaction.editReply({ embeds: [embed] });
}
