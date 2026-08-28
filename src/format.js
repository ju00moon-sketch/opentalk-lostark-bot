// 임베드 출력용 공용 포맷터.

// 디스코드 임베드 필드 값은 1024자 제한.
export function trunc(text, max = 1024) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function gold(n) {
  return `${Math.floor(n).toLocaleString('ko-KR')}G`;
}

export const EMBED_COLOR = 0xf5a623;

// 캐릭터를 찾지 못했을 때 공통 안내.
export const NOT_FOUND_HINT =
  '캐릭터를 찾을 수 없어요. 닉네임 철자를 확인하거나, 게임 내 전투정보실 공개 설정을 확인해 주세요.';
