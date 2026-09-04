// 임베드 출력용 공용 포맷터.

// 디스코드 임베드 필드 값은 1024자 제한.
export function trunc(text, max = 1024) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function gold(n) {
  return `${Math.floor(n).toLocaleString('ko-KR')}G`;
}

// 단위 없는 골드 표기 — 시세를 줄줄이 세우는 판에서는 G가 없는 편이 읽기 편하다.
export function amount(n) {
  return Math.floor(n).toLocaleString('ko-KR');
}

// 전일 대비 한 줄: "+ 4,600 (▲ 4.36%)" · "- 24,999 (▼ 0.86%)" · "변동없음 (● 0.00%)".
// 등락률은 비교 기준(전일) 가격에 대한 비율이다. 비교할 수 없으면 null.
//
// "변동없음"은 두 가격이 실제로 같을 때만 쓴다. 거래소 전일 평균가는 소수(99.99)로 오므로
// 표시할 금액을 반올림해 0인지로 따지면 99.99 → 100 같은 실제 등락이 무변동으로 묻힌다.
// 그래서 방향은 언제나 반올림 전 차이로 정하고, 금액 표기만 크기에 맞춘다:
//   1골드 이상 → 정수 · 0.01~1골드 → 소수 그대로 · 그보다 작으면 → "0.01 미만"(방향은 유지).
export function priceDelta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  const diff = current - previous;
  const percent = ((Math.abs(diff) / previous) * 100).toFixed(2);
  if (diff === 0) return `변동없음 (● ${percent}%)`;

  const size = Math.abs(diff);
  const shown = size >= 1 ? Math.round(size).toLocaleString('ko-KR')
    : size >= 0.01 ? String(Number(size.toFixed(2)))
      : '0.01 미만';
  const [sign, arrow] = diff > 0 ? ['+', '▲'] : ['-', '▼'];
  return `${sign} ${shown} (${arrow} ${percent}%)`;
}

export const EMBED_COLOR = 0xf5a623;

// 코드블록 표 정렬용. 한글·기호는 폭 2로 세어 라벨을 같은 폭으로 맞춘다.
export const displayWidth = (s) =>
  [...String(s)].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e7f ? 2 : 1), 0);

export const padDisplay = (label, width) =>
  label + ' '.repeat(Math.max(1, width - displayWidth(label)));

// 캐릭터를 찾지 못했을 때 공통 안내.
export const NOT_FOUND_HINT =
  '캐릭터를 찾을 수 없어요. 닉네임 철자를 확인하거나, 게임 내 전투정보실 공개 설정을 확인해 주세요.';
