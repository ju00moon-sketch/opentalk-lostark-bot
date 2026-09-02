// 디스코드 유저 ↔ 로스트아크 캐릭터 연결 저장소.
// notify-store와 같은 방식 — 배포(scp)가 src/만 교체해도 유지되게 루트 JSON에 저장한다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STORE_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'user-links.json');

function load() {
  try {
    if (existsSync(STORE_PATH)) return JSON.parse(readFileSync(STORE_PATH, 'utf8'));
  } catch (err) {
    console.error('캐릭터 등록 파일 읽기 실패:', err.message);
  }
  return {};
}

function save(store) {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

export function getLinkedCharacter(userId) {
  return userId ? load()[userId] ?? null : null;
}

// { 디스코드 유저ID: 캐릭터명 } 전체 — /랭킹 집계용
export function getAllLinks() {
  return load();
}

export function linkCharacter(userId, characterName) {
  const store = load();
  store[userId] = characterName;
  save(store);
}

export function unlinkCharacter(userId) {
  const store = load();
  const had = userId in store;
  delete store[userId];
  save(store);
  return had;
}

const displayName = (interaction) =>
  interaction.member?.displayName ?? interaction.user?.globalName ?? interaction.user?.username;

const stripDecoration = (s) => s.replace(/[\p{Extended_Pictographic}]/gu, '').trim();

const SEPARATOR = /[/|\\([{<·,]/;

// 닉네임에 붙는 역할 표시 — 캐릭터명이 아니므로 등록 후보에서 뺀다.
// "서브"·"부캐"는 낀 단어까지 통째로 무시하고("부캐 건슬"),
// 나머지는 그 단어 하나일 때만 뺀다("메인"은 남의 실제 캐릭터로 존재해서 꼭 걸러야 한다).
const ROLE_CONTAINS = ['서브', '부캐'];
const ROLE_EXACT = new Set(['메인', '본캐', '딜러', '서폿', '서포터', '폿']);

// 서브·부캐가 붙은 칸은 통째로 버린다 — 본캐가 아니라 부캐를 등록해 버리지 않도록.
const isAltLabel = (segment) => ROLE_CONTAINS.some((word) => segment.includes(word));

// "본캐 소울과일"처럼 역할어가 캐릭터명에 붙어 있으면 떼어 낸 형태도 후보로 쓴다.
function withoutRoleWord(segment) {
  const rest = segment
    .split(/\s+/)
    .filter((token) => !ROLE_EXACT.has(token))
    .join(' ')
    .trim();
  return rest === segment ? null : rest;
}

const isRoleLabel = (segment) => isAltLabel(segment) || ROLE_EXACT.has(segment);

// 등록용 후보 목록. 앞에서부터 조회해 처음 찾아지는 캐릭터를 쓴다.
//
// 순서가 중요하다. "문주호(블레상돈)"처럼 본명이 앞에 오는 닉네임이 흔한데,
// 흔한 사람 이름은 남이 쓰는 실제 캐릭터명인 경우가 많다(문주호·홍길동·철수 모두 존재).
// 반대로 괄호 안이나 구분자 뒤에 붙는 말(딜러·서폿·본캐)은 캐릭터로 존재하지 않는다.
// 그래서 "명시적으로 떼어 적은 부분"을 본명 자리보다 먼저 조회해야 엉뚱한 사람이 등록되지 않는다.
export function discordNameCandidates(interaction) {
  const raw = displayName(interaction);
  if (!raw) return [];

  const cleaned = stripDecoration(raw);
  const segments = [];

  // 괄호 안: "본명(블레상돈)" → 블레상돈
  for (const m of cleaned.matchAll(/[([{<]\s*([^)\]}>]+?)\s*[)\]}>]/g)) segments.push(m[1].trim());
  // 구분자 뒤: "본명/블레상돈" → 블레상돈
  segments.push(...cleaned.split(/[/|\\·,]/).slice(1).map((part) => part.trim()));
  // 구분자 앞(본명 자리)은 마지막에 — 남의 캐릭터와 겹칠 수 있어서다
  segments.push(cleaned.split(SEPARATOR)[0].trim());

  const usable = segments.filter((s) => s && !isRoleLabel(s));
  const stripped = usable.map(withoutRoleWord).filter(Boolean);

  return [...new Set([raw.trim(), cleaned, ...stripped, ...usable].filter(Boolean))];
}

// 등록하지 않은 사람의 조회용 이름. 이모지만 걷어낸 순수한 닉네임일 때만 돌려준다.
// 구분자가 섞인 닉네임은 어느 쪽이 캐릭터명인지 조회 없이는 알 수 없고,
// 잘못 고르면 남의 캐릭터를 보여 주게 되므로 추측하지 않고 /등록으로 안내한다.
export function primaryDiscordName(interaction) {
  const raw = displayName(interaction);
  if (!raw) return null;
  const cleaned = stripDecoration(raw);
  return cleaned && !SEPARATOR.test(cleaned) ? cleaned : null;
}

// 커맨드에서 조회할 캐릭터를 정한다: 입력한 닉네임 > 등록한 캐릭터 > 디스코드 닉네임.
export function resolveCharacter(interaction) {
  const typed = interaction.options.getString('닉네임');
  if (typed) return typed;

  const linked = getLinkedCharacter(interaction.user?.id);
  if (linked) return linked;

  // 등록을 안 했어도 디스코드 닉네임이 캐릭터명이면 그대로 조회된다.
  return primaryDiscordName(interaction);
}

export const NO_CHARACTER_HINT =
  '닉네임을 입력해 주세요. `/등록`으로 내 캐릭터를 등록하면 다음부터 생략할 수 있어요!';
