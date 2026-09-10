// 이모티콘 기능: "[키워드" 또는 ".키워드" 메시지가 오면 해당 이미지를 전송한다.
// 파일명이 곧 키워드라서, 이미지를 폴더에 넣기만 하면 재시작 없이 바로 등록된다.
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EMOTICON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'emoticons');
const EXTENSIONS = ['png', 'gif', 'jpg', 'jpeg', 'webp'];
const BIRTHDAY_ALIASES = new Map(
  ['굳', '추카', '냠', '고', '놉', '넵'].flatMap((word) =>
    ['', '코', '코코'].map((ending) => [word + ending, word === '굳' ? '굳' : `${word}코코`])),
);

// "[따봉", "[따봉]", ".따봉" 형태에서 키워드를 추출. 닫는 괄호는 대괄호 입력에만 허용한다.
// 한글(자모 포함)/영문/숫자 1~20자만 허용 — 경로 조작 문자를 원천 차단한다.
export function parseEmoticonKeyword(content) {
  const match = /^(?:\[([0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]{1,20})\]?|\.([0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]{1,20}))$/.exec(content.trim());
  return match ? (match[1] ?? match[2]) : null;
}

// 파일명 그대로 찾는다. 없으면 null.
function lookup(name) {
  for (const ext of EXTENSIONS) {
    const file = join(EMOTICON_DIR, `${name}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

// 키워드에 해당하는 이미지 파일 경로. 없으면 null.
// 모코콩콘처럼 "~콩"으로 끝나는 이름은 콩을 뗀 형태로도 부를 수 있게 한다 ([물줘 → 물줘콩).
// 정확히 일치하는 파일이 먼저다 — 짧은 이름이 다른 이모티콘을 가리는 일은 없다.
export function findEmoticonFile(keyword) {
  const alias = BIRTHDAY_ALIASES.get(keyword);
  return lookup(keyword) ?? (alias ? lookup(alias) : null)
    ?? (keyword.endsWith('콩') ? null : lookup(`${keyword}콩`));
}

// 등록된 이모티콘 키워드 목록 (가나다순).
export function listEmoticons() {
  try {
    return readdirSync(EMOTICON_DIR)
      .filter((f) => EXTENSIONS.some((ext) => f.toLowerCase().endsWith(`.${ext}`)))
      .map((f) => f.replace(/\.[^.]+$/, ''))
      .sort((a, b) => a.localeCompare(b, 'ko'));
  } catch {
    return [];
  }
}

// 현재 등록된 이모티콘 수 (시작 로그용).
export function countEmoticons() {
  return listEmoticons().length;
}
