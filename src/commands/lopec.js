import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getLopecScore } from '../lopec.js';
import { getBanglePercent, getArkgridEfficiency } from '../lopec-sim.js';
import { EMBED_COLOR } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { characterButtons } from '../buttons.js';

export const data = new SlashCommandBuilder()
  .setName('로펙')
  .setDescription('로펙 환산 점수와 순위')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

const NOT_FOUND =
  '로펙에서 캐릭터를 찾지 못했어요. https://lopec.kr 에서 한 번 검색(갱신)한 뒤 다시 시도해 주세요.';

// 로펙 카드 보유 현황의 원소 순서
const CARD_ELEMENTS = ['성', '암', '화', '수', '토', '뇌'];

const cardLine = (counts) =>
  CARD_ELEMENTS.map((el, i) => `${el}${counts[i] ?? 0}`).join(' ');

const num = (n, digits = 2) =>
  Number(n).toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// 중앙값 대비 얼마나 위/아래인지
function medianLine(score, median) {
  if (!median) return null;
  const diff = score - median;
  const sign = diff >= 0 ? '+' : '-';
  return `레벨 중앙값 ${num(median)} 대비 **${sign}${num(Math.abs(diff))}**`;
}

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const score = await getLopecScore(name);
  if (!score) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND}`);
    return;
  }

  const lines = [`**${num(score.specPoint)}점**`];
  const median = medianLine(score.specPoint, score.median);
  if (median) lines.push(median);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`📊 ${score.name} — 로펙 환산 점수`)
    .setThumbnail(score.profileImage ?? null)
    .setDescription(
      [
        `${score.firstClass}${score.secondClass ? ` · ${score.secondClass}` : ''}`
          + ` · ${score.itemLevel} · ${score.server}${score.guild ? `/${score.guild}` : ''}`,
        '',
        ...lines,
      ].join('\n'),
    );

  if (score.totalRank) {
    embed.addFields({
      name: '🏆 전체 순위',
      value: `${score.totalRank.toLocaleString('ko-KR')}위 · 상위 **${score.totalPercent}%**`,
      inline: true,
    });
  }
  if (score.classRank) {
    embed.addFields({
      name: `🎯 ${score.firstClass} 순위`,
      value: `${score.classRank.toLocaleString('ko-KR')}위 · 상위 **${score.classPercent}%**`,
      inline: true,
    });
  }

  // 보유 카드 현황 — 딜러/서폿 각각 원소별 각성 합계
  const cards = score.cardData;
  if (cards?.dealer || cards?.support) {
    const rows = [];
    if (cards.dealer) rows.push(`딜러: ${cardLine(cards.dealer)}`);
    if (cards.support) rows.push(`서폿: ${cardLine(cards.support)}`);
    embed.addFields({ name: '❙ 보유카드 현황', value: rows.join('\n') });
  }

  const [bangle, gem] = await Promise.all([getBanglePercent(name), getArkgridEfficiency(name)]);

  const extras = [];
  if (score.combatPower) extras.push(`인게임 전투력 ${num(score.combatPower)}`);
  if (bangle !== null) extras.push(`팔찌 효율 ${num(bangle)}%`);
  if (gem) extras.push(`젬 효율 ${num(gem.efficiency)}%`);
  if (extras.length > 0) embed.addFields({ name: '📈 참고', value: extras.join(' · ') });

  embed.setFooter({ text: 'lopec.kr 기준 · 로펙에서 갱신한 시점의 스펙이에요' });

  await interaction.editReply({
    embeds: [embed],
    components: characterButtons(score.name, ['정보', '치적', '팔찌', '젬효율']),
  });
}
