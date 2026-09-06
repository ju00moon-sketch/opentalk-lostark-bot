import { SlashCommandBuilder } from 'discord.js';
import { crystalStore, MIN_PRICE, MAX_PRICE, peonGold, AUTO_LABEL } from '../crystal-price.js';
import { REFRESH_HOUR_KST } from '../crystal-auto.js';

export const data = new SlashCommandBuilder()
  .setName('크리스탈')
  .setDescription('스펙업 페온 환산에 쓰는 크리스탈 시세(블루 크리스탈 95개의 골드 가격) 조회·설정')
  .addIntegerOption((option) =>
    option.setName('가격').setDescription('화폐거래소에서 골드로 블루 크리스탈 95개를 살 때 가격 (예: 16626)')
      .setMinValue(MIN_PRICE).setMaxValue(MAX_PRICE),
  );

const PREFIX = '/'; // 디스코드는 슬래시, 카톡은 /커맨드 — 예시 표기는 둘 다 /
const gold = (n) => `${Math.round(n).toLocaleString('ko-KR')}G`;
const two = (n) => String(n).padStart(2, '0');
const kstStamp = (ms) => { // KST "월/일 HH:MM"
  const d = new Date(ms + 9 * 60 * 60 * 1000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
};

export const HOW_TO = '화폐거래소에서 골드로 블루 크리스탈 95개를 살 때 가격을 적어 주세요';
export const AUTO_AT = `매일 ${two(REFRESH_HOUR_KST)}:00`; // 자동 갱신 시각 표기
const USED_FOR = '/스펙업의 악세·스톤 기대 비용에 이 값으로 환산한 페온 골드를 더합니다 (악세 35개 · 스톤 1개당 9개).';

// 조회 문구 4종: 미설정 · 자동 갱신값 · 직접 설정값 · (둘 다에) 7일 초과.
export function statusText(setting, { stale = false, prefix = '/' } = {}) {
  if (!setting) {
    return [
      '크리스탈 시세가 아직 없어요 — 지금은 /스펙업이 페온을 뺀 비용으로 계산합니다.',
      `봇이 ${AUTO_AT}에 ${AUTO_LABEL}(LOSPI) 시세를 자동으로 가져와요. 먼저 쓰고 싶으면 직접 적어도 돼요: ${prefix}크리스탈 16626 (${HOW_TO.replace('을 적어 주세요', '')})`,
    ].join('\n');
  }
  const when = setting.at ? kstStamp(setting.at) : '시각 미상';
  const origin = setting.source === 'auto'
    ? `${when} 자동 갱신 · ${setting.by ?? AUTO_LABEL}`
    : `${when} 직접 설정${setting.by ? ` · ${setting.by}` : ''}`;
  const lines = [
    `현재 크리스탈 시세: 95개 ${gold(setting.price95)} (${origin}) → 페온 1개 ≈ ${gold(peonGold(setting.price95))}`,
    USED_FOR,
  ];
  if (stale) lines.push('※ 7일 넘게 갱신되지 않았어요 — 자동 갱신이 안 되고 있어요. 화폐거래소 값을 직접 적어 주세요.');
  lines.push(setting.source === 'auto'
    ? `${AUTO_AT} 자동 갱신 · 직접 적으면(${prefix}크리스탈 95개가격) 24시간 동안 그 값을 우선해요`
    : `직접 적은 값은 24시간 동안 우선하고, 그 뒤 ${AUTO_AT} ${AUTO_LABEL} 시세로 자동 갱신돼요`);
  return lines.join('\n');
}

export function savedText(record) {
  return [
    `크리스탈 시세를 95개 ${gold(record.price95)}로 저장했어요 → 페온 1개 ≈ ${gold(peonGold(record.price95))}`,
    '이제 /스펙업 악세·스톤 비용에 페온 골드가 포함됩니다 (5분 안에 조회한 결과는 다음 갱신부터 반영).',
    `이 값은 24시간 동안 자동 시세(${AUTO_LABEL})보다 우선하고, 그 뒤 ${AUTO_AT} 자동 갱신으로 돌아가요.`,
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
