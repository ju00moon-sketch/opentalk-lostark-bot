import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import { EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('도움말')
  .setDescription('사용 가능한 커맨드를 안내합니다');

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('📖 포근해챗봇 명령어')
    .setDescription('로스트아크 공식 API 기반 정보 조회 봇이에요.')
    .addFields(
      {
        name: '🔍 캐릭터 조회',
        value: [
          '`/캐릭터 닉네임` — 서버 · 직업 · 아이템 레벨 등 기본 정보',
          '`/군장 닉네임` — 장비 · 각인 · 보석 · 카드 한눈에',
          '`/원정대 닉네임` — 계정의 모든 캐릭터를 레벨 순으로',
        ].join('\n'),
      },
      {
        name: '💰 시세 · 계산',
        value: [
          '`/시세 아이템명` — 거래소 가격 (예: `/시세 운명의 파괴석`)',
          '`/보석 종류 레벨` — 보석 최저가 (예: `/보석 겁화 10`)',
          '`/입찰 가격 [인원]` — 경매 적정 입찰가 (예: `/입찰 100000`)',
        ].join('\n'),
      },
      {
        name: '🏝️ 콘텐츠',
        value: '`/모험섬` — 오늘의 모험 섬 시간표와 보상 (💰 = 골드섬)',
      },
    )
    .setFooter({ text: '입찰 계산: 판매 수수료 5% 반영 · 데이터: 로스트아크 오픈 API' });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
