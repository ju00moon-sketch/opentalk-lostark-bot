import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmoryPart } from '../lostark.js';
import { getBraceletEfficiency } from '../lopec.js';
import { getBanglePercent } from '../lopec-sim.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { parseTooltip, parseBracelet, findStoneEngravings } from '../tooltip.js';
import { TITLE, NOTE, row, section, blocks } from '../kakao/layout.js';

export const data = new SlashCommandBuilder()
  .setName('팔찌')
  .setDescription('어빌리티 스톤과 팔찌 정보')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

// 스톤 각인은 첫 글자로 줄여 쓴다 — 돌격대장 Lv.3 · 아드레날린 Lv.2 → "돌3 아2"
const stoneSummary = (engravings) =>
  engravings
    .filter((e) => !e.negative && e.level > 0)
    .map((e) => `${e.name[0]}${e.level}`)
    .join(' ');

// 머리줄(head)과 내용(body)을 나눠 둔다 — 디스코드는 "✤ 머리줄", 카카오는 "▸ 항목" 아래에 붙인다.
function stoneParts(stone) {
  if (!stone) return { head: '어빌리티 스톤 없음', body: [] };
  const engravings = findStoneEngravings(parseTooltip(stone.Tooltip));
  const summary = stoneSummary(engravings);
  const minus = engravings.find((e) => e.negative && e.level > 0);
  return {
    head: `${stone.Grade} ${stone.Name}`,
    body: [summary || null, minus ? `(${minus.name} ${minus.level})` : null].filter(Boolean),
  };
}

function braceletParts(bracelet) {
  if (!bracelet) return { head: '팔찌 없음', body: [] };
  const { stats, effects } = parseBracelet(parseTooltip(bracelet.Tooltip));
  return {
    head: `${bracelet.Grade} 팔찌`,
    body: [...stats.map((s) => `[${s.name}] ${s.value}`), ...effects.map((e) => `• ${e}`)],
  };
}

const discordBlock = ({ head, body }) => [`✤ ${head}`, ...body].join('\n');

// 효율 수치의 출처에 따른 주의 문구 — 두 화면에서 같은 문장을 쓴다.
const efficiencyNote = (fromBadge) => (fromBadge
  ? '로펙 갱신 기준이라 현재 착용 팔찌와 다를 수 있습니다.'
  : '로펙 효율표 값이에요. 캐릭터 페이지 배지와는 계산식이 다를 수 있습니다.');

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const equipment = await getArmoryPart(name, 'equipment');
  if (!equipment || equipment.length === 0) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const stone = equipment.find((e) => e.Type === '어빌리티 스톤');
  const bracelet = equipment.find((e) => e.Type === '팔찌');
  if (!stone && !bracelet) {
    await interaction.editReply(`\`${name}\` — 장착한 어빌리티 스톤과 팔찌가 없어요.`);
    return;
  }

  // 로펙 캐릭터 페이지의 팔찌 배지 값이 정확한 수치다.
  // 그게 안 나오면(서폿·조회 실패) 효율표 값으로 물러난다.
  const banglePercent = await getBanglePercent(name);
  const efficiency = banglePercent ?? (await getBraceletEfficiency(name));

  const stoneInfo = stoneParts(stone);
  const braceletInfo = braceletParts(bracelet);
  const note = efficiency === null ? null : efficiencyNote(banglePercent !== null);

  // 카카오톡: 핵심 수치(팔찌 효율)를 맨 위로 올리고 스톤·팔찌를 항목으로 나눈 뒤, 주의 문구는 맨 아래에 그대로 둔다.
  if (interaction.platform === 'kakao') {
    await interaction.editReply({
      content: blocks(
        TITLE(`${name} · 스톤 & 팔찌`),
        efficiency === null ? null : row('팔찌 효율', `${efficiency}%`),
        section('어빌리티 스톤', [stoneInfo.head, ...stoneInfo.body]),
        section('팔찌', [braceletInfo.head, ...braceletInfo.body]),
        note ? NOTE(note) : null,
      ),
    });
    return;
  }

  const sections = [discordBlock(stoneInfo), discordBlock(braceletInfo)];
  if (efficiency !== null) {
    sections.push(
      [
        '❙ 로펙 기준 팔찌 효율',
        `  팔찌 효율: **${efficiency}%**`,
        `  ※ ${note}`,
      ].join('\n'),
    );
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${name}님의 스톤 & 팔찌 정보`)
    .setDescription(trunc(sections.join('\n\n'), 4096))
    .setThumbnail(bracelet?.Icon ?? stone?.Icon ?? null);

  await interaction.editReply({ embeds: [embed] });
}
