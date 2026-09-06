import { SlashCommandBuilder } from 'discord.js';
import { crystalStore, MIN_PRICE, MAX_PRICE, peonGold } from '../crystal-price.js';

export const data = new SlashCommandBuilder()
  .setName('크리스탈')
  .setDescription('스펙업 페온 환산에 쓰는 크리스탈 시세(블루 크리스탈 95개의 골드 가격) 조회·설정')
  .addIntegerOption((option) =>
    option.setName('가격').setDescription('화폐거래소에서 골드로 블루 크리스탈 95개를 살 때 가격 (예: 16626)')
      .setMinValue(MIN_PRICE).setMaxValue(MAX_PRICE),
  );

const PREFIX = '/'; // 디스코드는 슬래시, 카톡은 /커맨드 — 예시 표기는 둘 다 /
const gold = (n) => `${Math.round(n).toLocaleString('ko-KR')}G`;
const kstStamp = (ms) => { // KST "월/일 HH:MM"
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
};

export const HOW_TO = '화폐거래소에서 골드로 블루 크리스탈 95개를 살 때 가격을 적어 주세요';

export function statusText(setting, { stale = false, prefix = '/' } = {}) {
  if (!setting) {
    return [
      '크리스탈 시세가 아직 없어요 — 지금은 /스펙업이 페온을 뺀 비용으로 계산합니다.',
      `${HOW_TO} (예: ${prefix}크리스탈 16626)`,
    ].join('\n');
  }
  const when = setting.at ? kstStamp(setting.at) : '시각 미상';
  const by = setting.by ? ` · ${setting.by}` : '';
  const lines = [
    `현재 크리스탈 시세: 95개 ${gold(setting.price95)} (${when} 설정${by}) → 페온 1개 ≈ ${gold(peonGold(setting.price95))}`,
    '/스펙업의 악세·스톤 기대 비용에 이 값으로 환산한 페온 골드를 더합니다 (악세 35개 · 스톤 1개당 9개).',
  ];
  if (stale) lines.push('※ 7일 넘게 갱신되지 않았어요. 화폐거래소 값을 다시 적어 주세요.');
  lines.push(`갱신: ${prefix}크리스탈 95개가격`);
  return lines.join('\n');
}

export function savedText(record) {
  return [
    `크리스탈 시세를 95개 ${gold(record.price95)}로 저장했어요 → 페온 1개 ≈ ${gold(peonGold(record.price95))}`,
    '이제 /스펙업 악세·스톤 비용에 페온 골드가 포함됩니다 (5분 안에 조회한 결과는 다음 갱신부터 반영).',
  ].join('\n');
}

// 의존성을 주입할 수 있게 실행 함수를 만드는 공장 — 테스트에서 저장소를 임시 파일로 바꾼다.
export function createExecute({ store = crystalStore } = {}) {
  return async function execute(interaction) {
    const price = interaction.options.getInteger('가격');
    const prefix = PREFIX;
    if (price === null || price === undefined) {
      const setting = store.get();
      await interaction.reply(statusText(setting, { stale: store.isStale(setting), prefix }));
      return;
    }
    if (!Number.isInteger(price) || price < MIN_PRICE || price > MAX_PRICE) {
      await interaction.reply(`크리스탈 가격은 ${MIN_PRICE.toLocaleString('ko-KR')}~${MAX_PRICE.toLocaleString('ko-KR')} 사이의 정수로 적어 주세요. ${HOW_TO} (예: ${prefix}크리스탈 16626)`);
      return;
    }
    const record = store.set(price, interaction.user?.username ?? null);
    await interaction.reply(savedText(record));
  };
}

export const execute = createExecute();
