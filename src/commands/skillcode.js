import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { createHash } from 'node:crypto';
import { getFullArmory } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { stripTags } from '../tooltip.js';

export const data = new SlashCommandBuilder()
  .setName('스킬코드')
  .setDescription('게임 호환 스킬코드 + 빌드 요약 (각인·스킬·보석·아크패시브)')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

// 공식 전투정보실의 스킬코드 발급 엔드포인트를 그대로 사용한다.
// 프로필 페이지에서 토큰(memberNo/pcId/worldNo)을 추출해 SkillRecommend에 POST하면
// 게임 [K] 스킬 창에 붙여넣을 수 있는 진짜 스킬코드가 나온다.
async function fetchGameSkillCode(name) {
  const profileUrl = `https://lostark.game.onstove.com/Profile/Character/${encodeURIComponent(name)}`;
  const pageRes = await fetch(profileUrl, { headers: { 'user-agent': 'Mozilla/5.0' } });
  const html = await pageRes.text();
  const cookies = pageRes.headers.getSetCookie?.().map((c) => c.split(';')[0]).join('; ') ?? '';
  const grab = (v) => new RegExp(`_${v} = '([^']+)'`).exec(html)?.[1];
  const memberNo = grab('memberNo');
  const pcId = grab('pcId');
  const worldNo = grab('worldNo');
  if (!memberNo || !pcId || !worldNo) return null;

  const res = await fetch('https://lostark.game.onstove.com/Profile/SkillRecommend', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
      'user-agent': 'Mozilla/5.0',
      referer: profileUrl,
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: new URLSearchParams({ memberNo, worldNo, pcId }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  return /class="code">([0-9A-F]+)</.exec(json.content ?? '')?.[1] ?? null;
}

// 보석 짧은 표기: 효과 설명으로 겁(피해)/작(재사용) 계열을 구분한다
function shortGem(gem, effectDesc) {
  const level = gem.Level;
  const isCooldown = /재사용|쿨/.test(effectDesc);
  const base = stripTags(gem.Name).includes('광휘') ? '광' : '';
  return `${level}${base}${isCooldown ? '작' : '겁'}`;
}

export async function execute(interaction) {
  const name = resolveCharacter(interaction);
  if (!name) {
    await interaction.reply(NO_CHARACTER_HINT);
    return;
  }
  await interaction.deferReply();

  const [armory, gameCode] = await Promise.all([
    getFullArmory(name),
    fetchGameSkillCode(name).catch(() => null),
  ]);
  if (!armory || !armory.ArmoryProfile) {
    await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const profile = armory.ArmoryProfile;

  // 각인
  const engravings = (armory.ArmoryEngraving?.ArkPassiveEffects ?? []).map((e) => {
    const stone = e.AbilityStoneLevel ? `+${e.AbilityStoneLevel}` : '';
    return `${e.Name}(${e.Level}${stone})`;
  });

  // 스킬 (레벨을 올렸거나 룬을 꽂은 것)
  const skills = (armory.ArmorySkills ?? []).filter((s) => s.Level > 1 || s.Rune);
  const skillLines = skills.map((s) => {
    const rune = s.Rune ? `[${s.Rune.Grade}·${s.Rune.Name}]` : '[　]';
    return `${rune} Lv.${s.Level} ${s.Name}`;
  });

  // 보석
  const gems = armory.ArmoryGem?.Gems ?? [];
  const gemBySlot = new Map(gems.map((g) => [g.Slot, g]));
  const gemEffects = armory.ArmoryGem?.Effects?.Skills ?? [];
  const gemLines = gemEffects.map((eff) => {
    const gem = gemBySlot.get(eff.GemSlot);
    const desc = (eff.Description ?? []).map(stripTags).join(', ');
    const pct = /([\d.]+)%/.exec(desc)?.[1];
    return `${gem ? shortGem(gem, desc) : '?'} | ${eff.Name}${pct ? `(${Math.round(pct)}%)` : ''}`;
  });
  const avgLevel = gems.length
    ? (gems.reduce((sum, g) => sum + g.Level, 0) / gems.length).toFixed(1)
    : '0';

  // 아크패시브
  const arkSections = [];
  for (const point of armory.ArkPassive?.Points ?? []) {
    const nodes = (armory.ArkPassive?.Effects ?? [])
      .filter((e) => e.Name === point.Name)
      .map((e) => {
        const m = /(\d+)티어\s+(.+?)\s+Lv\.(\d+)/.exec(stripTags(e.Description));
        return m ? `[${m[1]}티어] ${m[2]} Lv.${m[3]}` : stripTags(e.Description);
      });
    arkSections.push({ label: `${point.Name} ${point.Value}${point.Description ? ` · ${point.Description}` : ''}`, nodes });
  }

  // 게임 호환 코드 우선, 발급 실패 시 SHA-512 빌드 지문으로 폴백
  let code = gameCode;
  let codeNote = '📋 게임에서 [K] 스킬 창 → 스킬 코드 → 붙여넣기로 바로 적용할 수 있어요!';
  if (!code) {
    const fingerprintSource = JSON.stringify({
      engravings,
      skills: skills.map((s) => [s.Name, s.Level, s.Rune?.Name ?? null, (s.Tripods ?? []).filter((t) => t.IsSelected).map((t) => t.Name)]),
      gems: gemLines,
      ark: arkSections,
    });
    code = createHash('sha512').update(fingerprintSource).digest('hex').toUpperCase();
    codeNote = '⚠️ 공식 스킬코드 발급이 일시적으로 안 돼서, 빌드 비교용 지문 코드로 대체했어요.';
  }

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`🧬 ${profile.CharacterName} — 스킬 코드`)
    .setDescription(`직업: **${profile.CharacterClassName}**\n\`\`\`${code}\`\`\`${codeNote}`)
    .addFields(
      { name: '📜 각인', value: trunc(engravings.join(' ') || '-') },
      {
        name: `🗡️ 스킬 (${profile.UsingSkillPoint ?? '-'}/${profile.TotalSkillPoint ?? '-'})`,
        value: trunc(skillLines.join('\n') || '-'),
      },
      { name: `💎 보석 (${gems.length}개 · 평균 Lv.${avgLevel})`, value: trunc(gemLines.join('\n') || '-') },
    );
  for (const section of arkSections) {
    embed.addFields({ name: `✨ ${section.label}`, value: trunc(section.nodes.join('\n') || '-'), inline: true });
  }
  embed.setFooter({
    text: gameCode
      ? '공식 전투정보실 발급 스킬코드 — 스킬·트포·보석·각인·앜패·앜그 포함'
      : '빌드 지문 — 각인·스킬·트포·보석·앜패가 같으면 같은 코드예요',
  });

  await interaction.editReply({ embeds: [embed] });
}
