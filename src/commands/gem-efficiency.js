import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getLopecScore } from '../lopec.js';
import { getArkgridEfficiency } from '../lopec-sim.js';
import { trunc, EMBED_COLOR } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';

export const data = new SlashCommandBuilder()
  .setName('젬효율')
  .setDescription('아크 그리드 젬 효율 (로펙 기준)')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

const pct = (n) => `${Number(n).toFixed(2)}%`;

// 로펙은 서폿 젬 계산 모듈을 캐릭터 페이지에 실어 주지 않는다.
const NOT_AVAILABLE =
  '젬 효율을 계산하지 못했어요. 로펙에 없는 캐릭터거나 서폿이면 나오지 않아요.';

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const [gem, score] = await Promise.all([getArkgridEfficiency(name), getLopecScore(name)]);
  if (!gem) {
    await interaction.editReply(`\`${name}\` — ${NOT_AVAILABLE}`);
    return;
  }

  const header = [`젬 효율 **${pct(gem.efficiency)}**`];
  if (gem.optionEfficiency !== null && gem.pointEfficiency !== null) {
    header.push(`└ 옵션 ${pct(gem.optionEfficiency)} · 포인트 ${pct(gem.pointEfficiency)}`);
  }
  if (score?.gemMedian) {
    const diff = gem.efficiency - score.gemMedian;
    header.push(`└ 레벨 중앙값 ${pct(score.gemMedian)} 대비 **${diff >= 0 ? '+' : '-'}${pct(Math.abs(diff))}**`);
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`💎 ${score?.name ?? name} — 아크 그리드 젬 효율`)
    .setDescription(header.join('\n'));

  // 실효율 0%는 그 캐릭터가 안 쓰는 옵션이라는 뜻이라 뒤로 밀어 둔다.
  const effects = [...(gem.effectEfficiencies ?? [])].sort(
    (a, b) => (b.efficiency ?? 0) - (a.efficiency ?? 0),
  );
  if (effects.length > 0) {
    const lines = effects.map(
      (e) => `**${e.name}** Lv.${e.level} — 효과 ${pct(e.effect)} · 실효율 **${pct(e.efficiency)}**`,
    );
    embed.addFields({ name: '옵션별 실효율', value: trunc(lines.join('\n')) });
  }

  embed.setFooter({ text: 'lopec.kr 기준 · 실효율 0%는 이 직업이 쓰지 않는 옵션이에요' });

  await interaction.editReply({ embeds: [embed] });
}
