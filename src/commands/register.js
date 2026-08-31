import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { getCharacterProfile } from '../lostark.js';
import { EMBED_COLOR } from '../format.js';
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
async function findFirstProfile(candidates) {
  for (const candidate of candidates) {
    try {
      const profile = await getCharacterProfile(candidate);
      if (profile) return profile;
    } catch {
      // 닉네임에 못 쓰는 문자가 섞이면 API가 4xx를 낸다 — 다음 후보로 넘어간다
    }
  }
  return null;
}

export async function execute(interaction) {
  const userId = interaction.user?.id;
  if (!userId) {
    await interaction.reply('유저 정보를 확인할 수 없어요.');
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
  const profile = await findFirstProfile(candidates);
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
