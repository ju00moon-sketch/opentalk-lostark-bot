import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { parseBraceletQuery, queryLabel, searchBracelets } from '../bracelet-search.js';
import { searchBraceletAuction } from '../lostark.js';
import { gold, trunc, EMBED_COLOR } from '../format.js';
import { TITLE, NOTE, blocks } from '../kakao/layout.js';

export const data = new SlashCommandBuilder()
  .setName('팔찌검색')
  .setDescription('경매장 팔찌 검색 — 특성 최소값·부여 수량으로 고대 팔찌 즉시 구매가 최저 10개 (예: 특90치90)')
  .addStringOption((option) =>
    option.setName('옵션').setDescription('특·치·신·제·인·숙 + 최소값, 선택: 부여3 · 고정2 · 강타 같은 특수 효과 (예: 특90치90)').setRequired(true),
  );

export const USAGE = '사용법: /팔찌검색 특90치90 — 특·치·신·제·인·숙 뒤에 최소값(붙여 써도 됨), 선택: 부여3(부여 효과 수량) · 고정2 · 강타 같은 특수 효과 이름';
export const FAILED = '경매장에서 팔찌 매물을 가져오지 못했어요. 잠시 후 다시 시도해 주세요';
export const NOTE_TEXT = '경매장 즉시 구매가 · 고대 4티어 · 부여 효과 내용(치피·적추 등)은 API가 주지 않아 표시하지 못해요';

// "2026-09-08T14:44:53.803"(시간대 없는 KST) → "9/8 14:44"
const endText = (endsAt) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(String(endsAt ?? ''));
  return m ? `${Number(m[2])}/${Number(m[3])} ${m[4]}` : null;
};

const itemLine = (item, index) => {
  const parts = [
    Number.isFinite(item.price) ? gold(item.price) : (Number.isFinite(item.bidStart) ? `입찰 시작 ${gold(item.bidStart)}` : '가격 없음'),
    item.stats.map((s) => `${s.name} ${s.value}`).join(' ') || null,
    item.randomSlots === null ? null : `부여 ${item.randomSlots}`,
    item.leap === null ? null : `도약 ${item.leap}`,
    ...item.specials.map((s) => (s.value ? `${s.name} ${s.value}` : s.name)),
    endText(item.endsAt) ? `마감 ${endText(item.endsAt)}` : null,
  ].filter(Boolean);
  return `${index + 1}. ${parts.join(' · ')}`;
};

export function resultTexts(result, query) {
  return {
    title: `팔찌 검색 · ${queryLabel(query)}`,
    summary: `조건에 맞는 매물 ${result.total.toLocaleString('ko-KR')}개 · 즉시 구매가 최저 ${result.items.length}개`,
    lines: result.items.map(itemLine),
    note: NOTE_TEXT,
  };
}

// 의존성을 주입할 수 있게 실행 함수를 만드는 공장 — 테스트에서 경매장 검색과 시계를 대역으로 바꾼다.
export function createExecute({ search = searchBraceletAuction, now = Date.now } = {}) {
  return async function execute(interaction) {
    const query = parseBraceletQuery(interaction.options.getString('옵션'));
    if (!query) {
      await interaction.reply(USAGE);
      return;
    }
    await interaction.deferReply();
    let result;
    try {
      result = await searchBracelets(query, { search, now });
    } catch (err) {
      console.error('팔찌검색 실패:', err.message);
      await interaction.editReply(FAILED);
      return;
    }
    if (result.items.length === 0) {
      await interaction.editReply(`조건에 맞는 팔찌 매물이 없어요 (${queryLabel(query)})`);
      return;
    }
    const texts = resultTexts(result, query);
    if (interaction.platform === 'kakao') {
      await interaction.editReply({ content: blocks(TITLE(texts.title), texts.summary, texts.lines.join('\n'), NOTE(texts.note)) });
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(EMBED_COLOR)
      .setTitle(`🔍 ${texts.title}`)
      .setDescription(trunc([texts.summary, '', ...texts.lines].join('\n'), 4096))
      .setFooter({ text: texts.note });
    await interaction.editReply({ embeds: [embed] });
  };
}

export const execute = createExecute();
