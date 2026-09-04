// 카카오에 다 못 담은 결과의 전문을 잠깐 보관한다 — /p/full/<id> 페이지가 이걸 그대로 보여 준다.
// 방에는 읽기 좋은 분량만 보내고 "전체 보기" 주소를 한 줄 붙이는 식이라, 오래 남길 필요가 없어 메모리에만 둔다
// (봇이 재시작되면 링크는 만료된다 — 커맨드를 다시 치면 새 주소가 나온다).
import { randomBytes } from 'node:crypto';

const TTL_MS = 30 * 60 * 1000; // 방에서 링크를 눌러 볼 만한 시간
const MAX_ENTRIES = 300;       // 상한을 둬서 메모리가 계속 늘지 않게 한다

const store = new Map(); // id → { text, title, expires }

function prune(now = Date.now()) {
  for (const [id, entry] of store) {
    if (entry.expires <= now) store.delete(id);
  }
  // 그래도 넘치면 오래된 것부터 (Map은 삽입 순서를 지킨다)
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
}

// 전문을 보관하고 id를 돌려준다.
export function saveResult(text, title = '조회 결과') {
  prune();
  const id = randomBytes(6).toString('hex');
  store.set(id, { text: String(text ?? ''), title: String(title ?? '조회 결과'), expires: Date.now() + TTL_MS });
  return id;
}

// 보관된 전문. 없거나 지났으면 null.
export function getResult(id) {
  const entry = store.get(id);
  if (!entry) return null;
  if (entry.expires <= Date.now()) {
    store.delete(id);
    return null;
  }
  return { text: entry.text, title: entry.title };
}

// 테스트용 — 보관 중인 개수
export const resultCount = () => store.size;
