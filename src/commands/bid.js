import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { gold, EMBED_COLOR } from '../format.js';
import { blocks } from '../kakao/layout.js';

const PARTY_SIZES = [4, 8, 16];
const MARKET_FEE_PERCENT = 5;                             // 거래소 판매 수수료
const NET_PERCENT = 100 - MARKET_FEE_PERCENT;             // 되팔았을 때 손에 남는 비율(%)
const PREEMPT_NUMER = 10;                                 // 선점 기준 = 균등 분배 기준값 ÷ 1.1 = × 10/11
const PREEMPT_DENOM = 11;

export const data = new SlashCommandBuilder()
  .setName('분배금')
  .setDescription('경매 아이템의 입찰가를 계산합니다 (선점 추천가 · 균등 분배가 · 재판매 상한)')
  .addIntegerOption((option) =>
    option
      .setName('가격')
      .setDescription('아이템의 거래소 시세 (골드)')
      .setRequired(true)
      .setMinValue(1),
  )
  .addIntegerOption((option) =>
    option
      .setName('인원')
      .setDescription('공격대 인원 (기본: 4/8/16 모두 표시)')
      .addChoices(
        { name: '4인', value: 4 },
        { name: '8인', value: 8 },
        { name: '16인', value: 16 },
      ),
  );

// 세 값 모두 중간 계산에서는 소수를 그대로 두고, 화면에 적을 때만 gold()가 버린다.
//
// 나눗셈은 반드시 마지막에 한 번만 한다. 0.95나 1.1처럼 2진수로 딱 떨어지지 않는 수로 나눠 가며
// 계산하면 오차가 쌓여, 답이 정수로 떨어지는 경우까지 어긋난다 —
// 8,800G·4인의 추천가는 정확히 5,700G인데 순서대로 계산하면 5699.999…가 나와 버림에서 1G가 깎였다.
// 분자를 정수로 모아 두고 한 번만 나누면 나눗셈이 한 번뿐이라 그 자리에서 가장 가까운 값으로 떨어진다.

// 균등 분배 기준값: 낙찰자의 재판매 이익과 나머지 인원이 받는 분배금이 같아지는 입찰가.
//   낙찰하면 0.95 x 시세 - B, 낙찰 안 하면 B / (인원-1) → 두 값이 같아지는 B = 0.95 x 시세 x (인원-1)/인원
const evenShareBid = (price, partySize) =>
  (price * NET_PERCENT * (partySize - 1)) / (100 * partySize);

// 선점 기준 추천가 — 균등 분배 기준값을 1.1로 나눠(= 10/11을 곱해) 낙찰 쪽에 여유를 둔다.
const preemptBid = (price, partySize) =>
  (price * NET_PERCENT * (partySize - 1) * PREEMPT_NUMER) / (100 * partySize * PREEMPT_DENOM);

// 재판매 원금 회수 상한 — 되팔아 원금을 회수할 수 있는 한계선(인원과 무관).
const resaleCap = (price) => (price * NET_PERCENT) / 100;

const SECTION = {
  preempt: '추천 입찰가 · 선점 기준',
  even: '균등 분배 입찰가',
  cap: '재판매 원금 회수 상한',
};

// "4인: 30,225G" 줄 묶음 — 인원을 지정하면 그 인원 한 줄만.
const bidLines = (price, sizes, calc) => sizes.map((n) => `${n}인: ${gold(calc(price, n))}`);

export async function execute(interaction) {
  const price = interaction.options.getInteger('가격');
  const partySize = interaction.options.getInteger('인원');
  const sizes = partySize ? [partySize] : PARTY_SIZES;

  const title = `분배금 계산기 — 시세 ${gold(price)}`;
  const preempt = bidLines(price, sizes, preemptBid);
  const even = bidLines(price, sizes, evenShareBid);
  const cap = gold(resaleCap(price));

  // 카카오톡: 임베드 필드 격자가 없으므로 제목·구획·주의를 기호와 빈 줄로만 나눈 평문으로 보낸다.
  // 계산은 위에서 이미 끝나 있어 두 플랫폼의 숫자는 같다.
  if (interaction.platform === 'kakao') {
    await interaction.reply({
      content: blocks(
        title,
        [`❙ ${SECTION.preempt}`, ...preempt].join('\n'),
        [`❙ ${SECTION.even}`, ...even].join('\n'),
        [`❙ ${SECTION.cap}`, cap].join('\n'),
      ),
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .addFields(
      { name: `❙ ${SECTION.preempt}`, value: preempt.join('\n') },
      { name: `❙ ${SECTION.even}`, value: even.join('\n') },
      { name: `❙ ${SECTION.cap}`, value: cap },
    );

  await interaction.reply({ embeds: [embed] });
}
