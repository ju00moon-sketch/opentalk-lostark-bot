import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getArmory, getArmoryPart } from '../lostark.js';
import { EMBED_COLOR, NOT_FOUND_HINT, padDisplay } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { characterButtons } from '../buttons.js';
import { stripTags } from '../tooltip.js';

export const data = new SlashCommandBuilder()
  .setName('정보')
  .setDescription('캐릭터 스펙 종합 요약 (돌 · 각인 · 카드 · 특성 · 수집)')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

// 각인 축약명 (커뮤니티 통용). 없으면 원래 이름 그대로.
const ENGRAVING_ABBREV = {
  '원한': '원한', '예리한 둔기': '예둔', '기습의 대가': '기습', '돌격대장': '돌대',
  '아드레날린': '아드', '저주받은 인형': '저받', '질량 증가': '질증', '타격의 대가': '타대',
  '안정된 상태': '안상', '정기 흡수': '정흡', '슈퍼 차지': '슈차', '바리케이드': '바리',
  '정밀 단도': '정단', '속전속결': '속속', '중갑 착용': '중갑', '결투의 대가': '결대',
  '굳은 의지': '굳의', '최대 마나 증가': '최마증', '달인의 저력': '달저',
  '에테르 포식자': '에포', '폭발물 전문가': '폭전', '마나의 흐름': '마흐',
  '번개의 분노': '번분', '급소 타격': '급타', '구슬동자': '구동', '여신의 가호': '가호',
  '위기 모면': '위모', '강령술': '강령', '선수필승': '선필', '시선 집중': '시집',
  '약자 무시': '약무', '부러진 뼈': '부뼈', '분쇄의 주먹': '분주',
};

// 수집품 축약명 — 표시 순서 고정.
const COLLECTIBLE_ABBREV = [
  ['섬의 마음', '섬마'], ['미술품', '미술품'], ['거인의 심장', '거심'],
  ['오르페우스의 별', '별'], ['세계수의 잎', '잎'], ['항해 모험물', '모험물'],
  ['이그네아의 징표', '징표'], ['모코코', '모코코'], ['오르골', '오르골'],
  ['해도', '해도'], ['환영석', '환영석'],
];

const STAT_ABBREV = { 치명: '치', 특화: '특', 신속: '신', 제압: '제', 인내: '인', 숙련: '숙' };

const padLabel = (label) => padDisplay(label, 14);

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const [armory, ark, collectibles] = await Promise.all([
    getArmory(name),
    getArmoryPart(name, 'arkpassive'),
    getArmoryPart(name, 'collectibles'),
  ]);
  if (!armory?.ArmoryProfile) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }
  const profile = armory.ArmoryProfile;

  // ── 헤더: 돌 + 각인 + 카드 세트
  const engravings = armory.ArmoryEngraving?.ArkPassiveEffects ?? [];
  const stoneLevels = engravings
    .map((e) => e.AbilityStoneLevel)
    .filter((v) => v != null)
    .sort((a, b) => b - a);

  const header = [];
  if (stoneLevels.length > 0) header.push(`💠 ${stoneLevels.join(',')}돌 오우너`);
  if (engravings.length > 0) {
    header.push(
      engravings
        .map((e) => {
          const ab = ENGRAVING_ABBREV[e.Name] ?? e.Name;
          return `${ab}(${e.Level}${e.AbilityStoneLevel != null ? `,${e.AbilityStoneLevel}` : ''})`;
        })
        .join(' '),
    );
  }
  const cardSets = (armory.ArmoryCard?.Effects ?? [])
    .map((set) => set.Items?.at(-1)?.Name)
    .filter(Boolean);
  if (cardSets.length > 0) header.push(cardSets.join('\n'));

  // ── 표: 레벨 · 포인트 · 전투력 · 낙원력 등
  const stats = new Map((profile.Stats ?? []).map((s) => [s.Type, s.Value]));
  const itemLevel = Math.floor(parseFloat(String(profile.ItemAvgLevel).replace(/,/g, '')));

  const arkPoints = new Map((ark?.Points ?? []).map((p) => [p.Name, p.Value]));
  const 진깨도 = ['진화', '깨달음', '도약'].map((k) => arkPoints.get(k));

  // 낙원력은 보주 등 장비 툴팁에 기록된다 — 발견된 값 중 최댓값.
  let paradise = 0;
  for (const item of armory.ArmoryEquipment ?? []) {
    const text = stripTags(item.Tooltip ?? '');
    for (const m of text.matchAll(/낙원력\s*:\s*([\d,]+)/g)) {
      paradise = Math.max(paradise, parseInt(m[1].replace(/,/g, ''), 10));
    }
  }

  const combatStats = Object.keys(STAT_ABBREV)
    .map((t) => [t, Number(stats.get(t) ?? 0)])
    .filter(([, v]) => v >= 100)
    .sort((a, b) => b[1] - a[1])
    .map(([t, v]) => `${STAT_ABBREV[t]}:${v}`)
    .join(' ');

  const rows = [
    ['템/전/원', `${itemLevel}/${profile.CharacterLevel}/${profile.ExpeditionLevel}`],
    ['진/깨/도', 진깨도.every((v) => v != null) ? 진깨도.join('/') : null],
    ['전투력', profile.CombatPower ?? null],
    ['낙원력', paradise > 0 ? paradise.toLocaleString('ko-KR') : null],
    ['서버/길드', `${profile.ServerName ?? '-'}/${profile.GuildName ?? '-'}`],
    ['전투특성', combatStats || null],
    ['스킬포인트', `${profile.UsingSkillPoint}/${profile.TotalSkillPoint}`],
    ['공격력/체력', `${stats.get('공격력') ?? '-'} / ${stats.get('최대 생명력') ?? '-'}`],
  ];
  const table = rows
    .filter(([, v]) => v != null)
    .map(([label, v]) => `${padLabel(label)}${v}`)
    .join('\n');

  // ── 수집품 한 줄 요약
  const remaining = [...(collectibles ?? [])];
  const collectLine = COLLECTIBLE_ABBREV.map(([keyword, ab]) => {
    const idx = remaining.findIndex((c) => c.Type.includes(keyword));
    if (idx === -1) return null;
    const [c] = remaining.splice(idx, 1);
    return `${ab}:${c.Point}`;
  })
    .filter(Boolean)
    .concat(remaining.map((c) => `${c.Type}:${c.Point}`))
    .join(' ');

  const description = [
    header.join('\n'),
    `\`\`\`\n${table}\n\`\`\``,
    collectLine,
  ]
    .filter(Boolean)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`${profile.CharacterName} — ${profile.CharacterClassName}`)
    .setThumbnail(profile.CharacterImage ?? null)
    .setDescription(description);

  await interaction.editReply({
    embeds: [embed],
    components: characterButtons(profile.CharacterName, ['군장', '치적', '팔찌', '주급']),
  });
}
