import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { RAIDS, DATA_DATE, totalGold, totalBonus } from '../data/raids.js';
import { trunc, gold, EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('클골')
  .setDescription('레이드 클리어 골드표')
  .addStringOption((option) =>
    option.setName('레이드명').setDescription('예: 벨가르딘, 3막, 세르카 (비우면 전체 요약)'),
  );

export async function execute(interaction) {
  const keyword = interaction.options.getString('레이드명');

  if (keyword) {
    const matched = RAIDS.filter((r) => r.name.includes(keyword));
    if (matched.length === 0) {
      await interaction.reply(`\`${keyword}\` — 레이드를 찾지 못했어요. \`/클골\`로 전체 목록을 확인해 보세요.`);
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`💰 ${matched[0].name} — 클리어 골드`)
      .setFooter({ text: `${DATA_DATE} 기준 · 더보기 = 관문별 추가 보상 비용` });
    for (const raid of matched) {
      const gates = raid.gates
        .map((gate, i) => `${i + 1}관문 ${gold(gate.g)} (더보기 ${gold(gate.bonus)})`)
        .join('\n');
      embed.addFields({
        name: `${raid.diff} (${raid.ilvl})`,
        value: `${gates}\n합계 **${gold(totalGold(raid))}** · 더보기 시 ${gold(totalGold(raid) - totalBonus(raid))}`,
        inline: true,
      });
    }
    await interaction.reply({ embeds: [embed] });
    return;
  }

  // 전체 요약: 레이드별로 난이도들을 한 줄에
  const byName = new Map();
  for (const raid of RAIDS) {
    if (!byName.has(raid.name)) byName.set(raid.name, []);
    byName.get(raid.name).push(raid);
  }
  const lines = [...byName.entries()].map(([name, list]) => {
    const diffs = list.map((r) => `${r.diff}(${r.ilvl}) **${gold(totalGold(r))}**`).join(' · ');
    return `**${name}**\n└ ${diffs}`;
  });

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('💰 레이드 클리어 골드표')
    .setDescription(trunc(lines.join('\n'), 4096))
    .setFooter({ text: `${DATA_DATE} 기준 · 관문별 상세는 /클골 레이드명` });

  await interaction.reply({ embeds: [embed] });
}
