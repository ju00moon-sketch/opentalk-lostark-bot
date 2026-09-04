# 카카오톡 채널 챗봇 연동 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 디스코드 봇 프로세스에 카카오 오픈빌더 스킬 서버를 내장해, 카카오톡 채널 1:1 채팅에서 `/정보 블레상돈` 같은
`/커맨드` 형식으로 기존 커맨드를 그대로 쓸 수 있게 한다.

**Architecture:** `src/kakao/` 네 파일(server·handler·interaction·render)을 새로 얹는다. 발화 매칭은 `text-commands.js`의
매처를 함수로 분리해 디스코드와 공유하고, 커맨드는 `KakaoInteraction` 어댑터(기존 `TextInteraction`과 같은 표면)로
실행한 뒤 디스코드 페이로드를 카카오 JSON으로 변환한다. 5초 제한은 4.5초 예산 + 보류 캐시 + (승인 시) 콜백으로 처리한다.

**Tech Stack:** Node.js 24 ESM, Node 내장 `http`/`fs`/`node:test`(추가 의존성 없음), discord.js 14(기존), 카카오 오픈빌더 스킬 v2.0.

**Spec:** `specs/2026-09-04-kakao-channel-bot-design.md`

## Global Constraints

- 새 npm 의존성 추가 금지 — Node 내장 모듈만.
- `KAKAO_PORT`가 없으면 운영 봇 동작은 기존과 완전히 동일해야 한다(카카오 서버 안 켬).
- 디스코드 텍스트 커맨드 동작 불변: 초성은 접두사 없이, 단어는 `.`/`!` 필수. 매처 분리 후에도 같아야 한다.
- 카카오 입력은 `/커맨드` 형식만. 접두사 없는 초성·`.단어`는 옵션 스위치로만 남긴다(기본 꺼짐).
- 카카오 제외 커맨드: `알림설정` `랭킹` `체급`(별칭 `ㄹㅋ` `ㅊㄱ` 포함, 대상 이름 기준으로 판단).
- 카카오 응답 제한: `outputs` 최대 3개, `simpleText` 1,000자, `quickReplies` 최대 10개, label 14자.
- 스킬 서버는 항상 `200 + JSON`으로 답한다(오류도 문구로).
- 정적 파일은 `assets/emoticons`·`assets/charts` 두 폴더의 직접 자식만.
- 테스트 파일은 저장소에 커밋하지 않는다 — 아래 `SCRATCH` 폴더에서 `node --test`로 돌리고 끝낸다.
  `SCRATCH = C:/Users/Xotepsin/AppData/Local/Temp/claude/D--OpenTalk/61575c71-3a0c-4777-9075-e4fb623f2833/scratchpad/kakao-tests`
  (테스트에서 프로젝트 모듈은 `file:///D:/OpenTalk/src/...`로, discord.js는 `createRequire('file:///D:/OpenTalk/package.json')`로 가져온다.)
- 커밋은 dev 브랜치에. `git status`에 `CLAUDE.md`가 보이면 절대 스테이징하지 않는다(gitignore 대상).
- 배포는 하지 않는다 — main 머지 때 함께. 서버 iptables 준비(Task 7)만 미리 해 둔다.
- 커밋 메시지에 Co-Authored-By 등 서명 줄 금지.

---

## 파일 구조

| 파일 | 역할 |
|---|---|
| `src/text-commands.js` (수정) | `matchTextCommand()`·`parseGenericOptions()` 분리. `handleTextCommand()`는 이를 호출(동작 불변) |
| `src/kakao/render.js` (신규) | 디스코드 페이로드 → 카카오 JSON 순수 변환 |
| `src/kakao/interaction.js` (신규) | `KakaoInteraction` 어댑터 — 페이로드 수집 |
| `src/commands/register.js` (수정) | `platform === 'kakao'`면 `/등록 닉네임`·`/등록 해제` 흐름 |
| `src/kakao/handler.js` (신규) | 발화 → 커맨드 실행, 4.5초 예산, 보류 캐시, 콜백, 안내문 |
| `src/kakao/server.js` (신규) | HTTP 라우팅, 정적 파일, 본문 제한, 시작/로그 |
| `src/index.js` (수정) | `startKakaoServer(commandMap)` 한 줄 |
| `.env.example` (수정) | 환경변수 3개 설명 |

---

### Task 1: 발화 매처 분리 + 범용 옵션 파서

**Files:**
- Modify: `src/text-commands.js` (하단 `WORD_CMDS` 정의부터 `handleTextCommand` 끝까지)
- Test: `$SCRATCH/match.test.mjs`

**Interfaces:**
- Produces: `matchTextCommand(content, commandMap, { prefixes = ['.', '!'], bareChosung = true, anyCommand = false } = {})`
  → `null` | `{ command, options, label }` | `{ command, usage, label }` (`usage`가 있으면 옵션 부족·잘못됨).
- Produces: `parseGenericOptions(command, tokens)` → `{ options }` | `{ usage }`. 별칭이 없는 커맨드를 슬래시 옵션 정의로
  위치 기반 파싱(`옵션명:값` 지정도 허용, 마지막 문자열 옵션은 남은 토큰을 통째로, 필수 누락·choices 불일치·숫자 아님 → usage).
- Consumes: 기존 `ALIASES`, `WORD_CMDS`, `CHOSUNG_ONLY`, `matchRefinePattern`, `toInt`, `runCommand`.

- [ ] **Step 1: 실패하는 테스트 작성**

`$SCRATCH/match.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commands } from 'file:///D:/OpenTalk/src/commands/index.js';
import { matchTextCommand, parseGenericOptions } from 'file:///D:/OpenTalk/src/text-commands.js';

const commandMap = new Map(commands.map((c) => [c.data.name, c]));
const KAKAO = { prefixes: ['/'], bareChosung: false, anyCommand: true };

test('디스코드 모드: 초성은 접두사 없이, 단어는 . 필수', () => {
  assert.equal(matchTextCommand('ㅈㅂ 블레상돈', commandMap).command.data.name, '정보');
  assert.equal(matchTextCommand('ㅈㅂ 블레상돈', commandMap).options.닉네임, '블레상돈');
  assert.equal(matchTextCommand('정보 블레상돈', commandMap), null);
  assert.equal(matchTextCommand('.정보 블레상돈', commandMap).command.data.name, '정보');
  assert.equal(matchTextCommand('!분배금 4000', commandMap).options.가격, 4000);
  assert.equal(matchTextCommand('.상상 70', commandMap).command.data.name, '악세');
  assert.equal(matchTextCommand('.장비 블레상돈', commandMap), null, '별칭 없는 커맨드는 디스코드 채팅에서 여전히 안 됨');
  assert.equal(matchTextCommand('ㅂㅂㄱ', commandMap).usage, 'ㅂㅂㄱ 가격 [인원] (예: ㅂㅂㄱ 4000)');
  assert.equal(matchTextCommand('지옥 같네', commandMap), null);
});

test('카카오 모드: / 형식만', () => {
  assert.equal(matchTextCommand('ㅈㅂ 블레상돈', commandMap, KAKAO), null);
  assert.equal(matchTextCommand('.정보 블레상돈', commandMap, KAKAO), null);
  assert.equal(matchTextCommand('/정보 블레상돈', commandMap, KAKAO).options.닉네임, '블레상돈');
  assert.equal(matchTextCommand('/ㅈㅂ 블레상돈', commandMap, KAKAO).command.data.name, '정보');
  assert.equal(matchTextCommand('/ㅂㅂㄱ 4000', commandMap, KAKAO).options.가격, 4000);
  assert.equal(matchTextCommand('/상상 70', commandMap, KAKAO).options.검색, '상상');
  assert.equal(matchTextCommand('/장비 블레상돈', commandMap, KAKAO).options.닉네임, '블레상돈', '별칭 없는 커맨드도 됨');
  assert.equal(matchTextCommand('/없는커맨드 x', commandMap, KAKAO), null);
  assert.equal(matchTextCommand('/ㄹㅋ', commandMap, KAKAO).command.data.name, '랭킹', '제외는 handler 몫 — 매처는 그대로 돌려준다');
});

test('범용 옵션 파서', () => {
  const eff = commandMap.get('효율');
  assert.deepEqual(parseGenericOptions(eff, ['지옥', '5']).options, { 콘텐츠: '지옥', 단계: 5, 레벨: null });
  assert.deepEqual(parseGenericOptions(eff, ['나락', '3', '1700']).options, { 콘텐츠: '나락', 단계: 3, 레벨: 1700 });
  assert.equal(parseGenericOptions(eff, ['천국', '5']).usage, '/효율 지옥|나락 단계 [1640|1700|1730|1750]');
  assert.equal(parseGenericOptions(eff, ['지옥']).usage, '/효율 지옥|나락 단계 [1640|1700|1730|1750]');
  assert.equal(parseGenericOptions(eff, ['지옥', '다섯']).usage, '/효율 지옥|나락 단계 [1640|1700|1730|1750]');
  const core = commandMap.get('코어');
  assert.deepEqual(parseGenericOptions(core, ['블레이드', '혼돈']).options, { 검색: '블레이드 혼돈' });
  assert.equal(parseGenericOptions(core, []).usage, '/코어 검색');
  const acc = commandMap.get('악세');
  assert.deepEqual(parseGenericOptions(acc, ['검색:상상', '품질:70']).options, { 닉네임: null, 검색: '상상', 품질: 70 });
  assert.deepEqual(parseGenericOptions(commandMap.get('모험섬'), []).options, {});
  assert.deepEqual(parseGenericOptions(commandMap.get('장비'), ['블레상돈']).options, { 닉네임: '블레상돈' });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test "$SCRATCH/match.test.mjs"`
Expected: FAIL — `matchTextCommand`·`parseGenericOptions` export 없음(SyntaxError: does not provide an export).

- [ ] **Step 3: 구현**

`src/text-commands.js`에서 `const WORD_CMDS = …` 줄 아래의 `matchRefinePattern`은 그대로 두고, `runCommand`와
`handleTextCommand`를 아래로 교체한다(그 사이에 새 함수 추가):

```js
// ── 슬래시 옵션 정의로 범용 파싱 (별칭이 없는 커맨드용 — 카카오에서 /장비 닉네임 같은 형태)
const OPT = { SUB: 1, SUB_GROUP: 2, STRING: 3, INTEGER: 4, BOOLEAN: 5, CHANNEL: 7, NUMBER: 10 };

function usageOf(name, defs) {
  const parts = defs.map((o) => {
    const label = o.choices ? o.choices.map((c) => c.value).join('|') : o.name;
    return o.required ? label : `[${label}]`;
  });
  return `/${name} ${parts.join(' ')}`.trim();
}

// tokens를 옵션 정의 순서대로 채운다. "옵션명:값"으로 특정 옵션을 지정할 수도 있다.
// 마지막에 남은 옵션이 문자열이면 남은 토큰을 통째로 받는다(닉네임·검색어에 띄어쓰기 허용).
export function parseGenericOptions(command, tokens) {
  const json = command.data.toJSON();
  const defs = (json.options ?? []).filter((o) => ![OPT.SUB, OPT.SUB_GROUP, OPT.CHANNEL].includes(o.type));
  if (defs.length === 0) return { options: {} };
  const usage = usageOf(json.name, defs);
  const options = {};
  const rest = [];
  for (const token of tokens) {
    const m = /^([^:]+):(.+)$/.exec(token);
    const def = m && defs.find((o) => o.name === m[1]);
    if (def) options[def.name] = m[2];
    else rest.push(token);
  }
  const unfilled = defs.filter((o) => !(o.name in options));
  unfilled.forEach((def, i) => {
    if (rest.length === 0) return;
    const isLastString = i === unfilled.length - 1 && def.type === OPT.STRING;
    options[def.name] = isLastString ? rest.splice(0).join(' ') : rest.shift();
  });
  for (const def of defs) {
    const raw = options[def.name];
    if (raw === undefined) {
      if (def.required) return { usage };
      options[def.name] = null;
      continue;
    }
    let value = raw;
    if (def.type === OPT.INTEGER) value = toInt(raw);
    else if (def.type === OPT.NUMBER) value = Number(String(raw).replace(/,/g, ''));
    else if (def.type === OPT.BOOLEAN) value = /^(true|1|예|응|on|켜기)$/i.test(raw);
    if (value === null || (typeof value === 'number' && !Number.isFinite(value))) return { usage };
    if (def.choices && !def.choices.some((c) => String(c.value) === String(value))) return { usage };
    options[def.name] = value;
  }
  return { options };
}

// 발화를 (커맨드, 옵션)으로 해석한다. 처리 대상이 아니면 null, 옵션이 부족하면 { command, usage }.
//   prefixes    — 단어형 커맨드(정보·상상)에 요구하는 접두사. 디스코드는 . ! / 카카오는 /
//   bareChosung — 초성 별칭을 접두사 없이 허용할지 (디스코드 true, 카카오 false)
//   anyCommand  — 별칭이 없는 커맨드도 슬래시 옵션 정의로 파싱해 허용할지 (카카오 true)
export function matchTextCommand(content, commandMap, { prefixes = ['.', '!'], bareChosung = true, anyCommand = false } = {}) {
  const parts = content.trim().split(/\s+/);
  const raw = parts[0] ?? '';
  const prefix = prefixes.find((p) => raw.startsWith(p));
  const hasPrefix = prefix !== undefined;
  const token = hasPrefix ? raw.slice(prefix.length) : raw;
  const params = parts.slice(1);
  if (!token) return null;

  // 악세 연마 조합(.상상)은 단어형이라 접두사가 필요하다
  const refine = hasPrefix ? matchRefinePattern(token, params) : null;
  if (refine) {
    const command = commandMap.get(refine.cmd);
    return command ? { command, options: refine.options, label: raw } : null;
  }

  // 초성은 (허용 시) 접두사 유무 무관, 단어형 축약은 접두사 필수
  let alias = null;
  if (ALIASES[token] && ((bareChosung && CHOSUNG_ONLY.test(token)) || hasPrefix)) alias = ALIASES[token];
  if (!alias && hasPrefix && WORD_CMDS.has(token)) alias = WORD_CMDS.get(token); // 원래 커맨드명
  if (alias) {
    const command = commandMap.get(alias.cmd);
    if (!command) return null;
    const options = alias.parse(params);
    if (options === null) return { command, usage: alias.usage, label: raw };
    return { command, options, label: raw };
  }

  // 별칭이 없는 커맨드 — 카카오처럼 모든 커맨드를 /이름 인자 형태로 받을 때만
  if (anyCommand && hasPrefix && commandMap.has(token)) {
    const command = commandMap.get(token);
    const parsed = parseGenericOptions(command, params);
    if (parsed.usage) return { command, usage: parsed.usage, label: raw };
    return { command, options: parsed.options, label: raw };
  }
  return null;
}

// 어댑터를 만들어 커맨드를 실행한다. 항상 true(처리함)를 반환한다.
async function runCommand(command, message, options, label) {
  const fake = new TextInteraction(message, options);
  try {
    await command.execute(fake);
  } catch (err) {
    console.error(`[채팅 ${label}]`, err);
    await message.reply(`오류가 발생했어요: ${err.message}`).catch(() => {});
  }
  return true;
}

// 처리했으면 true를 반환한다.
export async function handleTextCommand(message, commandMap) {
  const match = matchTextCommand(message.content, commandMap);
  if (!match) return false;
  if (match.usage) {
    await message.reply(`사용법: \`${match.usage}\``).catch(() => {});
    return true;
  }
  return runCommand(match.command, message, match.options, match.label);
}
```

주의: 기존 `handleTextCommand`는 `hasPrefix = /^[.!]/.test(raw)` 후 `raw.replace(/^[.!]/, '')`였다 — 새 코드는
`prefixes` 배열 중 첫 일치 접두사 1글자를 떼므로 결과가 같다. `commandMap.has(token)`는 별칭 커맨드(`ㅂㅂㄱ` 등)도 포함하지만
그 경우는 위 `ALIASES` 분기가 먼저 잡는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test "$SCRATCH/match.test.mjs"`
Expected: `# pass 3` `# fail 0`.

- [ ] **Step 5: 디스코드 봇이 그대로 뜨는지 확인**

Run: `node --input-type=module -e "import('./src/text-commands.js').then(m => console.log(Object.keys(m)))"`
Expected: `[ 'ALIASES', 'handleTextCommand', 'matchTextCommand', 'parseGenericOptions' ]` (순서 무관).

- [ ] **Step 6: 커밋**

```bash
git add src/text-commands.js
git commit -m "텍스트 커맨드 매처를 함수로 분리 — 접두사·초성 허용을 옵션으로, 별칭 없는 커맨드용 범용 옵션 파서 추가"
```

---

### Task 2: 카카오 응답 변환기 `render.js`

**Files:**
- Create: `src/kakao/render.js`
- Test: `$SCRATCH/render.test.mjs`

**Interfaces:**
- Produces: `stripMarkdown(text) → string`, `embedToText(embed) → string`, `splitText(text, max = 1000, parts = 3) → string[]`,
  `buttonsToQuickReplies(rows) → { quickReplies: [{label, action:'message', messageText}], links: string[] }`,
  `publicUrlFor(filePath, baseUrl) → string | null`, `toKakaoResponse(payloads, { baseUrl }) → { version, template }`,
  `textResponse(text, quickReplies = []) → { version, template }`.
- Consumes: 없음(순수 함수). 페이로드는 `reply()`에 넘기던 값 그대로 — 문자열 또는 `{ content, embeds, files, components, flags }`.

- [ ] **Step 1: 실패하는 테스트 작성**

`$SCRATCH/render.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  stripMarkdown, embedToText, splitText, buttonsToQuickReplies, publicUrlFor, toKakaoResponse, textResponse,
} from 'file:///D:/OpenTalk/src/kakao/render.js';

const { EmbedBuilder, AttachmentBuilder } = createRequire('file:///D:/OpenTalk/package.json')('discord.js');
const { characterButtons, commandButtons } = await import('file:///D:/OpenTalk/src/buttons.js');
const BASE = 'http://example.test';

test('마크다운 제거', () => {
  assert.equal(stripMarkdown('**굵게** `코드` __밑줄__ ~~취소~~'), '굵게 코드 밑줄 취소');
  assert.equal(stripMarkdown('```\n라벨      1,234\n둘째     5\n```'), '라벨 1,234\n둘째 5');
  assert.equal(stripMarkdown('[공지](https://a.b/c) 보기'), '공지 https://a.b/c 보기');
  assert.equal(stripMarkdown('<#123> 채널에서 <@456> 님'), '채널에서 님');
  assert.equal(stripMarkdown('첫 줄   \n둘째'), '첫 줄\n둘째', '줄 끝 공백 제거·줄바꿈 유지');
});

test('임베드 → 텍스트', () => {
  const embed = new EmbedBuilder()
    .setTitle('📋 블레상돈').setDescription('설명 **강조**')
    .addFields({ name: '특성', value: '치 1200' }, { name: '\u200b', value: '**함께 올라온 공지**\n[a](https://x.y)' })
    .setThumbnail('https://img/x.png').setImage('attachment://chembang.png')
    .setFooter({ text: '푸터' });
  assert.equal(
    embedToText(embed),
    '📋 블레상돈\n설명 강조\n\n▸ 특성\n치 1200\n\n함께 올라온 공지\na https://x.y\n\n푸터',
  );
});

test('1000자 분할, 최대 3개, 초과는 …', () => {
  const line = 'x'.repeat(400);
  const text = Array.from({ length: 9 }, () => line).join('\n'); // 3,608자
  const parts = splitText(text, 1000, 3);
  assert.equal(parts.length, 3);
  assert.ok(parts.every((p) => p.length <= 1000));
  assert.ok(parts[2].endsWith('…'));
  assert.deepEqual(splitText('', 1000, 3), []);
  assert.deepEqual(splitText('짧다', 1000, 3), ['짧다']);
  assert.equal(splitText('y'.repeat(1500), 1000, 1)[0].length, 1000, '한 줄이 길면 잘라서라도 넣는다');
});

test('버튼 → 바로가기, 링크 버튼은 텍스트로', () => {
  const rows = characterButtons('블레상돈', ['정보', '군장']);
  assert.deepEqual(buttonsToQuickReplies(rows).quickReplies, [
    { label: '정보', action: 'message', messageText: '/정보 블레상돈' },
    { label: '군장', action: 'message', messageText: '/군장 블레상돈' },
  ]);
  assert.deepEqual(buttonsToQuickReplies(commandButtons([{ cmd: '체급', label: '원정대 체급' }])).quickReplies, [
    { label: '원정대 체급', action: 'message', messageText: '/체급' },
  ]);
  const link = [{ type: 1, components: [{ type: 2, style: 5, label: '공지', url: 'https://l.k/1' }] }];
  assert.deepEqual(buttonsToQuickReplies(link), { quickReplies: [], links: ['공지: https://l.k/1'] });
  assert.deepEqual(buttonsToQuickReplies(undefined), { quickReplies: [], links: [] });
});

test('공개 URL은 허용 폴더 2개만', () => {
  assert.equal(publicUrlFor('D:/OpenTalk/assets/emoticons/따봉.png', BASE), `${BASE}/assets/emoticons/${encodeURIComponent('따봉.png')}`);
  assert.equal(publicUrlFor('D:/OpenTalk/assets/charts/chembang.png', BASE), `${BASE}/assets/charts/chembang.png`);
  assert.equal(publicUrlFor('D:/OpenTalk/user-links.json', BASE), null);
  assert.equal(publicUrlFor('D:/OpenTalk/assets/emoticons/원본/x.png', BASE), null);
});

test('페이로드 → 카카오 응답', () => {
  const embed = new EmbedBuilder().setTitle('🛡️ 체방').setImage('attachment://chembang.png');
  const file = new AttachmentBuilder('D:/OpenTalk/assets/charts/chembang.png', { name: 'chembang.png' });
  const res = toKakaoResponse([{ embeds: [embed], files: [file], components: characterButtons('닉', ['정보']) }], { baseUrl: BASE });
  assert.equal(res.version, '2.0');
  assert.deepEqual(res.template.outputs, [
    { simpleText: { text: '🛡️ 체방' } },
    { simpleImage: { imageUrl: `${BASE}/assets/charts/chembang.png`, altText: 'chembang.png' } },
  ]);
  assert.deepEqual(res.template.quickReplies, [{ label: '정보', action: 'message', messageText: '/정보 닉' }]);

  const text = toKakaoResponse(['그냥 문자열', { content: '두 번째', flags: 64 }], { baseUrl: BASE });
  assert.deepEqual(text.template.outputs, [{ simpleText: { text: '그냥 문자열\n\n두 번째' } }]);
  assert.equal('quickReplies' in text.template, false);

  const emo = toKakaoResponse([{ files: ['D:/OpenTalk/assets/emoticons/따봉.png'] }], { baseUrl: BASE });
  assert.equal(emo.template.outputs.length, 1);
  assert.ok(emo.template.outputs[0].simpleImage);

  assert.deepEqual(toKakaoResponse([], { baseUrl: BASE }).template.outputs, [{ simpleText: { text: '(응답이 없어요)' } }]);
  assert.deepEqual(textResponse('안내', [{ label: 'a', action: 'message', messageText: '/a' }]).template.quickReplies.length, 1);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test "$SCRATCH/render.test.mjs"`
Expected: FAIL — `Cannot find module …/src/kakao/render.js`.

- [ ] **Step 3: 구현**

`src/kakao/render.js`:
```js
// 디스코드 응답 페이로드({ content, embeds, files, components }) → 카카오 오픈빌더 스킬 응답(v2.0).
// 카카오는 마크다운·고정폭 글꼴이 없어 임베드를 평문으로 펴고, 버튼은 바로가기(quickReplies)로,
// 첨부 이미지는 우리 서버가 공개 서빙하는 URL(simpleImage)로 바꾼다.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// 공개 서빙을 허용하는 폴더 — 이 둘의 직접 자식 파일만 URL이 나온다 (server.js의 라우트와 짝)
const PUBLIC_DIRS = {
  emoticons: path.join(ROOT, 'assets', 'emoticons'),
  charts: path.join(ROOT, 'assets', 'charts'),
};

const TEXT_MAX = 1000;     // simpleText 글자수 제한
const OUTPUTS_MAX = 3;     // outputs 개수 제한
const QUICK_MAX = 10;      // quickReplies 개수 제한
const LABEL_MAX = 14;      // quickReplies label 글자수 제한

export function stripMarkdown(text) {
  return String(text ?? '')
    .replace(/```[^\n]*\n?/g, '')                          // 코드블록 펜스 (언어 표기 포함)
    .replace(/\*\*|__|~~/g, '')
    .replace(/`/g, '')
    .replace(/^-# /gm, '')                                 // 작은 글씨
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 $2') // [텍스트](링크) → 텍스트 링크
    .replace(/<#\d+>|<@[!&]?\d+>/g, '')                    // 채널·유저·역할 멘션
    .replace(/[^\S\n]{2,}/g, ' ')                          // 표 정렬용 연속 공백 → 한 칸 (줄바꿈은 유지)
    .replace(/^[^\S\n]+|[^\S\n]+$/gm, '')                  // 줄 앞뒤 공백
    .trim();
}

const asJson = (builder) => (builder?.toJSON ? builder.toJSON() : builder?.data ?? builder ?? {});
const isBlankName = (name) => !String(name ?? '').replace(/[\u200b\s]/g, '');

// 임베드 → 평문: 제목 → 설명 → 필드(▸ 이름 / 값) → 외부 이미지 URL → 푸터. 썸네일은 장식이라 뺀다.
export function embedToText(embed) {
  const e = asJson(embed);
  const lines = [];
  if (e.author?.name) lines.push(e.author.name);
  if (e.title) lines.push(e.title);
  if (e.url) lines.push(e.url);
  if (e.description) lines.push(e.description);
  for (const field of e.fields ?? []) {
    lines.push('');
    if (!isBlankName(field.name)) lines.push(`▸ ${field.name}`);
    lines.push(field.value);
  }
  if (e.image?.url && !e.image.url.startsWith('attachment://')) lines.push(e.image.url);
  if (e.footer?.text) lines.push('', e.footer.text);
  return stripMarkdown(lines.join('\n'));
}

// 줄 단위로 max자 이하 조각을 만든다. parts개를 넘기면 마지막 조각 끝을 …로 자른다.
export function splitText(text, max = TEXT_MAX, parts = OUTPUTS_MAX) {
  const chunks = [];
  let current = '';
  const push = () => { if (current) chunks.push(current); current = ''; };
  for (const line of String(text ?? '').split('\n')) {
    let piece = line;
    while (piece.length > max) {           // 한 줄이 제한보다 길면 강제로 자른다
      push();
      chunks.push(piece.slice(0, max));
      piece = piece.slice(max);
    }
    if (current.length + piece.length + (current ? 1 : 0) > max) push();
    current = current ? `${current}\n${piece}` : piece;
  }
  push();
  if (chunks.length <= parts) return chunks;
  const kept = chunks.slice(0, parts);
  const last = kept[parts - 1];
  kept[parts - 1] = `${last.slice(0, max - 1).trimEnd()}…`;
  return kept;
}

// 디스코드 버튼 → 카카오 바로가기. run:커맨드:닉네임 → "/커맨드 닉네임", cmd:커맨드 → "/커맨드".
// 링크 버튼은 바로가기로 못 만들어 "라벨: URL" 문자열로 돌려준다(본문 끝에 붙임).
export function buttonsToQuickReplies(rows = []) {
  const quickReplies = [];
  const links = [];
  for (const row of rows ?? []) {
    for (const c of asJson(row).components ?? []) {
      const label = String(c.label ?? '').slice(0, LABEL_MAX);
      if (c.url) { links.push(`${c.label ?? '링크'}: ${c.url}`); continue; }
      const [tag, cmd, nick] = String(c.custom_id ?? c.customId ?? '').split(':');
      if (!cmd || (tag !== 'run' && tag !== 'cmd')) continue;
      const messageText = tag === 'run' && nick ? `/${cmd} ${nick}` : `/${cmd}`;
      quickReplies.push({ label: label || cmd, action: 'message', messageText });
    }
  }
  return { quickReplies: quickReplies.slice(0, QUICK_MAX), links };
}

// 첨부 파일 경로 → 공개 URL. 허용 폴더의 직접 자식이 아니면 null.
export function publicUrlFor(filePath, baseUrl) {
  if (typeof filePath !== 'string') return null;
  const abs = path.resolve(filePath);
  for (const [key, dir] of Object.entries(PUBLIC_DIRS)) {
    if (path.dirname(abs) === dir) return `${baseUrl}/assets/${key}/${encodeURIComponent(path.basename(abs))}`;
  }
  return null;
}

export function textResponse(text, quickReplies = []) {
  const template = { outputs: splitText(text).map((t) => ({ simpleText: { text: t } })) };
  if (quickReplies.length > 0) template.quickReplies = quickReplies.slice(0, QUICK_MAX);
  return { version: '2.0', template };
}

// reply()/editReply()에 넘겼던 페이로드 목록을 하나의 카카오 응답으로. 텍스트가 앞, 이미지가 뒤.
export function toKakaoResponse(payloads, { baseUrl }) {
  const texts = [];
  const images = [];
  const links = [];
  let quickReplies = [];
  for (const raw of payloads ?? []) {
    const p = typeof raw === 'string' ? { content: raw } : raw ?? {};
    if (p.content) texts.push(stripMarkdown(p.content));
    for (const embed of p.embeds ?? []) {
      const text = embedToText(embed);
      if (text) texts.push(text);
    }
    for (const file of p.files ?? []) {
      const filePath = typeof file === 'string' ? file : file?.attachment;
      const url = publicUrlFor(filePath, baseUrl);
      if (url) images.push({ simpleImage: { imageUrl: url, altText: path.basename(filePath).slice(0, 50) } });
    }
    const buttons = buttonsToQuickReplies(p.components);
    quickReplies = quickReplies.concat(buttons.quickReplies);
    links.push(...buttons.links);
  }
  if (links.length > 0) texts.push(links.map((l) => `🔗 ${l}`).join('\n'));

  const textParts = Math.max(1, OUTPUTS_MAX - Math.min(images.length, OUTPUTS_MAX - 1));
  const outputs = [
    ...splitText(texts.filter(Boolean).join('\n\n'), TEXT_MAX, textParts).map((t) => ({ simpleText: { text: t } })),
    ...images,
  ].slice(0, OUTPUTS_MAX);
  if (outputs.length === 0) outputs.push({ simpleText: { text: '(응답이 없어요)' } });

  const template = { outputs };
  if (quickReplies.length > 0) template.quickReplies = quickReplies.slice(0, QUICK_MAX);
  return { version: '2.0', template };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test "$SCRATCH/render.test.mjs"`
Expected: `# pass 6` `# fail 0`. (`stripMarkdown` 테스트의 `'<#123> 채널에서 <@456> 님'` → 멘션 제거 후 앞 공백은 줄 앞 공백 규칙으로 사라져 `채널에서 님`.)

- [ ] **Step 5: 커밋**

```bash
git add src/kakao/render.js
git commit -m "카카오 응답 변환기 — 임베드→평문, 버튼→바로가기, 첨부→공개 URL"
```

---

### Task 3: `KakaoInteraction` 어댑터 + 카카오용 `/등록`

**Files:**
- Create: `src/kakao/interaction.js`
- Modify: `src/commands/register.js` (`execute` 시작부에 분기, 하단에 `executeKakao` 추가)
- Test: `$SCRATCH/interaction.test.mjs`

**Interfaces:**
- Produces: `class KakaoInteraction(userKey, options)` — 필드 `platform = 'kakao'`, `user = { id: 'kakao:<userKey>' }`,
  `member = guild = channel = null`, `guildId = channelId = null`, `deferred`, `replied`, `payloads: []`,
  `options.getString/getInteger/getNumber/getBoolean/getChannel/getSubcommand`, 메서드 `deferReply()`, `reply(p)`,
  `editReply(p)`, `followUp(p)`.
  수집 규칙: `reply`/`editReply`는 마지막 페이로드를 **교체**(defer 후 editReply가 최종), `followUp`은 **추가**.
- Consumes: `user-store.js`의 `getLinkedCharacter/linkCharacter/unlinkCharacter`, `lostark.js`의 `getCharacterProfile`(실 API),
  `format.js`의 `NOT_FOUND_HINT`.

- [ ] **Step 1: 실패하는 테스트 작성**

`$SCRATCH/interaction.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KakaoInteraction } from 'file:///D:/OpenTalk/src/kakao/interaction.js';

test('옵션·식별 정보', () => {
  const it = new KakaoInteraction('abc123', { 닉네임: '블레상돈', 가격: 4000 });
  assert.equal(it.platform, 'kakao');
  assert.equal(it.user.id, 'kakao:abc123');
  assert.equal(it.member, null);
  assert.equal(it.options.getString('닉네임'), '블레상돈');
  assert.equal(it.options.getInteger('가격'), 4000);
  assert.equal(it.options.getString('없음'), null);
  assert.equal(it.options.getChannel('채널'), null);
  assert.equal(it.options.getSubcommand(), undefined);
});

test('reply/editReply는 교체, followUp은 추가', async () => {
  const it = new KakaoInteraction('abc123', {});
  await it.deferReply();
  assert.equal(it.deferred, true);
  await it.editReply('첫 번째');
  await it.editReply({ content: '최종' });
  await it.followUp('추가');
  assert.deepEqual(it.payloads, [{ content: '최종' }, '추가']);
  assert.equal(it.replied, true);
});

test('reply 후 editReply도 교체', async () => {
  const it = new KakaoInteraction('k', {});
  await it.reply('A');
  await it.editReply('B');
  assert.deepEqual(it.payloads, ['B']);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test "$SCRATCH/interaction.test.mjs"`
Expected: FAIL — `Cannot find module …/src/kakao/interaction.js`.

- [ ] **Step 3: 어댑터 구현**

`src/kakao/interaction.js`:
```js
// 카카오 스킬 요청을 슬래시 인터랙션처럼 보이게 하는 어댑터 (text-commands.js의 TextInteraction과 같은 역할).
// 커맨드가 reply/editReply로 보낸 페이로드를 모아 두고, handler가 한 번에 카카오 응답으로 바꾼다.
export class KakaoInteraction {
  constructor(userKey, options = {}) {
    this.platform = 'kakao';
    // 카카오 사용자 키에 접두사를 붙여 user-links.json에 디스코드 ID와 함께 저장한다.
    // 랭킹 집계는 스노플레이크만 골라 쓰므로 섞여도 영향이 없다.
    this.user = { id: `kakao:${userKey}` };
    this.member = null;   // 디스코드 닉네임 폴백이 없으므로 등록 안 한 사용자는 닉네임을 직접 적어야 한다
    this.guild = null;
    this.channel = null;
    this.guildId = null;
    this.channelId = null;
    this.deferred = false;
    this.replied = false;
    this.payloads = [];
    this.options = {
      getString: (name) => options[name] ?? null,
      getInteger: (name) => options[name] ?? null,
      getNumber: (name) => options[name] ?? null,
      getBoolean: (name) => options[name] ?? null,
      getChannel: () => null,
      getSubcommand: () => options.__sub,
    };
  }
  async deferReply() {
    this.deferred = true;
  }
  // reply와 editReply는 "지금까지의 답을 이것으로" — 마지막 것만 남긴다 (defer → editReply 흐름의 최종본)
  async reply(payload) {
    this.replied = true;
    this.#replace(payload);
  }
  async editReply(payload) {
    this.replied = true;
    this.#replace(payload);
  }
  async followUp(payload) {
    this.payloads.push(payload);
  }
  #replace(payload) {
    if (this.payloads.length === 0) this.payloads.push(payload);
    else this.payloads[0] = payload;
  }
}
```

- [ ] **Step 4: 어댑터 테스트 통과 확인**

Run: `node --test "$SCRATCH/interaction.test.mjs"`
Expected: `# pass 3` `# fail 0`.

- [ ] **Step 5: `register.js`에 카카오 분기 추가**

`src/commands/register.js` — import에 `NOT_FOUND_HINT` 추가:
```js
import { EMBED_COLOR, NOT_FOUND_HINT } from '../format.js';
```
`execute` 시작부, `userId` 확인 직후에 분기:
```js
export async function execute(interaction) {
  const userId = interaction.user?.id;
  if (!userId) {
    await interaction.reply('유저 정보를 확인할 수 없어요.');
    return;
  }

  // 카카오톡은 사용자 닉네임을 주지 않으므로 캐릭터명을 직접 받는다 (1:1 채팅이라 남의 캐릭터를 넣어도 본인 기본값만 바뀜)
  if (interaction.platform === 'kakao') {
    await executeKakao(interaction, userId);
    return;
  }

  if (interaction.options.getBoolean('해제')) {
```
파일 끝에 추가:
```js
// 카카오톡: "/등록 캐릭터명" · "/등록 해제"
async function executeKakao(interaction, userId) {
  const typed = interaction.options.getString('닉네임')?.trim();
  if (!typed) {
    await interaction.reply('사용법: /등록 캐릭터명 (해제는 /등록 해제)');
    return;
  }
  if (typed === '해제') {
    const had = unlinkCharacter(userId);
    await interaction.reply(had ? '캐릭터 등록을 해제했어요.' : '등록된 캐릭터가 없어요.');
    return;
  }

  const profile = await findFirstProfile([typed]);
  if (!profile) {
    await interaction.reply(`\`${typed}\` — ${NOT_FOUND_HINT}`);
    return;
  }

  const previous = getLinkedCharacter(userId);
  linkCharacter(userId, profile.CharacterName);

  const lines = [`${profile.ServerName} · ${profile.CharacterClassName} · ${profile.ItemAvgLevel}`];
  if (previous && previous !== profile.CharacterName) lines.push(`(이전 등록: ${previous})`);
  lines.push('', '이제 /정보 /군장 /주급 등을 닉네임 없이 쓸 수 있어요!');

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`✅ ${profile.CharacterName} 등록 완료`)
    .setDescription(lines.join('\n'));
  await interaction.reply({ embeds: [embed] });
}
```

- [ ] **Step 6: 카카오 등록 흐름을 실 API로 확인 (스크래치, `.env`의 LOSTARK_API_KEY 사용)**

`$SCRATCH/register-kakao.mjs`:
```js
import { KakaoInteraction } from 'file:///D:/OpenTalk/src/kakao/interaction.js';
import { toKakaoResponse } from 'file:///D:/OpenTalk/src/kakao/render.js';
import * as register from 'file:///D:/OpenTalk/src/commands/register.js';
import { getLinkedCharacter } from 'file:///D:/OpenTalk/src/user-store.js';

const run = async (options) => {
  const it = new KakaoInteraction('testkey', options);
  await register.execute(it);
  console.log(JSON.stringify(toKakaoResponse(it.payloads, { baseUrl: 'http://x' }).template.outputs[0].simpleText.text));
};
await run({ 닉네임: null });          // 사용법
await run({ 닉네임: '블레상돈' });     // 등록 완료
console.log('저장됨:', getLinkedCharacter('kakao:testkey'));
await run({ 닉네임: '해제' });         // 해제
console.log('해제 후:', getLinkedCharacter('kakao:testkey'));
await run({ 닉네임: '없는캐릭명임12345' }); // NOT_FOUND_HINT
```
Run: `node --env-file=.env "$SCRATCH/register-kakao.mjs"`
Expected 순서: `"사용법: /등록 캐릭터명 (해제는 /등록 해제)"` → `"✅ 블레상돈 등록 완료\n루페온 · 블레이드 · …"` → `저장됨: 블레상돈` →
`"캐릭터 등록을 해제했어요."` → `해제 후: null` → `"없는캐릭명임12345 — 캐릭터를 찾을 수 없어요. …"`.
마지막으로 `user-links.json`에 `kakao:testkey`가 남아 있지 않은지 확인: `grep -c kakao: user-links.json` → `0`.

- [ ] **Step 7: 디스코드 등록 흐름 불변 확인**

Run: `node --input-type=module -e "import('./src/commands/register.js').then(m => console.log(typeof m.execute, m.data.name))"`
Expected: `function 등록`.

- [ ] **Step 8: 커밋**

```bash
git add src/kakao/interaction.js src/commands/register.js
git commit -m "카카오 인터랙션 어댑터 · 카카오에서는 /등록 닉네임으로 직접 등록"
```

---

### Task 4: 요청 처리기 `handler.js` — 매칭·4.5초 예산·보류 캐시·콜백

**Files:**
- Create: `src/kakao/handler.js`
- Test: `$SCRATCH/handler.test.mjs`

**Interfaces:**
- Produces: `handleSkillRequest(body, commandMap, { baseUrl, budgetMs = 4500, fetchImpl = fetch }) → Promise<카카오 응답>`.
  `body`는 오픈빌더 요청 JSON(`userRequest.utterance`, `userRequest.user.id`, `userRequest.callbackUrl`).
- Produces: 상수 `KAKAO_EXCLUDED = new Set(['알림설정', '랭킹', '체급'])`, `KAKAO_MATCH_OPTIONS = { prefixes: ['/'], bareChosung: false, anyCommand: true }`.
- Consumes: Task 1 `matchTextCommand`, Task 2 `toKakaoResponse`·`textResponse`, Task 3 `KakaoInteraction`,
  `emoticons.js`의 `parseEmoticonKeyword`·`findEmoticonFile`.

- [ ] **Step 1: 실패하는 테스트 작성**

`$SCRATCH/handler.test.mjs`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSkillRequest } from 'file:///D:/OpenTalk/src/kakao/handler.js';

const BASE = 'http://x';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cmd = (name, execute, options = []) => ({
  data: { name, toJSON: () => ({ name, options }) },
  execute,
});
const body = (utterance, extra = {}) => ({
  userRequest: { utterance, user: { id: 'user1', type: 'botUserKey' }, ...extra },
});
const firstText = (res) => res.template.outputs[0].simpleText?.text;

const commandMap = new Map([
  ['모험섬', cmd('모험섬', async (it) => { await it.deferReply(); await it.editReply({ content: '오늘의 섬 **A**' }); })],
  ['장비', cmd('장비', async (it) => { await it.reply(`장비 of ${it.options.getString('닉네임')} by ${it.user.id}`); },
    [{ name: '닉네임', type: 3, required: false }])],
  ['느림', cmd('느림', async (it) => { await sleep(700); await it.reply('느린 결과'); })],
  ['터짐', cmd('터짐', async () => { throw new Error('API 503'); })],
  ['랭킹', cmd('랭킹', async (it) => { await it.reply('랭킹 나오면 안 됨'); })],
  ['도움말', cmd('도움말', async (it) => { await it.reply('도움말 본문'); })],
]);
const opts = { baseUrl: BASE, budgetMs: 300 };

test('/커맨드 형식만 실행, 아니면 안내', async () => {
  assert.equal(firstText(await handleSkillRequest(body('/모험섬'), commandMap, opts)), '오늘의 섬 A');
  assert.equal(firstText(await handleSkillRequest(body('/장비 블레상돈'), commandMap, opts)), '장비 of 블레상돈 by kakao:user1');
  const guide = await handleSkillRequest(body('모험섬'), commandMap, opts);
  assert.match(firstText(guide), /^명령은 \/로 시작해요/);
  assert.ok(guide.template.quickReplies.length >= 3);
  assert.match(firstText(await handleSkillRequest(body('/없는거'), commandMap, opts)), /^명령은 \/로 시작해요/);
  assert.match(firstText(await handleSkillRequest(body(''), commandMap, opts)), /^명령은 \/로 시작해요/);
});

test('제외 커맨드·오류·도움말 덧말', async () => {
  assert.equal(firstText(await handleSkillRequest(body('/랭킹'), commandMap, opts)), '이 커맨드는 디스코드에서만 쓸 수 있어요.');
  assert.equal(firstText(await handleSkillRequest(body('/터짐'), commandMap, opts)), '오류가 발생했어요: API 503');
  assert.match(firstText(await handleSkillRequest(body('/도움말'), commandMap, opts)), /도움말 본문\n\n.*카카오톡에서는 \/커맨드 형식만/s);
});

test('이모티콘: 없는 키워드 안내', async () => {
  assert.equal(firstText(await handleSkillRequest(body('[절대없는이모티콘'), commandMap, opts)),
    "'절대없는이모티콘' 이모티콘이 없어요. /이모티콘 으로 목록을 볼 수 있어요.");
});

test('예산 초과 + 콜백 없음 → 보류 안내, 다시 물으면 결과', async () => {
  const first = await handleSkillRequest(body('/느림'), commandMap, opts);
  assert.equal(firstText(first), '⏳ 조회에 시간이 걸려요. 잠시 후 같은 명령을 다시 보내 주세요.');
  await sleep(600);
  const second = await handleSkillRequest(body('/느림'), commandMap, opts);
  assert.equal(firstText(second), '느린 결과');
  assert.equal(firstText(await handleSkillRequest(body('/느림'), commandMap, opts)),
    '⏳ 조회에 시간이 걸려요. 잠시 후 같은 명령을 다시 보내 주세요.', '결과를 준 뒤엔 새로 실행한다');
});

test('예산 초과 + 콜백 있음 → useCallback 후 콜백 URL로 POST', async () => {
  const posted = [];
  const fetchImpl = async (url, init) => { posted.push({ url, body: JSON.parse(init.body) }); return { ok: true }; };
  // 앞 테스트가 같은 사용자·발화의 결과를 보류 캐시에 남겼으므로 다른 사용자로 보낸다
  const res = await handleSkillRequest(body('/느림', { callbackUrl: 'https://cb.kakao/1', user: { id: 'user2' } }), commandMap,
    { ...opts, fetchImpl });
  assert.deepEqual(res, { version: '2.0', useCallback: true, data: { text: '⏳ 조회 중이에요…' } });
  await sleep(600);
  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, 'https://cb.kakao/1');
  assert.equal(posted[0].body.template.outputs[0].simpleText.text, '느린 결과');
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test "$SCRATCH/handler.test.mjs"`
Expected: FAIL — `Cannot find module …/src/kakao/handler.js`.

- [ ] **Step 3: 구현**

`src/kakao/handler.js`:
```js
// 카카오 오픈빌더 스킬 요청 하나를 처리한다: 발화 → 커맨드 → 실행 → 카카오 응답.
// 카카오는 5초 안에 응답하지 않으면 실패로 보므로 4.5초 예산으로 기다리고, 넘기면
//   · 콜백이 승인된 봇(요청에 callbackUrl)이면 "조회 중" 즉시 응답 후 결과를 콜백 URL로 POST
//   · 아니면 "다시 보내 주세요" 안내 후 실행은 계속 → 결과를 3분 보관 → 같은 발화가 오면 즉시 응답
import { matchTextCommand } from '../text-commands.js';
import { parseEmoticonKeyword, findEmoticonFile } from '../emoticons.js';
import { KakaoInteraction } from './interaction.js';
import { toKakaoResponse, textResponse } from './render.js';

export const KAKAO_MATCH_OPTIONS = { prefixes: ['/'], bareChosung: false, anyCommand: true };
// 디스코드 서버(채널·멤버) 개념이 필요한 커맨드 — 별칭(ㄹㅋ·ㅊㄱ)은 대상 이름으로 풀린 뒤 걸린다
export const KAKAO_EXCLUDED = new Set(['알림설정', '랭킹', '체급']);

const DEFAULT_BUDGET_MS = 4500;
const PENDING_TTL_MS = 3 * 60 * 1000;
const TIMEOUT = Symbol('timeout');

const GUIDE = '명령은 /로 시작해요. 예: /정보 닉네임 · /ㅂㅂㄱ 4000 · /도움말';
const GUIDE_REPLIES = [['도움말', '/도움말'], ['모험섬', '/모험섬'], ['가토', '/가토'], ['업데이트', '/업데이트'], ['유각', '/유각']]
  .map(([label, messageText]) => ({ label, action: 'message', messageText }));
const HELP_NOTE = '💬 카카오톡에서는 /커맨드 형식만 돼요 (예: /정보 닉네임, /ㅂㅂㄱ 4000, /등록 캐릭터명). '
  + '랭킹·체급·알림설정은 디스코드 전용이에요.';
const WAIT_RETRY = '⏳ 조회에 시간이 걸려요. 잠시 후 같은 명령을 다시 보내 주세요.';
const WAIT_CALLBACK = '⏳ 조회 중이에요…';

// (사용자, 발화) → 실행 중이거나 끝난 응답 Promise. 예산을 넘긴 요청의 결과를 재요청에 돌려주기 위한 것.
const pending = new Map();

const normalize = (utterance) => utterance.trim().replace(/\s+/g, ' ');
const shortKey = (key) => `${String(key).slice(0, 8)}…`;
const guideResponse = () => textResponse(GUIDE, GUIDE_REPLIES);

// 발화 하나를 끝까지 실행해 카카오 응답을 만든다 (예산과 무관)
async function runUtterance(utterance, userKey, commandMap, baseUrl) {
  const keyword = parseEmoticonKeyword(utterance);
  if (keyword) {
    const file = findEmoticonFile(keyword);
    return file
      ? toKakaoResponse([{ files: [file] }], { baseUrl })
      : textResponse(`'${keyword}' 이모티콘이 없어요. /이모티콘 으로 목록을 볼 수 있어요.`);
  }
  if (!utterance.startsWith('/')) return guideResponse();

  const match = matchTextCommand(utterance, commandMap, KAKAO_MATCH_OPTIONS);
  if (!match) return guideResponse();
  if (match.usage) return textResponse(`사용법: ${match.usage}`);
  const name = match.command.data.name;
  if (KAKAO_EXCLUDED.has(name)) return textResponse('이 커맨드는 디스코드에서만 쓸 수 있어요.');

  const interaction = new KakaoInteraction(userKey, match.options);
  try {
    await match.command.execute(interaction);
  } catch (err) {
    console.error(`[카카오 ${match.label}]`, err);
    return textResponse(`오류가 발생했어요: ${err.message}`);
  }
  if (name === '도움말') interaction.payloads.push({ content: HELP_NOTE });
  return toKakaoResponse(interaction.payloads, { baseUrl });
}

const withTimeout = (promise, ms) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(resolve, ms, TIMEOUT).unref?.()),
]);

async function postCallback(callbackUrl, response, fetchImpl) {
  try {
    const res = await fetchImpl(callbackUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    });
    if (!res.ok) console.error(`[카카오 콜백] HTTP ${res.status}`);
  } catch (err) {
    console.error('[카카오 콜백]', err.message);
  }
}

export async function handleSkillRequest(body, commandMap, { baseUrl, budgetMs = DEFAULT_BUDGET_MS, fetchImpl = fetch } = {}) {
  const utterance = normalize(String(body?.userRequest?.utterance ?? ''));
  const userKey = body?.userRequest?.user?.id;
  const callbackUrl = body?.userRequest?.callbackUrl;
  if (!utterance || !userKey) return guideResponse();

  const started = Date.now();
  const key = `${userKey}\n${utterance}`;
  let task = pending.get(key);
  if (!task) {
    task = runUtterance(utterance, userKey, commandMap, baseUrl);
    pending.set(key, task);
    // 결과를 아무도 안 가져가도 3분 뒤엔 지운다
    task.finally(() => setTimeout(() => { if (pending.get(key) === task) pending.delete(key); }, PENDING_TTL_MS).unref?.());
  }

  const result = await withTimeout(task, budgetMs);
  const elapsed = `${((Date.now() - started) / 1000).toFixed(1)}s`;
  if (result !== TIMEOUT) {
    pending.delete(key);
    console.log(`[카카오] ${shortKey(userKey)} "${utterance}" ${elapsed}`);
    return result;
  }
  if (callbackUrl) {
    console.log(`[카카오] ${shortKey(userKey)} "${utterance}" ${elapsed} (콜백)`);
    task.then((response) => postCallback(callbackUrl, response, fetchImpl)).finally(() => pending.delete(key));
    return { version: '2.0', useCallback: true, data: { text: WAIT_CALLBACK } };
  }
  console.log(`[카카오] ${shortKey(userKey)} "${utterance}" ${elapsed} (보류)`);
  return textResponse(WAIT_RETRY);
}
```

`runUtterance`는 절대 reject하지 않는다(내부에서 잡음). 그래야 `pending`에 실패 Promise가 남지 않는다.

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test "$SCRATCH/handler.test.mjs"`
Expected: `# pass 5` `# fail 0`. 콘솔에 `[카카오] user1… "/느림" 0.3s (보류)` 같은 로그가 섞여 나온다.

- [ ] **Step 5: 커밋**

```bash
git add src/kakao/handler.js
git commit -m "카카오 요청 처리기 — /커맨드 매칭, 4.5초 예산, 보류 캐시, 콜백"
```

---

### Task 5: HTTP 서버 `server.js` + `index.js` 연결 + `.env.example`

**Files:**
- Create: `src/kakao/server.js`
- Modify: `src/index.js:1-8` (import), `src/index.js:55-60` (`ClientReady`)
- Modify: `.env.example` (끝에 추가)
- Test: `$SCRATCH/server.test.mjs`

**Interfaces:**
- Produces: `startKakaoServer(commandMap, env = process.env) → http.Server | null`. `env.KAKAO_PORT` 없으면 `null`(로그만).
  `KAKAO_SKILL_SECRET`·`PUBLIC_BASE_URL` 없으면 오류 로그 후 `null`.
  라우트: `GET /health` → `200 ok` · `GET /assets/(emoticons|charts)/<파일>` → 이미지 · `POST /kakao/skill/<secret>` → 스킬 응답 ·
  그 외 404 · JSON 아님 400 · 1MB 초과 413.
- Consumes: Task 4 `handleSkillRequest`, Task 2 `textResponse`.

- [ ] **Step 1: 실패하는 테스트 작성**

`$SCRATCH/server.test.mjs`:
```js
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { startKakaoServer } from 'file:///D:/OpenTalk/src/kakao/server.js';

const PORT = 18081;
const BASE = `http://127.0.0.1:${PORT}`;
const commandMap = new Map([[
  '모험섬', { data: { name: '모험섬', toJSON: () => ({ name: '모험섬', options: [] }) }, execute: async (it) => it.reply('섬!') },
]]);
const server = startKakaoServer(commandMap, { KAKAO_PORT: String(PORT), KAKAO_SKILL_SECRET: 's3cret', PUBLIC_BASE_URL: `${BASE}/` });
after(() => { server.closeAllConnections(); server.close(); }); // keep-alive 연결 때문에 close()만으로는 안 끝난다
await new Promise((r) => server.once('listening', r));

const skill = (utterance, secret = 's3cret', raw) => fetch(`${BASE}/kakao/skill/${secret}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: raw ?? JSON.stringify({ userRequest: { utterance, user: { id: 'u1' } } }),
});

test('KAKAO_PORT 없으면 안 켬', () => {
  assert.equal(startKakaoServer(commandMap, {}), null);
  assert.equal(startKakaoServer(commandMap, { KAKAO_PORT: '1' }), null, '비밀·베이스 URL 없으면 안 켬');
});

test('health · 404', async () => {
  assert.equal(await (await fetch(`${BASE}/health`)).text(), 'ok');
  assert.equal((await fetch(`${BASE}/nope`)).status, 404);
  assert.equal((await fetch(`${BASE}/kakao/skill/s3cret`)).status, 404, 'GET은 404');
});

test('스킬 요청', async () => {
  const res = await skill('/모험섬');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/json/);
  const json = await res.json();
  assert.equal(json.template.outputs[0].simpleText.text, '섬!');
  assert.equal((await skill('/모험섬', 'wrong')).status, 404);
  assert.equal((await skill(null, 's3cret', '{not json')).status, 400);
  assert.equal((await skill(null, 's3cret', 'x'.repeat(1024 * 1024 + 1))).status, 413);
});

test('정적 파일: 허용 폴더 직접 자식만', async () => {
  const ok = await fetch(`${BASE}/assets/charts/chembang.png`);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'image/png');
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=86400');
  assert.equal((await fetch(`${BASE}/assets/charts/..%2F..%2Fpackage.json`)).status, 404);
  assert.equal((await fetch(`${BASE}/assets/charts/nothing.png`)).status, 404);
  assert.equal((await fetch(`${BASE}/assets/other/x.png`)).status, 404);
  assert.equal((await fetch(`${BASE}/assets/emoticons/${encodeURIComponent('원본')}/x.png`)).status, 404);
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test "$SCRATCH/server.test.mjs"`
Expected: FAIL — `Cannot find module …/src/kakao/server.js`.

- [ ] **Step 3: 서버 구현**

`src/kakao/server.js`:
```js
// 카카오 오픈빌더 스킬 서버. 디스코드 봇과 같은 프로세스에서 KAKAO_PORT가 있을 때만 켜진다.
//   POST /kakao/skill/<KAKAO_SKILL_SECRET>  스킬 요청 (항상 200 + JSON — 오류도 문구로)
//   GET  /health                            ok
//   GET  /assets/emoticons/<파일> · /assets/charts/<파일>  이미지 공개 서빙 (두 폴더의 직접 자식만)
// 웹서버의 예외는 여기서 전부 잡아 디스코드 클라이언트에 영향을 주지 않는다.
import { createServer } from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleSkillRequest } from './handler.js';
import { textResponse } from './render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIRS = {
  emoticons: path.join(ROOT, 'assets', 'emoticons'),
  charts: path.join(ROOT, 'assets', 'charts'),
};
const CONTENT_TYPES = { '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_BODY = 1024 * 1024;
const TOO_LARGE = Symbol('too large');

function sendText(res, status, text) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}
function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// 본문을 읽어 JSON으로. 1MB 초과면 TOO_LARGE, JSON이 아니면 undefined.
function readJson(req) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        // 더 모으지 않고 나머지는 흘려보낸다 — 끊어 버리면 클라이언트가 413을 못 받는다
        req.removeAllListeners('data');
        req.resume();
        resolve(TOO_LARGE);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { resolve(undefined); }
    });
    req.on('error', () => resolve(undefined));
  });
}

async function serveAsset(res, dir, rawName) {
  let name;
  try { name = decodeURIComponent(rawName); } catch { return sendText(res, 404, 'not found'); }
  // 파일명 하나만 — 경로 구분자·상위 이동·숨김 파일은 거절
  if (!name || name !== path.basename(name) || name.startsWith('.')) return sendText(res, 404, 'not found');
  const type = CONTENT_TYPES[path.extname(name).toLowerCase()];
  if (!type) return sendText(res, 404, 'not found');
  let real;
  let stat;
  try {
    real = await fs.realpath(path.join(dir, name));
    stat = await fs.stat(real);
  } catch { return sendText(res, 404, 'not found'); }
  // 심볼릭 링크로 폴더 밖을 가리키는 것도 거절
  if (!stat.isFile() || path.dirname(real) !== await fs.realpath(dir)) return sendText(res, 404, 'not found');
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=86400' });
  createReadStream(real).pipe(res);
}

async function route(req, res, { commandMap, secret, baseUrl }) {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') return sendText(res, 200, 'ok');

  const asset = /^\/assets\/(emoticons|charts)\/([^/]+)$/.exec(url.pathname);
  if (req.method === 'GET' && asset) return serveAsset(res, PUBLIC_DIRS[asset[1]], asset[2]);

  if (req.method === 'POST' && url.pathname === `/kakao/skill/${secret}`) {
    const body = await readJson(req);
    if (body === TOO_LARGE) return sendText(res, 413, 'payload too large');
    if (body === undefined || typeof body !== 'object') return sendText(res, 400, 'invalid json');
    const response = await handleSkillRequest(body, commandMap, { baseUrl });
    return sendJson(res, 200, response);
  }
  return sendText(res, 404, 'not found');
}

export function startKakaoServer(commandMap, env = process.env) {
  const port = Number(env.KAKAO_PORT);
  if (!port) {
    console.log('카카오 스킬 서버: 꺼짐(KAKAO_PORT 없음)');
    return null;
  }
  const secret = env.KAKAO_SKILL_SECRET;
  const baseUrl = String(env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '');
  if (!secret || !baseUrl) {
    console.error('카카오 스킬 서버: KAKAO_SKILL_SECRET과 PUBLIC_BASE_URL이 필요해요 — 켜지 않음');
    return null;
  }

  const server = createServer((req, res) => {
    route(req, res, { commandMap, secret, baseUrl }).catch((err) => {
      console.error('[카카오 서버]', err);
      if (!res.headersSent) sendJson(res, 200, textResponse(`오류가 발생했어요: ${err.message}`));
      else res.end();
    });
  });
  server.on('error', (err) => console.error('카카오 스킬 서버 오류:', err.message));
  server.listen(port, () => console.log(`카카오 스킬 서버: :${port} (이미지 ${baseUrl})`));
  return server;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `node --test "$SCRATCH/server.test.mjs"`
Expected: `# pass 4` `# fail 0`. (413은 본문을 끊지 않고 흘려보내므로 클라이언트가 상태 코드를 정상적으로 받는다.)

- [ ] **Step 5: `index.js` 연결**

`src/index.js` import 블록에 추가(7행 `handleButton` import 다음):
```js
import { startKakaoServer } from './kakao/server.js';
```
`ClientReady` 핸들러를:
```js
client.once(Events.ClientReady, async (readyClient) => {
  console.log(`로그인 완료: ${readyClient.user.tag} (커맨드 ${commandMap.size}개, 이모티콘 ${countEmoticons()}개)`);
  await loadChannelRestrictions(readyClient);
  startIslandNotifier(readyClient);
  startUpdateNotifier(readyClient);
  startKakaoServer(commandMap); // KAKAO_PORT가 있을 때만 켜진다
});
```

- [ ] **Step 6: `.env.example`에 추가**

파일 끝에:
```
# (선택) 카카오톡 채널 챗봇(오픈빌더 스킬 서버). 세 값이 모두 있어야 켜진다. 비우면 디스코드만 동작.
# KAKAO_PORT         — 스킬 서버 포트 (운영은 8080, 80→8080 리다이렉트)
# KAKAO_SKILL_SECRET — 스킬 URL의 비밀 경로 (영숫자 32자 이상 무작위). 스킬 URL = PUBLIC_BASE_URL/kakao/skill/<이 값>
# PUBLIC_BASE_URL    — 이미지 URL 앞부분. 끝 슬래시 없이 (예: http://공인IP)
# KAKAO_PORT=8080
# KAKAO_SKILL_SECRET=무작위문자열
# PUBLIC_BASE_URL=http://서버주소
```

- [ ] **Step 7: 봇이 카카오 없이도 그대로 뜨는지 확인 (dev 봇, KAKAO_PORT 미설정)**

Run(PowerShell, 15초 뒤 종료): `Start-Process -NoNewWindow node -ArgumentList '--env-file=.env.dev','src/index.js' -RedirectStandardOutput "$env:TEMP\dev.log"; Start-Sleep 15; Get-Content "$env:TEMP\dev.log"; Get-Process node | Where-Object { $_.CommandLine -like '*env.dev*' } | Stop-Process`
Expected 로그에 `로그인 완료: …` 와 `카카오 스킬 서버: 꺼짐(KAKAO_PORT 없음)` 둘 다 있고 오류 없음.

- [ ] **Step 8: 커밋**

```bash
git add src/kakao/server.js src/index.js .env.example
git commit -m "카카오 스킬 HTTP 서버 — 스킬 엔드포인트·이미지 공개 서빙, KAKAO_PORT 있을 때만 시작"
```

---

### Task 6: 실 커맨드 통합 확인 + 변환 다듬기

**Files:**
- Test: `$SCRATCH/e2e.mjs` (스크래치)
- Modify(필요 시): `src/kakao/render.js`, `src/kakao/handler.js`

**Interfaces:**
- Consumes: 전부. dev 봇을 카카오 서버 포함으로 띄워 실제 API로 커맨드 20여 개를 쏜다.

- [ ] **Step 1: dev 봇을 카카오 포트와 함께 띄운다**

`--env-file`은 이미 설정된 환경변수를 덮지 않으므로 `.env.dev`를 건드리지 않고 인라인으로 준다(PowerShell):
```
$env:KAKAO_PORT='8081'; $env:KAKAO_SKILL_SECRET='devsecret'; $env:PUBLIC_BASE_URL='http://localhost:8081'
Start-Process -NoNewWindow node -ArgumentList '--env-file=.env.dev','src/index.js' -RedirectStandardOutput "$env:TEMP\dev.log"
```
Expected(`Get-Content "$env:TEMP\dev.log"` 10초 뒤): `카카오 스킬 서버: :8081 (이미지 http://localhost:8081)`.

- [ ] **Step 2: 대표 발화를 쏘고 표로 본다**

`$SCRATCH/e2e.mjs`:
```js
const BASE = 'http://localhost:8081';
const utterances = [
  '/도움말', '/정보 블레상돈', '/캐릭터 블레상돈', '/군장 블레상돈', '/치적 블레상돈', '/로펙 블레상돈', '/부캐 블레상돈',
  '/장비 블레상돈', '/팔찌 블레상돈', '/스킬코드 블레상돈', '/젬효율 블레상돈',
  '/시세 운명의 파괴석', '/ㅂㅅ 겁화 10', '/각인서 원한', '/유각', '/ㅂㅂㄱ 4000', '/분배금 100000 8',
  '/모험섬', '/가토', '/시너지 방깎', '/지옥', '/효율 지옥 5', '/체방', '/업데이트', '/딜컷 세하 10', '/cpm 35 7분',
  '[따봉', '/이모티콘', '/등록', '/랭킹', 'ㅈㅂ 블레상돈', '.정보 블레상돈', '안녕',
];
for (const u of utterances) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/kakao/skill/devsecret`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userRequest: { utterance: u, user: { id: 'e2e-user' } } }),
  });
  const json = await res.json();
  const outs = json.template?.outputs ?? [];
  const text = outs.map((o) => o.simpleText?.text ?? `[이미지 ${o.simpleImage?.imageUrl}]`).join('\n---\n');
  const quick = (json.template?.quickReplies ?? []).map((q) => q.messageText).join(' | ');
  console.log(`\n===== ${u}  (${((Date.now() - t0) / 1000).toFixed(1)}s · outputs ${outs.length} · ${text.length}자${json.useCallback ? ' · CALLBACK' : ''})`);
  console.log(text);
  if (quick) console.log(`[바로가기] ${quick}`);
}
```
Run: `node "$SCRATCH/e2e.mjs" > "$SCRATCH/e2e-out.txt"; cat "$SCRATCH/e2e-out.txt"`

확인 항목(각각 눈으로):
- 모든 요청이 200 JSON, `/랭킹` → 디스코드 전용 안내, `ㅈㅂ …`·`.정보 …`·`안녕` → `/` 안내 + 바로가기.
- `/체방`·`[따봉` → `simpleImage` URL이 `http://localhost:8081/assets/…`이고 그 URL을 `curl -I`로 열면 200 image/png.
- 임베드 표(코드블록)가 "라벨 값" 줄로 읽히고 `**`·백틱이 남아 있지 않다. 1,000자 넘는 응답은 조각으로 나뉘어 있고 3개를 넘지 않는다.
- 캐릭터 조회 결과에 `[바로가기] /정보 블레상돈 | /군장 블레상돈 …`가 붙는다.
- 4.5초를 넘겨 `⏳ 조회에 시간이 걸려요`가 나온 발화를 기록하고, 5초 뒤 같은 발화를 다시 보내 결과가 오는지 확인:
  `node -e "…"` 대신 e2e.mjs의 `utterances`를 해당 발화 하나로 줄여 두 번 실행한다.

- [ ] **Step 3: 어색한 변환 고치기**

발견된 문제만 `render.js`(`stripMarkdown`·`embedToText`)나 `handler.js`에서 고친다. 예상되는 후보:
- 필드 이름이 이모지+공백만인 경우 → `isBlankName` 조건에 `\p{Extended_Pictographic}`은 넣지 않는다(이모지 제목은 의미가 있다).
- 표 첫 열이 라벨이고 둘째 열이 숫자인데 한 칸 공백으로 붙어 읽기 힘들면 `[^\S\n]{2,}` → `' · '`로 바꾸는 것을 검토(사용자 확인 후).
고친 뒤 Task 2·4 테스트를 다시 돌려 초록인지 확인: `node --test "$SCRATCH/render.test.mjs" "$SCRATCH/handler.test.mjs"`.

- [ ] **Step 4: dev 봇 종료**

`Get-Process node | Where-Object { $_.CommandLine -like '*env.dev*' } | Stop-Process`

- [ ] **Step 5: 커밋(변경이 있을 때만)**

```bash
git add src/kakao/render.js src/kakao/handler.js
git commit -m "카카오 변환 다듬기 — 실 커맨드 출력 확인 결과 반영"
```

---

### Task 7: 서버 준비(iptables)·운영 가이드·마무리

**Files:**
- Modify: `CLAUDE.md` (로컬 전용 — 커밋 금지)
- 서버: iptables 규칙 + `netfilter-persistent save`

**Interfaces:**
- Consumes: 배포는 하지 않는다. main 머지 시점에 `.env` 3줄 추가 + 재시작으로 켜진다.

- [ ] **Step 1: 서버 방화벽에 80·8080 열고 80→8080 리다이렉트, 영구 저장**

```bash
ssh -i ~/.ssh/oracle_bot ubuntu@161.33.37.197 'sudo iptables -I INPUT 5 -p tcp -m state --state NEW -m tcp --dport 80 -j ACCEPT && sudo iptables -I INPUT 6 -p tcp -m state --state NEW -m tcp --dport 8080 -j ACCEPT && sudo iptables -t nat -A PREROUTING -p tcp --dport 80 -j REDIRECT --to-ports 8080 && sudo netfilter-persistent save && sudo iptables -S INPUT && sudo iptables -t nat -S PREROUTING'
```
Expected: `INPUT`에 `--dport 80 -j ACCEPT`·`--dport 8080 -j ACCEPT`가 `REJECT` 줄보다 위에, `PREROUTING`에 `REDIRECT --to-ports 8080`.
(`-I INPUT 5`는 현재 규칙 4개 뒤·`REJECT` 앞이다. 순서가 달라졌으면 `sudo iptables -S INPUT`으로 REJECT 앞 위치를 확인해 번호를 맞춘다.)
아직 아무것도 듣지 않으므로 외부 `curl http://161.33.37.197/health`는 실패(연결 거부/타임아웃)가 정상 — OCI 보안 목록은 사용자가 연다.

- [ ] **Step 2: `KAKAO_SKILL_SECRET` 후보 생성(값은 출력만, 어디에도 저장하지 않음)**

Run: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
Expected: 32자 무작위 문자열 1개 — 배포 시 `.env`에 쓸 값으로 사용자에게 전달.

- [ ] **Step 3: CLAUDE.md에 운영 노트 추가(로컬 전용)**

"구조" 섹션에 항목 추가:
```
- `src/kakao/` — 카카오톡 채널 챗봇(오픈빌더 스킬 서버). `KAKAO_PORT`·`KAKAO_SKILL_SECRET`·`PUBLIC_BASE_URL` 셋이 있을 때만 켜짐.
  `server.js`(라우팅·이미지 서빙) → `handler.js`(발화 → 커맨드, 4.5초 예산·보류 캐시·콜백) → `interaction.js`(어댑터) → `render.js`(임베드→평문).
  카카오 입력은 `/커맨드` 형식만(사용자 결정 2026-09-04 — 접두사 없는 초성·`.단어`는 `KAKAO_MATCH_OPTIONS`에서 켤 수 있음).
  제외: 알림설정·랭킹·체급. 카카오 사용자는 `user-links.json`에 `kakao:<키>`로 저장. 스펙: `specs/2026-09-04-kakao-channel-bot-design.md`.
  서버는 8080에서 듣고 iptables가 80→8080 리다이렉트(영구 저장됨). OCI 보안 목록 TCP 80 인그레스는 사용자가 콘솔에서 열어야 함.
```
"미완/대기 항목"에 추가:
```
- 카카오톡: 사용자가 (1) 카카오톡 채널 생성 (2) 챗봇 관리자센터 오픈빌더 신청(~3일) (3) OCI 보안 목록 TCP 80 인그레스 추가.
  승인되면 → main 머지·배포 때 `.env`에 KAKAO_PORT=8080 / KAKAO_SKILL_SECRET / PUBLIC_BASE_URL=http://<공인IP> 추가 → 오픈빌더에
  스킬 URL `http://<공인IP>/kakao/skill/<secret>` 등록, 폴백 블록에 스킬 연결(응답 "스킬데이터 사용") → 배포 → 카톡에서 `/도움말` 확인.
  HTTP를 거부하면 DuckDNS + Caddy로 HTTPS. 그 뒤 홈페이지 카카오 카드·README·v1.2 노트.
```

- [ ] **Step 4: 전체 테스트 한 번에 재실행**

Run: `node --test "$SCRATCH/match.test.mjs" "$SCRATCH/render.test.mjs" "$SCRATCH/interaction.test.mjs" "$SCRATCH/handler.test.mjs" "$SCRATCH/server.test.mjs"`
Expected: `# fail 0`.

- [ ] **Step 5: 최종 상태 확인**

Run: `git status --short && git log --oneline origin/main..dev`
Expected: 작업 트리 깨끗(`.claude/`만 untracked), dev에 이번 커밋들(설계 문서·계획·Task 1~6)이 main 앞에 쌓여 있음. `CLAUDE.md`는 보이지 않아야 한다.
커밋·푸시·머지·배포는 하지 않는다 — 사용자가 "머지해"라고 할 때 일괄.

---

### Task 8 (후속, 완료): 오픈채팅방 브리지 — `specs/2026-09-04-openchat-bridge-design.md`

Task 1~7 완료 후 사용 장소가 오픈채팅방으로 확인돼 추가한 작업. 이미 구현·검증·커밋됨.
- `src/kakao/handler.js`: `handleBridgeMessage({ room, sender, text }, commandMap, { baseUrl, budgetMs = 25_000 }) → { text | null }`,
  `flattenResponse(response) → string | null`. `/`·`[`가 아니면 `null`(침묵). 사용자 키 `oc:<방>|<닉네임>`.
- `src/kakao/server.js`: `POST /bridge/message/<secret>` 라우트(스킬 라우트와 본문 읽기 공유).
- `scripts/messengerbot-r.js`: 메신저봇R 레거시 API 스크립트. `SERVER`·`ROOMS`만 채움.
- 테스트(스크래치): 브리지 침묵/응답/사용자 키, `flattenResponse`, 서버 라우트 200·null·404 — 24/24 통과.
  실 API 직접 실행으로 `/정보`·`/체방`(URL 줄)·`[따봉`(URL)·잡담(침묵)·`/등록`(사용법) 확인.
