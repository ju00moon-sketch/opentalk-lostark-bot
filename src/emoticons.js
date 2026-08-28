// 이모티콘 기능: "[키워드" 메시지가 오면 assets/emoticons/키워드.png 를 전송한다.
// 파일명이 곧 키워드라서, 이미지를 폴더에 넣기만 하면 재시작 없이 바로 등록된다.
import { existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EMOTICON_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'emoticons');
const EXTENSIONS = ['png', 'gif', 'jpg', 'jpeg', 'webp'];

// "[따봉" 또는 "[따봉]" 형태에서 키워드를 추출. 해당 형태가 아니면 null.
// 한글(자모 포함)/영문/숫자 1~20자만 허용 — 경로 조작 문자를 원천 차단한다.
export function parseEmoticonKeyword(content) {
  const match = /^\[([0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]{1,20})\]?$/.exec(content.trim());
  return match ? match[1] : null;
}

// 키워드에 해당하는 이미지 파일 경로. 없으면 null.
export function findEmoticonFile(keyword) {
  for (const ext of EXTENSIONS) {
    const file = join(EMOTICON_DIR, `${keyword}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

// 현재 등록된 이모티콘 수 (시작 로그용).
export function countEmoticons() {
  try {
    return readdirSync(EMOTICON_DIR).filter((f) =>
      EXTENSIONS.some((ext) => f.toLowerCase().endsWith(`.${ext}`)),
    ).length;
  } catch {
    return 0;
  }
}
