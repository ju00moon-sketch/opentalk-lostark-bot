import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getSiblings } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';

export const data = new SlashCommandBuilder()
  .setName('원정대')
  .setDescription('같은 계정의 모든 캐릭터를 아이템 레벨 순으로 보여줍니다')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('원정대 내 아무 캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

const toLevel = (s) => parseFloat(String(s ?? '0').replace(/,/g, ''));

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

  const sorted = [...siblings].sort((a, b) => toLevel(b.ItemAvgLevel) - toLevel(a.ItemAvgLevel));

  // 서버별로 묶어서 필드 하나씩
  const byServer = new Map();
  for (const c of sorted) {
    if (!byServer.has(c.ServerName)) byServer.set(c.ServerName, []);
    byServer.get(c.ServerName).push(c);
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`원정대 캐릭터 (${sorted.length}개)`)
    .setDescription(`\`${name}\` 기준 조회`);

  for (const [server, chars] of byServer) {
    const lines = chars.map(
      (c) => `**${c.ItemAvgLevel}** ${c.CharacterClassName} · ${c.CharacterName}`,
    );
    embed.addFields({ name: `🌐 ${server} (${chars.length})`, value: trunc(lines.join('\n')) });
  }

  await interaction.editReply({ embeds: [embed] });
}
