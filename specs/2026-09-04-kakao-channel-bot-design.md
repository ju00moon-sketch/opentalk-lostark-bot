# 카카오톡 채널 챗봇 연동 — 설계 (2026-09-04)

> **후속 변경**: 구현 후 사용자가 쓰려는 곳이 **오픈채팅방**으로 확인돼(공식 챗봇은 오픈채팅방 불가) 폰 브리지 방식으로 전환했다 —
> `specs/2026-09-04-openchat-bridge-design.md`. 이 문서의 서버·변환 설계는 그대로 재사용되며, 오픈빌더 신청·채널 생성만 하지 않는다.

포근해용 디스코드 봇의 커맨드를 카카오톡에서도 쓸 수 있게 한다. 카카오 i 오픈빌더(챗봇 관리자센터)로
카카오톡 **채널**에 챗봇을 붙이고, 채널과의 1:1 채팅에서 `/정보 블레상돈`처럼 물으면 우리 서버(스킬 서버)가
기존 커맨드 로직을 그대로 실행해 답한다.

## 1. 배경과 결정

- 카카오 공식 봇은 채널 1:1 채팅에서만 동작한다. 길드 단톡방·오픈채팅방에는 제3자 봇을 넣을 수 없다
  (오픈채팅은 카카오 자체 "방장봇"의 환영/자동응답만 가능). 단톡방에서 되게 하는 비공식 방법(안드로이드 폰 +
  알림 읽기 앱)은 약관 위반·계정 제재·폰 상시 구동 문제로 **채택하지 않음**(사용자 결정).
- 오픈빌더 사용 조건: 카카오톡 채널(개인 가능, 사업자 인증 불필요) + 오픈빌더 사용 신청 승인(약 3일).
- 스킬 서버 제약: 공인 IP 또는 도메인, **응답 5초 고정**. 5초를 넘기는 응답은 "AI 챗봇 관리"에서 콜백을
  신청하면 가능(`useCallback`, 승인 1~2일).
- 범위(사용자 결정): 디스코드 전용 커맨드만 빼고 전부. `/체방` 차트 이미지와 이모티콘(`[따봉`) 포함,
  카카오용 `/등록` 포함.
- 입력 형식(사용자 결정): **`/커맨드` 형식만**. 접두사 없는 초성(`ㅈㅂ 닉`)과 `.단어`(`.정보 닉`)는 이번엔
  끄고, 나중에 켤 수 있게 스위치만 둔다.

## 2. 범위

포함
- `src/commands/`의 모든 커맨드 중 아래 제외 목록 외 전부. 초성 별칭(`/ㅂㅂㄱ`)도 디스코드처럼 동작.
- 연마 조합 단축(`/상상 70` — 디스코드의 `.상상 70`에 해당).
- 이모티콘 `[키워드` → 이미지 응답.
- 카카오용 `/등록 닉네임` · `/등록 해제`.
- 결과 아래 후속 조회 버튼 → 카카오 바로가기(quickReplies).

제외
- `/알림설정`(디스코드 채널 개념), `/랭킹`·`/체급`(디스코드 서버 멤버 집계).
- 봇이 먼저 보내는 메시지(모험섬 아침 알림·업데이트 알림) — 채널 1:1에서 선발신은 유료 메시지라 하지 않음.
- 접두사 없는 초성·`.단어` 입력(스위치로 보류).
- 디스코드↔카카오 계정 연결(각각 따로 등록).

## 3. 사용자 경험

### 입력
- 발화가 `/`로 시작하고, `/` 뒤 첫 토큰이 커맨드명·초성 별칭·단어 축약(`업뎃`·`시전`)·연마 조합이면 실행.
  나머지 토큰은 디스코드 텍스트 커맨드와 같은 `parse`로 옵션이 된다.
- `/`로 시작하지 않는 발화: 이모티콘 형식(`[따봉`)이면 이미지, 아니면 안내 한 줄
  ("명령은 /로 시작해요. 예: /정보 닉네임 · /도움말") + 바로가기(도움말·모험섬·가토·시세·업데이트).
- 모르는 커맨드(`/없는거`): 같은 안내.
- 옵션이 부족하면 디스코드와 같은 "사용법: …" 문구.

### 출력
카카오는 마크다운·고정폭 글꼴이 없다. 디스코드 응답 페이로드(`content`·`embeds`·`files`·`components`)를
아래 규칙으로 바꾼다.
- 텍스트: `content` → 그대로. 임베드는 제목 → 첫 줄, 설명 → 본문, 필드 → `▸ 필드명` 줄 + 값, 푸터 → 마지막 줄.
  임베드가 여러 개면 빈 줄로 이어 붙인다.
- 마크다운 제거: `**` `__` `~~` `` ` `` ``` 코드블록 펜스 ``` 제거, `[텍스트](링크)` → `텍스트 링크`,
  `<#채널>`·`<@유저>` 같은 디스코드 멘션 제거, 표의 2칸 이상 연속 공백 → 한 칸(정렬은 포기, "라벨 값" 줄로).
- 길이: `simpleText` 하나 1,000자. 넘으면 줄 단위로 잘라 **최대 3개** `simpleText`로 나누고(출력 3개 제한),
  그래도 남으면 마지막에 `…`.
- 이미지(`files`) → `simpleImage { imageUrl, altText }`. URL은 `PUBLIC_BASE_URL` + 공개 경로. 텍스트가 같이
  있으면 텍스트 → 이미지 순으로 outputs에 넣는다(합계 3개 이내).
- 버튼(`components`) → `quickReplies`. `run:커맨드:닉네임` → `{ label: 커맨드, action: 'message',
  messageText: '/커맨드 닉네임' }`, `cmd:커맨드` → `messageText: '/커맨드'`. 최대 10개.
- 에페메랄 플래그는 무시(1:1 채팅이라 의미 없음).
- 오류: 디스코드와 같은 문구 `오류가 발생했어요: …`를 `simpleText`로.

### 5초 제한
커맨드 실행 Promise와 **4.5초** 타이머를 경쟁시킨다.
- 4.5초 안에 끝남 → 변환해서 응답.
- 못 끝남 + 요청에 `userRequest.callbackUrl` 있음(콜백 승인된 봇) → 즉시
  `{ version: '2.0', useCallback: true, data: { text: '⏳ 조회 중이에요…' } }`로 응답하고, 실행이 끝나면 같은
  변환 결과를 `callbackUrl`로 POST(스킬 응답 포맷과 동일).
- 못 끝남 + 콜백 없음 → `⏳ 조회에 시간이 걸려요. 잠시 후 같은 명령을 다시 보내 주세요` 응답. 실행은 계속하고
  결과를 `(사용자 키, 정규화한 발화)` 키로 **3분** 보관. 같은 발화가 다시 오면 보관된 Promise를 4.5초까지
  기다려 응답(이미 끝났으면 즉시).
콜백 승인이 없어도 동작하고, 승인되면 자동으로 콜백 경로를 탄다.

### 등록과 사용자 식별
- 카카오 요청의 `userRequest.user.id`(봇 전용 사용자 키)를 `kakao:<키>` 형태로 어댑터의 `user.id`에 넣는다.
  기존 `user-links.json`(`user-store.js`)에 그대로 저장되므로 `resolveCharacter`의 "등록한 내 캐릭터" 폴백이
  코드 수정 없이 동작한다. `/랭킹` 집계는 이미 스노플레이크(`/^\d{17,20}$/`)만 걸러 쓰므로 영향 없다.
- 디스코드 `/등록`은 남의 캐릭터 등록을 막기 위해 닉네임을 받지 않고 디스코드 닉네임만 쓴다. 카카오는
  닉네임을 주지 않으므로 **카카오에서만** `/등록 닉네임`으로 이름을 받고, `/등록 해제`로 지운다.
  1:1 채팅이라 남의 캐릭터를 등록해도 자기 조회 기본값만 바뀐다 — 무해.
- 카카오 어댑터는 `member`·`guild`·`channel`을 `null`로 둔다. `primaryDiscordName`은 `null`을 돌려주므로
  등록 안 한 사용자는 닉네임을 직접 적어야 한다(`NO_CHARACTER_HINT` 그대로).

## 4. 아키텍처

접근법: **디스코드 봇 프로세스에 HTTP 서버 내장**(별도 pm2 앱·별도 서비스 대신). 배포 1번, 로펙/시세 5분
캐시와 등록 파일 공유, 의존성 추가 없음(Node 내장 `http`). 웹서버 예외는 디스코드 봇을 죽이지 않게 격리한다.

```
카카오톡 채널 1:1 ─▶ 오픈빌더 폴백 블록 ─POST─▶ http(s)://<PUBLIC_BASE_URL>/kakao/skill/<KAKAO_SKILL_SECRET>
                                                    │ src/kakao/server.js   라우팅 · 정적 파일 · 본문 제한
                                                    │ src/kakao/handler.js  발화 → 커맨드, 4.5초 예산, 보류 캐시, 콜백
                                                    │ src/kakao/interaction.js  KakaoInteraction 어댑터
                                                    │ src/kakao/render.js   디스코드 페이로드 → 카카오 JSON
                                                    ▼
                                             src/commands/* execute() 재사용
```

### 파일
- `src/kakao/server.js` — `startKakaoServer(commandMap)`. `KAKAO_PORT`가 없으면 아무것도 안 한다.
  라우트: `POST /kakao/skill/<secret>` · `GET /health` → `ok` · `GET /assets/emoticons/<파일>` ·
  `GET /assets/charts/<파일>`. 그 외 404. 본문 1MB 초과 413, JSON 파싱 실패 400. 정적 파일은 허용 폴더
  2개의 **직접 자식 파일만**(`path.basename`으로 정규화, `..`·구분자 포함 시 404), 확장자별 Content-Type,
  `Cache-Control: public, max-age=86400`.
- `src/kakao/handler.js` — `handleSkillRequest(body, commandMap)` → 카카오 응답 객체.
  `matchCommand(utterance)`(text-commands에서 분리한 공용 매처를 `/` 접두사 모드로 호출) → 실행 →
  `render` → 예산·보류 캐시·콜백 처리. 콜백 POST 실패는 로그만.
- `src/kakao/interaction.js` — `KakaoInteraction`. `TextInteraction`과 같은 표면: `options.get*`,
  `deferReply()`(no-op), `reply()`·`editReply()`·`followUp()`은 페이로드를 모아 둔다(`reply`/`editReply`는
  마지막 것으로 교체, `followUp`은 추가). `user = { id: 'kakao:<키>' }`, `platform = 'kakao'`,
  `deferred`/`replied` 플래그 유지(커맨드들이 분기함).
- `src/kakao/render.js` — `toKakaoResponse(payloads, { baseUrl })`. 순수 함수. 위 "출력" 규칙 구현.
  `stripMarkdown(text)`, `embedToText(embed)`, `splitText(text, 1000, 3)`, `buttonsToQuickReplies(rows)`,
  `fileToImage(path, baseUrl)`.
- `src/text-commands.js` — 매칭 부분을 `matchTextCommand(content, { prefixes, bareChosung })`로 분리해
  `{ command, options, usage }`를 돌려주게 한다. 디스코드는 지금과 같은 설정(`prefixes: ['.', '!']`,
  `bareChosung: true`)으로 호출해 동작 불변. 카카오는 `prefixes: ['/']`, `bareChosung: false`.
- `src/commands/register.js` — `interaction.platform === 'kakao'`이면 첫 인자를 닉네임으로 받고
  (`/등록 해제`는 해제), 아니면 기존 디스코드 흐름. 카카오 어댑터가 `options.getString('닉네임')`으로 넘긴다.
- `src/index.js` — `ClientReady`에서 `startKakaoServer(commandMap)` 호출 한 줄.
- `.env.example` — `KAKAO_PORT`, `KAKAO_SKILL_SECRET`, `PUBLIC_BASE_URL` 설명 추가.

### 요청·응답 포맷 (오픈빌더 스킬 v2.0)
요청에서 쓰는 필드: `userRequest.utterance`(발화), `userRequest.user.id`(봇 전용 사용자 키),
`userRequest.callbackUrl`(콜백 승인 봇만). 응답:
```json
{ "version": "2.0",
  "template": { "outputs": [ { "simpleText": { "text": "…" } }, { "simpleImage": { "imageUrl": "…", "altText": "…" } } ],
                "quickReplies": [ { "label": "군장", "action": "message", "messageText": "/군장 블레상돈" } ] } }
```
콜백 대기 응답: `{ "version": "2.0", "useCallback": true, "data": { "text": "⏳ 조회 중이에요…" } }`.
스킬 서버는 **항상 200 + JSON**을 준다(그래야 카카오 기본 오류 말풍선 대신 우리 문구가 보인다).

## 5. 서버·네트워크·배포

- 환경변수: `KAKAO_PORT`(예 8080; 없으면 카카오 서버 안 켬 — 운영 봇도 값이 없으면 기존과 완전히 동일),
  `KAKAO_SKILL_SECRET`(URL 비밀 경로, 영숫자 32자 이상), `PUBLIC_BASE_URL`(예 `http://<공인IP>`, 끝 슬래시 없음).
- 포트: Node는 8080에서 듣고 iptables `PREROUTING REDIRECT 80→8080`으로 80을 받는다(루트 없이 80 사용).
  `INPUT`에 80·8080 허용 규칙 추가 후 `netfilter-persistent save`로 재부팅에도 유지.
- 프로토콜: 우선 **HTTP + 공인 IP**(공식 문서 요구는 "공인 IP 또는 공중망 도메인"). 오픈빌더가 HTTPS를 요구하거나
  이미지가 HTTP로 안 뜨면 무료 서브도메인(DuckDNS 등) + Caddy 자동 인증서를 앞에 두고 `PUBLIC_BASE_URL`만
  바꾼다 — 코드 변경 없음.
- 배포는 기존 절차(`src` 동기화 → `.env`에 3줄 추가 → `pm2 restart`). 커맨드 정의는 바뀌지 않으므로
  `register-commands`는 불필요.
- 개발: `.env.dev`에 `KAKAO_PORT=8081`을 넣고 로컬에서 띄워 카카오 요청 JSON을 흉내 낸 스크립트로 검증.

### 운영자(사용자)가 직접 해야 하는 일
1. 카카오톡 채널 만들기(카카오톡 채널 관리자센터). 채널명 예: 포근해용.
2. 챗봇 관리자센터에서 오픈빌더 사용 신청 → 승인(약 3일) → 봇 생성 → 채널 연결.
3. Oracle Cloud 콘솔 → VCN 보안 목록 → 인그레스 규칙 추가: 소스 `0.0.0.0/0`, TCP 대상 포트 `80`.
   (서버 안 iptables는 배포 때 함께 연다.)
4. 승인 후: 스킬 등록(URL = `PUBLIC_BASE_URL/kakao/skill/<secret>`), 폴백 블록에 스킬 연결 + 응답을
   "스킬데이터 사용"으로, 봇 배포. 이 단계는 화면을 보며 안내한다.
5. (선택) 챗봇 설정 → AI 챗봇 관리에서 콜백 신청. 없어도 동작한다(§3 5초 제한).

## 6. 보안

- 스킬 URL에 비밀 경로 — 모르면 404. 사용자 키는 로그에 앞 8자만(발화는 커맨드라 그대로 남긴다).
- 정적 파일은 허용 폴더 2개의 직접 자식만, 파일명 정규화, 심볼릭 링크 따라가지 않음(`realpath` 검사).
- 본문 1MB 제한, JSON 아니면 400. 응답 생성 중 예외는 500 대신 오류 문구 200으로.
- 서버 `error` 이벤트와 요청 핸들러 예외를 모두 잡아 디스코드 클라이언트에 영향이 없게 한다.

## 7. 오류 처리·로그

- 커맨드 예외 → `오류가 발생했어요: <message>` simpleText(디스코드 문구와 동일).
- 콜백 POST 실패(만료·네트워크) → `console.error('[카카오 콜백]', …)`만.
- 시작 로그: `카카오 스킬 서버: :8080 (이미지 <PUBLIC_BASE_URL>)` 또는 `카카오 스킬 서버: 꺼짐(KAKAO_PORT 없음)`.
- 요청 로그: `[카카오] kakao:abcd1234… "/정보 블레상돈" 1.2s` · 예산 초과 시 `(콜백)` 또는 `(보류)` 표시.

## 8. 검증

- 단위(스크래치 스크립트, 저장소에 남기지 않음): `render.js` — 마크다운 제거·코드블록 표 변환·1,000자 분할·
  버튼→바로가기; `matchTextCommand` — `/` 모드에서 `/정보 닉`·`/ㅂㅂㄱ 4000`·`/상상 70` 매칭, `ㅈㅂ 닉`·
  `.정보 닉`은 불일치, 디스코드 모드는 기존과 동일.
- 통합: 로컬 dev 봇을 `KAKAO_PORT=8081`로 띄우고 대표 커맨드 20여 개(정보·캐릭터·군장·치적·로펙·부캐·시세·
  보석·각인서·분배금·모험섬·가토·시너지·지옥·효율·체방·이모티콘·등록·도움말·업데이트)에 카카오 요청 JSON을
  보내 응답 JSON과 소요 시간을 표로 확인. 4.5초를 넘기는 커맨드 목록을 기록한다.
- 배포 후: 외부에서 `GET /health`, 이미지 URL, 잘못된 비밀 경로 404 확인. 오픈빌더 승인 뒤 실제 카카오톡에서
  최종 확인.

## 9. 이후 단계 (이번 범위 밖)

- 채널이 열리면 홈페이지 "카카오톡 연동 준비 중" 카드 → 채널 추가 링크·사용법으로 교체, README·업데이트 노트(v1.2).
- 접두사 없는 초성·`.단어` 입력 켜기(스위치 한 줄).
- HTTPS(도메인 + Caddy) — 필요해질 때.

## 10. 확인 필요한 리스크

- 오픈빌더가 스킬 URL에 HTTP를 받아 주는지, `simpleImage`가 HTTP 이미지를 표시하는지 — 승인 후 첫 테스트에서 확인.
  아니면 §5의 HTTPS 경로.
- 콜백 URL 유효시간은 문서마다 1분/5분으로 다름 — 우리 커맨드는 길어도 수십 초라 무관.
- 카카오 스킬 서버 IP 대역은 문서화가 불충분해 IP 허용 목록은 쓰지 않고 비밀 경로로 대신한다.
