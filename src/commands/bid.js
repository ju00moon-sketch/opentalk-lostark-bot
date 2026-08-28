import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { gold, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('입찰')
  .setDescription('경매 아이템의 적정 입찰가를 계산합니다')
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

// 낙찰자는 입찰금 B를 내고, B는 나머지 N-1명에게 분배된다.
// 아이템 시세 M, 판매 수수료 5% 기준:
//   입찰해서 얻는 이득  = 0.95M - B
//   입찰 안 하고 받는 분배금 = B / (N-1)
// 두 값이 같아지는 B = 0.95M x (N-1)/N 이 "공평한" 추천 입찰가.
// B가 0.95M를 넘으면 거래소에서 사는 것보다 손해 (상한선).
function fairBid(price, partySize) {
  return Math.floor(price * 0.95 * (partySize - 1) / partySize);
}

export async function execute(interaction) {
  const price = interaction.options.getInteger('가격');
  const partySize = interaction.options.getInteger('인원');
  const breakeven = Math.floor(price * 0.95);

  const sizes = partySize ? [partySize] : [4, 8, 16];
  const fields = sizes.map((n) => ({
    name: `${n}인 추천 입찰가`,
    value: `**${gold(fairBid(price, n))}**`,
    inline: true,
  }));

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`입찰 계산기 — 시세 ${gold(price)}`)
    .addFields(...fields, {
      name: '손익분기 상한',
      value: `${gold(breakeven)} — 이 이상 입찰하면 거래소 구매보다 손해예요`,
    })
    .setFooter({ text: '추천가: 입찰 안 하고 분배금 받는 것과 이득이 같아지는 금액 (수수료 5% 반영)' });

  await interaction.reply({ embeds: [embed] });
}
