import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { searchAuctionItems } from '../lostark.js';
import { EMBED_COLOR } from '../format.js';

const GEM_CATEGORY = 210000;

export const data = new SlashCommandBuilder()
  .setName('보석')
  .setDescription('경매장 보석 최저가를 검색합니다')
  .addStringOption((option) =>
    option
      .setName('종류')
      .setDescription('보석 종류')
      .setRequired(true)
      .addChoices(
        { name: '겁화 (4티어 피해)', value: '겁화' },
        { name: '작열 (4티어 쿨감)', value: '작열' },
        { name: '멸화 (3티어 피해)', value: '멸화' },
        { name: '홍염 (3티어 쿨감)', value: '홍염' },
      ),
  )
  .addIntegerOption((option) =>
    option
      .setName('레벨')
      .setDescription('보석 레벨 (1~10)')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(10),
  );

export async function execute(interaction) {
  const type = interaction.options.getString('종류');
  const level = interaction.options.getInteger('레벨');
  const gemName = `${level}레벨 ${type}의 보석`;
  await interaction.deferReply();

  const result = await searchAuctionItems(GEM_CATEGORY, gemName);
  const listings = (result?.Items ?? []).filter((i) => i.AuctionInfo?.BuyPrice > 0);

  if (listings.length === 0) {
    await interaction.editReply(`\`${gemName}\` — 지금 경매장에 즉시 구매 가능한 매물이 없어요.`);
    return;
  }

  const cheapest = listings[0];
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`💎 ${gemName}`)
    .setThumbnail(cheapest.Icon ?? null)
    .addFields(
      {
        name: '최저 즉시 구매가',
        value: `**${cheapest.AuctionInfo.BuyPrice.toLocaleString('ko-KR')}G**`,
        inline: true,
      },
      { name: '검색된 매물', value: `${result.TotalCount.toLocaleString('ko-KR')}개`, inline: true },
    );

  await interaction.editReply({ embeds: [embed] });
}
