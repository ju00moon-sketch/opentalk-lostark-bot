import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getPowerProfile, getPowerRoster } from '../power-roster.js';
import { EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { embedToText } from '../kakao/render.js';

const COMBAT_STATS = ['치명', '특화', '제압', '신속', '인내', '숙련'];

export const data = new SlashCommandBuilder()
  .setName('전투력')
  .setDescription('전투력과 전투 특성')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

function rosterText(roster, profile) {
  if (roster.total === null) return '원정대 부캐 전투력을 조회하지 못했어요. 잠시 후 다시 시도해 주세요.';
  if (roster.total === 0) return '원정대 부캐\n조회한 캐릭터 외에 다른 캐릭터가 없어요.';
  const lines = roster.characters.map((row) => {
    const power = row.state === 'unavailable' ? '조회 불가'
      : `전투력 ${row.combatPower === null ? '-' : row.combatPower.toLocaleString('ko-KR', { maximumFractionDigits: 20 })}`;
    const server = profile.ServerName && row.serverName && row.serverName !== '-' && row.serverName !== profile.ServerName
      ? ` (${row.serverName})` : '';
    return `${row.name} · ${row.className} · ${power}${server}`;
  });
  if (roster.failed) lines.push('', `${roster.failed}개 캐릭터는 조회 실패 또는 시간 초과로 전투력을 확인하지 못했어요.`);
  return [`원정대 부캐 전투력 (${roster.total}개)`, ...lines].join('\n');
}

export function createExecute({ getCharacterProfile = getPowerProfile, getRoster = getPowerRoster } = {}) {
  return async function execute(interaction) {
    const name = resolveCharacter(interaction);
    if (!name) {
      await interaction.reply(NO_CHARACTER_HINT);
      return;
    }
    await interaction.deferReply();

    const profile = await getCharacterProfile(name);
    if (!profile) {
      await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
      return;
    }

    const stats = new Map((profile.Stats ?? []).map((s) => [s.Type, s.Value]));
    const combatStats = COMBAT_STATS.filter((t) => stats.has(t))
      .map((t) => `${t} **${stats.get(t)}**`)
      .join(' · ');

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`⚡ ${profile.CharacterName} — 전투력 ${profile.CombatPower ?? '-'}`)
      .addFields(
        { name: '아이템 레벨', value: profile.ItemAvgLevel ?? '-', inline: true },
        { name: '공격력', value: Number(stats.get('공격력') ?? 0).toLocaleString('ko-KR'), inline: true },
        { name: '최대 생명력', value: Number(stats.get('최대 생명력') ?? 0).toLocaleString('ko-KR'), inline: true },
      );
    if (combatStats) {
      embed.addFields({ name: '전투 특성', value: combatStats });
    }

    if (interaction.platform === 'kakao') {
      let roster;
      try { roster = await getRoster(profile); } catch { roster = { total: null }; }
      await interaction.editReply({ embeds: [embed], kakaoFull: `${embedToText(embed)}\n\n${rosterText(roster, profile)}` });
      return;
    }
    await interaction.editReply({ embeds: [embed] });
  };
}

export const execute = createExecute();
