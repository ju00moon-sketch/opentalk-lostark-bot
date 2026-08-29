// 서버별 모험섬 알림 채널 저장소.
// 배포(scp)가 src/만 교체해도 설정이 유지되도록 프로젝트 루트의 JSON 파일에 저장한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'notify-channels.json');

function load() {
  try {
    if (existsSync(STORE_PATH)) return JSON.parse(readFileSync(STORE_PATH, 'utf8'));
  } catch (err) {
    console.error('알림 설정 파일 읽기 실패:', err.message);
  }
  return {};
}

function save(store) {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

// { 길드ID: 채널ID } 전체
export function getNotifyChannels() {
  return load();
}

export function setNotifyChannel(guildId, channelId) {
  const store = load();
  store[guildId] = channelId;
  save(store);
}

export function removeNotifyChannel(guildId) {
  const store = load();
  const had = guildId in store;
  delete store[guildId];
  save(store);
  return had;
}
