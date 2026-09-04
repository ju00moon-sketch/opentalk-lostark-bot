// 카카오톡 평문 레이아웃 조립기.
// 카톡에는 마크다운도 고정폭 글꼴도 없어서 공백으로 맞춘 표는 폰에서 어긋난다. 대신
//   ❙ 제목 · ▸ 항목 머리 · └ 이어지는 줄 · ※ 주의 · · 목록
// 이 몇 개 기호와 빈 줄만으로 덩어리를 나눈다. 디스코드 임베드에는 손대지 않는다.
//
// 여기서 만든 문자열은 render.js의 stripMarkdown을 한 번 더 지난다. 그래서
//   · 줄 앞뒤 공백과 연속 공백은 지워지니 들여쓰기로 무언가를 맞추려 하지 말 것
//   · **굵게** 같은 마크다운은 어차피 사라지니 쓰지 말 것

export const TITLE = (text) => `❙ ${text}`;
export const NOTE = (text) => `※ ${text}`;

// "▸ 이름" 다음 줄부터 내용. 내용이 비면 통째로 빠진다.
export function section(name, body) {
  const lines = (Array.isArray(body) ? body : [body]).flatMap((v) => String(v ?? '').split('\n')).filter((l) => l.trim());
  if (lines.length === 0) return null;
  return [name ? `▸ ${name}` : null, ...lines].filter((l) => l !== null).join('\n');
}

// 한 줄짜리 항목: "▸ 이름 값". 값이 없으면 빠진다.
export function row(name, value) {
  const v = String(value ?? '').trim();
  return v ? `▸ ${name} ${v}` : null;
}

// 값들을 " · "로 잇는다 — 빈 값은 빼고, 남는 게 없으면 null.
export const join = (...values) => {
  const kept = values.map((v) => (v === null || v === undefined ? '' : String(v).trim())).filter(Boolean);
  return kept.length > 0 ? kept.join(' · ') : null;
};

// 항목이 많은 나열(수집품·각인 등)을 줄당 perLine개씩 끊는다 — 폰에서 한 줄이 너무 길어지지 않게.
export function wrapItems(items, perLine = 4) {
  const kept = items.filter(Boolean);
  const lines = [];
  for (let i = 0; i < kept.length; i += perLine) lines.push(kept.slice(i, i + perLine).join(' '));
  return lines;
}

// 덩어리들을 빈 줄로 이어 하나의 본문으로. null·빈 덩어리는 빠진다.
export const blocks = (...parts) => parts.flat().filter((p) => p && String(p).trim()).join('\n\n');
