// 서버별 모험섬 알림 채널 저장소.
// 배포(scp)가 src/만 교체해도 설정이 유지되도록 프로젝트 루트의 JSON 파일에 저장한다.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, readJsonLenient, writeJsonAtomic } from './json-store.js';

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'notify-channels.json');

// 조회용은 깨져도 빈 상태로 대신하고, 저장용은 깨진 파일 위에 덮어쓰지 않도록 CorruptStoreError를 던진다.
const load = () => readJsonLenient(STORE_PATH, {}, '알림 설정 파일');
const loadForWrite = () => readJson(STORE_PATH, {});
const save = (store) => writeJsonAtomic(STORE_PATH, store);

// { 길드ID: 채널ID } 전체
export function getNotifyChannels() {
  return load();
}

export function setNotifyChannel(guildId, channelId) {
  const store = loadForWrite();
  store[guildId] = channelId;
  save(store);
}

export function removeNotifyChannel(guildId) {
  const store = loadForWrite();
  const had = guildId in store;
  delete store[guildId];
  save(store);
  return had;
}
