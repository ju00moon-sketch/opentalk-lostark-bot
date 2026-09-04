// 루트 JSON 상태 파일(등록·알림 채널·시세 기록·공지 워터마크)을 안전하게 읽고 쓰는 공용 헬퍼.
//
// 지켜야 할 두 가지:
//   1) "파일이 없음"과 "파일이 깨짐"을 구분한다. 없으면 빈 상태로 시작해도 되지만, 깨진 파일을 빈 상태로
//      취급한 채 저장하면 그 다음 저장이 기존 내용을 항목 하나로 덮어써 버린다. 깨졌을 때 쓰기는 거부한다.
//   2) 쓰기는 임시 파일에 다 적은 뒤 이름을 바꿔 끼운다 — 쓰다가 프로세스가 죽어도 반쪽짜리 파일이 남지 않는다.
//      바꿔 끼우기 직전의 원본은 .bak로 한 부 남긴다.
import {
  readFileSync, writeFileSync, renameSync, copyFileSync, existsSync, chmodSync,
} from 'node:fs';

const PRIVATE_MODE = 0o600;

export class CorruptStoreError extends Error {
  constructor(path, cause) {
    super(`상태 파일이 손상돼 읽지 못했어요: ${path} (${cause?.message ?? cause})`
      + (existsSync(`${path}.bak`) ? ` — 직전 백업 ${path}.bak 로 복구할 수 있어요` : ''));
    this.name = 'CorruptStoreError';
    this.path = path;
  }
}

// 파일 내용이 "쓸 만한 JSON"인지 — 비어 있거나 파싱이 안 되면 false. 백업 판단에 쓴다.
function parseIfSound(text) {
  if (typeof text !== 'string' || text.trim() === '') return { sound: false };
  try { return { sound: true, data: JSON.parse(text) }; } catch { return { sound: false }; }
}

// 파일을 읽어 JSON으로. 없으면 fallback. 깨졌으면 CorruptStoreError.
export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new CorruptStoreError(path, err);
  }
  // 빈 파일도 손상으로 본다. 우리는 항상 JSON을 쓰므로 0바이트 파일은 "쓰다 만" 것이고, 이를 빈 상태로 취급하면
  // 그 위에 저장하면서 마지막 정상 백업까지 덮어쓰게 된다. 없는 것(fallback)과는 다르게 다룬다.
  const parsed = parseIfSound(text);
  if (!parsed.sound) throw new CorruptStoreError(path, new Error(text.trim() === '' ? '빈 파일' : 'JSON 파싱 실패'));
  return parsed.data;
}

// 읽기 전용 경로에서 쓴다 — 깨져 있으면 기록만 남기고 fallback. 저장은 절대 이 결과 위에 하지 않는다.
export function readJsonLenient(path, fallback, label = path) {
  try {
    return readJson(path, fallback);
  } catch (err) {
    console.error(`${label} 읽기 실패 — 이번 조회에는 빈 상태로 대신합니다:`, err.message);
    return fallback;
  }
}

// 임시 파일에 적고 원자적으로 바꿔 끼운다. 원본이 "쓸 만한 JSON"일 때만 .bak로 복사한다 —
// 비어 있거나 깨진 원본으로 마지막 정상 백업을 덮어쓰면 복구할 곳이 사라진다.
export function writeJsonAtomic(path, data, { pretty = true } = {}) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data), {
    mode: PRIVATE_MODE,
  });
  // 이전 실행에서 더 넓은 권한의 임시 파일이 남았더라도 이번 교체 전에 반드시 닫는다.
  chmodSync(tmp, PRIVATE_MODE);
  if (existsSync(path)) {
    try {
      if (parseIfSound(readFileSync(path, 'utf8')).sound) {
        copyFileSync(path, `${path}.bak`);
        chmodSync(`${path}.bak`, PRIVATE_MODE);
      } else {
        console.error(`${path} 가 비어 있거나 깨져 있어 .bak를 갱신하지 않았어요 (직전 백업 유지)`);
      }
    } catch (err) {
      console.error(`${path} 백업 실패:`, err.message);
    }
  }
  renameSync(tmp, path);
}
