// 임베드 출력용 공용 포맷터.

// 디스코드 임베드 필드 값은 1024자 제한.
export function trunc(text, max = 1024) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function gold(n) {
  return `${Math.floor(n).toLocaleString('ko-KR')}G`;
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
