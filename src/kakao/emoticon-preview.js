// 카카오의 가로 카드에는 원본을 자르지 않고 배치한 별도 이미지를 사용한다.
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findEmoticonFile, parseEmoticonKeyword } from '../emoticons.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DIR = path.join(ROOT, 'assets', 'emoticons');
export const EMOTICON_PREVIEW_DIR = path.join(ROOT, 'assets', 'emoticon-previews');
const VERSION = 'kakao-emoticon-preview-v1\0';

// 원본이나 파생본이 없거나 폴더 밖을 가리키면 미리보기를 사용하지 않는다.
// 해시에 원본 내용과 배치 버전을 넣어 교체 전 카드 캐시와 구분한다.
export function emoticonPreviewFor(file) {
  try {
    if (typeof file !== 'string' || path.dirname(path.resolve(file)) !== SOURCE_DIR) return null;
    const original = realpathSync(file);
    if (path.dirname(original) !== realpathSync(SOURCE_DIR) || !statSync(original).isFile()) return null;
    const keyword = path.basename(file, path.extname(file));
    if (!parseEmoticonKeyword(`[${keyword}`)) return null;
    const revision = createHash('sha256').update(VERSION).update(readFileSync(original)).digest('hex').slice(0, 16);
    for (const extension of ['png', 'gif', 'webp']) {
      const name = `${keyword}-${revision}.${extension}`;
      try {
        const candidate = realpathSync(path.join(EMOTICON_PREVIEW_DIR, name));
        if (path.dirname(candidate) !== realpathSync(EMOTICON_PREVIEW_DIR)) continue;
        const stat = statSync(candidate);
        if (stat.isFile() && stat.size > 0) return { name, revision, width: 800, height: 400 };
      } catch { /* 생성 전이거나 제거된 파생본은 원본으로 표시한다. */ }
    }
  } catch { /* 읽을 수 없는 원본은 파생본을 공개하지 않는다. */ }
  return null;
}

export function emoticonCardUrl(file, baseUrl, preview = emoticonPreviewFor(file)) {
  const keyword = path.basename(file, path.extname(file));
  return `${baseUrl}/p/emo/${encodeURIComponent(keyword)}${preview ? `?v=fit1-${preview.revision}` : ''}`;
}

// 삭제되거나 교체된 원본의 예전 파생본은 직접 URL로도 공개하지 않는다.
export function isCurrentEmoticonPreview(rawName) {
  let name;
  try { name = decodeURIComponent(rawName); } catch { return false; }
  const match = /^([0-9A-Za-z가-힣ㄱ-ㅎㅏ-ㅣ]{1,20})-[a-f0-9]{16}\.(?:png|gif|webp)$/.exec(name);
  if (!match) return false;
  const file = findEmoticonFile(match[1]);
  return file !== null && emoticonPreviewFor(file)?.name === name;
}
