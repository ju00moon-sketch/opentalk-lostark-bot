import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getCharacterProfile, isTransientError } from '../lostark.js';
import { EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
import {
  getLinkedCharacter, linkCharacter, unlinkCharacter, discordNameCandidates,
} from '../user-store.js';

// 다른 사람 캐릭터를 등록하지 못하도록 닉네임 입력을 받지 않는다.
// 등록 대상은 언제나 본인의 디스코드 닉네임뿐이다.
export const data = new SlashCommandBuilder()
  .setName('등록')
  .setDescription('내 디스코드 닉네임으로 캐릭터를 등록합니다')
  .addBooleanOption((option) =>
    option.setName('해제').setDescription('등록을 해제합니다'),
  );

// 텍스트 커맨드에는 에페메랄이 없으므로 flags는 어댑터가 알아서 제거한다.
const EPHEMERAL = { flags: MessageFlags.Ephemeral };

// 후보를 순서대로 조회해 처음 찾아지는 캐릭터를 쓴다.
// "없는 캐릭터"(null)와 "지금 API가 안 됨"(429·5xx·통신 오류)은 다르다 — 후자에서 다음 후보로 넘어가면
// 앞 후보가 진짜 캐릭터였는데도 뒤 후보(흔한 사람 이름 등)가 등록돼 버린다. 일시 오류는 그 자리에서 멈춘다.
async function findFirstProfile(candidates) {
  for (const candidate of candidates) {
    try {
      const profile = await getCharacterProfile(candidate);
      if (profile) return profile;
    } catch (err) {
      if (isTransientError(err)) throw new RetryLaterError(err);
      // 닉네임에 못 쓰는 문자가 섞이면 API가 4xx를 낸다 — 다음 후보로 넘어간다
    }
  }
  return null;
}

class RetryLaterError extends Error {
  constructor(cause) {
    super('지금은 전투정보실 조회가 안 돼서 등록을 진행하지 않았어요. 잠시 후 다시 시도해 주세요.');
    this.name = 'RetryLaterError';
    this.cause = cause;
  }
}

// 등록 흐름 공통: 일시 오류면 기존 등록을 그대로 두고 재시도 안내만 한다.
async function lookup(interaction, candidates, reply) {
  try {
    return await findFirstProfile(candidates);
  } catch (err) {
    if (!(err instanceof RetryLaterError)) throw err;
    console.error('[등록] 일시 오류로 중단:', err.cause?.message);
    await reply(err.message);
    return undefined; // null(없음)과 구분 — 호출한 쪽은 그냥 끝낸다
  }
}

export async function execute(interaction) {
  const userId = interaction.user?.id;
  if (!userId) {
    await interaction.reply('유저 정보를 확인할 수 없어요.');
    return;
  }

  // 카카오톡은 사용자 닉네임을 주지 않으므로 캐릭터명을 직접 받는다 (1:1 채팅이라 남의 캐릭터를 넣어도 본인 기본값만 바뀜)
  if (interaction.platform === 'kakao') {
    await executeKakao(interaction, userId);
    return;
  }

  if (interaction.options.getBoolean('해제')) {
    const had = unlinkCharacter(userId);
    await interaction.reply({
      content: had ? '캐릭터 등록을 해제했어요.' : '등록된 캐릭터가 없어요.',
      ...EPHEMERAL,
    });
    return;
  }

  const candidates = discordNameCandidates(interaction);
  if (candidates.length === 0) {
    await interaction.reply({
      content: '디스코드 닉네임을 읽지 못했어요. 서버 닉네임을 캐릭터명으로 바꿔 주세요.',
      ...EPHEMERAL,
    });
    return;
  }

  await interaction.deferReply();
  const profile = await lookup(interaction, candidates, (m) => interaction.editReply(m));
  if (profile === undefined) return;
  if (!profile) {
    await interaction.editReply(
      `디스코드 닉네임 \`${candidates[0]}\`으로 캐릭터를 찾지 못했어요.\n`
        + '서버 닉네임을 캐릭터명과 같게 바꾼 뒤 다시 시도해 주세요.',
    );
    return;
  }

  // 전투정보실 표기 그대로 저장 — 대소문자/띄어쓰기가 정확해야 이후 조회가 안정적이다.
  const previous = getLinkedCharacter(userId);
  linkCharacter(userId, profile.CharacterName);

  const lines = [`${profile.ServerName} · ${profile.CharacterClassName} · ${profile.ItemAvgLevel}`];
  if (previous && previous !== profile.CharacterName) lines.push(`(이전 등록: ${previous})`);
  lines.push(
    '',
    '이제 `/정보` `/군장` `/주급` 등을 닉네임 없이 쓸 수 있어요!',
    '초성도 마찬가지 — `ㅈㅂ`만 쳐도 내 캐릭터가 나와요.',
  );

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`✅ ${profile.CharacterName} 등록 완료`)
    .setThumbnail(profile.CharacterImage ?? null)
    .setDescription(lines.join('\n'));

  await interaction.editReply({ embeds: [embed] });
}

// 카카오톡: "/등록 캐릭터명" · "/등록 해제"
async function executeKakao(interaction, userId) {
  const typed = interaction.options.getString('닉네임')?.trim();
  if (!typed) {
    await interaction.reply('사용법: /등록 캐릭터명 (해제는 /등록 해제)');
    return;
  }
  if (typed === '해제') {
    const had = unlinkCharacter(userId);
    await interaction.reply(had ? '캐릭터 등록을 해제했어요.' : '등록된 캐릭터가 없어요.');
    return;
  }

  const profile = await lookup(interaction, [typed], (m) => interaction.reply(m));
  if (profile === undefined) return;
  if (!profile) {
    await interaction.reply(`\`${typed}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const previous = getLinkedCharacter(userId);
  linkCharacter(userId, profile.CharacterName);

  const lines = [`${profile.ServerName} · ${profile.CharacterClassName} · ${profile.ItemAvgLevel}`];
  if (previous && previous !== profile.CharacterName) lines.push(`(이전 등록: ${previous})`);
  lines.push('', '이제 /정보 /군장 /주급 등을 닉네임 없이 쓸 수 있어요!');

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`✅ ${profile.CharacterName} 등록 완료`)
    .setDescription(lines.join('\n'));
  await interaction.reply({ embeds: [embed] });
}
