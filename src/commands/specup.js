import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getSpecupGuide } from '../lopec-sim.js';
import { getCharacterProfile as fetchProfile } from '../lostark.js';
import { trunc, EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import { resolveCharacter, NO_CHARACTER_HINT } from '../user-store.js';
import { characterButtons } from '../buttons.js';
import { discordDescription, footerFor, kakaoTexts } from '../specup-view.js';

export const data = new SlashCommandBuilder()
  .setName('스펙업')
  .setDescription('스펙업 효율 — 로펙 스펙업 가이드 점수 + 실시간 시세로 골드당 효율 순위')
  .addStringOption((option) =>
    option.setName('닉네임').setDescription('캐릭터 닉네임 (비우면 /등록한 내 캐릭터)'),
  );

export const UNAVAILABLE =
  '로펙에서 이 캐릭터의 스펙업 가이드를 계산할 수 없어요. 로펙 미갱신·서포터(미지원)·계산 시간 초과·시세 조회 실패 중 하나예요. 잠시 후 다시 시도해 주세요';
export const NO_CANDIDATES = '지금 추천할 스펙업이 없어요 (로펙 스펙업 가이드에 후보가 없음)';
const FOLLOW_UPS = ['로펙', '팔찌', '젬효율'];

// 의존성을 주입할 수 있게 실행 함수를 만드는 공장 — 테스트와 통합 검증에서 코어·API를 대역으로 바꾼다.
export function createExecute({ getSpecupGuide, getCharacterProfile }) {
  return async function execute(interaction) {
    const name = resolveCharacter(interaction);
    if (!name) {
      await interaction.reply(NO_CHARACTER_HINT);
      return;
    }
    await interaction.deferReply();

    // 캐릭터 존재는 코어를 부르기 전에 공식 API로 판별한다 — 코어의 null은 "계산 불가"로만 해석한다(스펙 2절).
    const profile = await getCharacterProfile(name);
    if (!profile) {
      await interaction.editReply(`\`${name}\` — ${NOT_FOUND_HINT}`);
      return;
    }
    const guide = await getSpecupGuide(name);
    if (!guide) {
      await interaction.editReply(`\`${name}\` — ${UNAVAILABLE}`);
      return;
    }
    if (guide.rows.length === 0) {
      await interaction.editReply(`\`${name}\` — ${NO_CANDIDATES}`);
      return;
    }

    const components = characterButtons(profile.CharacterName, FOLLOW_UPS);
    if (interaction.platform === 'kakao') {
      // 미리보기(상위 10개)는 content로, 전체 행은 kakaoFull로 — 브리지가 전체 보기 링크에 후자를 저장한다(스펙 3절 훅)
      const { preview, full } = kakaoTexts(profile, guide);
      await interaction.editReply({ content: preview, kakaoFull: full, components });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`❙ ${profile.CharacterName}님의 스펙업 효율`)
      .setThumbnail(profile.CharacterImage ?? null)
      .setDescription(trunc(discordDescription(profile, guide), 4096))
      .setFooter({ text: footerFor(guide) });
    await interaction.editReply({ embeds: [embed], components });
  };
}

export const execute = createExecute({ getCharacterProfile: fetchProfile, getSpecupGuide });
