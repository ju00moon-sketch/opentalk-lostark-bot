import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { EMBED_COLOR } from '../format.js';

export const data = new SlashCommandBuilder()
  .setName('cpm')
  .setDescription('분당 시전 횟수(CPM) 계산 — 시전 횟수 ÷ 전투 시간')
  .addIntegerOption((option) =>
    option.setName('횟수').setDescription('스킬을 쓴 총 횟수').setRequired(true).setMinValue(1),
  )
  .addStringOption((option) =>
    option
      .setName('시간')
      .setDescription('전투 시간 — 7분, 7:00, 420, 24분48초 (숫자만 쓰면 30 이하는 분, 넘으면 초)')
      .setRequired(true),
  )
  .addNumberOption((option) =>
    option.setName('목표').setDescription('목표 CPM (넣으면 필요한 횟수를 알려줘요)').setMinValue(0.1),
  );

// "7분", "7:00", "420", "24분48초", "7분30초" → 초. 못 읽으면 null.
export function parseDuration(input) {
  const text = String(input ?? '').replace(/\s+/g, '');
  if (!text) return null;

  let m = /^(\d+):(\d{1,2})$/.exec(text);
  if (m) return Number(m[1]) * 60 + Number(m[2]);

  m = /^(\d+)분(?:(\d+)초?)?$/.exec(text);
  if (m) return Number(m[1]) * 60 + Number(m[2] ?? 0);

  m = /^(\d+)초$/.exec(text);
  if (m) return Number(m[1]);

  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    // 딜지분·딜컷과 같은 규칙 — 작은 숫자는 분으로 본다
    return n <= 30 ? Math.round(n * 60) : Math.round(n);
  }
  return null;
}

const timeText = (sec) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
};

const USAGE =
  '전투 시간을 알아듣지 못했어요. `7분` `7:00` `420` `24분48초` 처럼 적어 주세요.';

export async function execute(interaction) {
  const count = interaction.options.getInteger('횟수');
  const seconds = parseDuration(interaction.options.getString('시간'));
  const target = interaction.options.getNumber('목표');

  if (!count || count < 1) {
    await interaction.reply('시전 횟수를 1 이상으로 넣어 주세요.');
    return;
  }
  if (!seconds || seconds < 1) {
    await interaction.reply(USAGE);
    return;
  }

  const minutes = seconds / 60;
  const cpm = count / minutes;
  const interval = seconds / count; // 1회당 평균 간격

  const lines = [
    `# ${cpm.toFixed(2)} CPM`,
    `\`${count}회\` ÷ \`${timeText(seconds)}\` = 분당 **${cpm.toFixed(2)}회**`,
    `평균 ${interval.toFixed(1)}초에 한 번씩 시전했어요.`,
  ];

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('⏱️ CPM (분당 시전 횟수)')
    .setDescription(lines.join('\n'));

  if (target) {
    // 필요한 횟수 = "횟수 ÷ 분 ≥ 목표"가 되는 가장 작은 정수. 곱셈 결과를 그대로 올리면 소수 오차로
    // 55.00000000000001 → 56(목표 2.2)이 되고, 반올림해 버리면 55.00000025 → 55(목표 2.20000001)로 틀린다.
    // 그래서 화면에 보이는 비교식과 같은 나눗셈으로 앞뒤 한 칸씩 확인해 맞춘다.
    let needed = Math.max(1, Math.ceil(target * minutes));
    while (needed > 1 && (needed - 1) / minutes >= target) needed--;
    while (needed / minutes < target) needed++;
    const diff = needed - count;
    embed.addFields({
      name: `목표 ${target} CPM`,
      value:
        `같은 시간(${timeText(seconds)})이면 **${needed}회** 필요해요.\n`
        + (diff > 0
          ? `지금보다 **${diff}회 더** 써야 합니다.`
          : `이미 **${Math.abs(diff)}회 여유**로 달성했어요.`),
    });
  }

  embed.setFooter({ text: 'CPM = 시전 횟수 × 60 ÷ 전투 시간(초)' });

  await interaction.reply({ embeds: [embed] });
}
