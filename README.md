# OpenTalk — 로스트아크 디스코드 봇

엉봇 스타일의 로스트아크 정보 조회 봇.

**요구 사항: Node.js 24 이상** (ESM + 내장 `--env-file` 사용)

## 커맨드

| 커맨드 | 기능 |
|---|---|
| `/캐릭터 닉네임` | 캐릭터 기본 정보 (서버, 직업, 아이템 레벨 등) |
| `/군장 닉네임` | 장비 · 각인 · 보석 · 카드 한눈에 보기 |
| `/원정대 닉네임` | 계정 내 모든 캐릭터를 아이템 레벨 순으로 |
| `/입찰 가격 [인원]` | 경매 적정 입찰가 계산 (4/8/16인, 수수료 5% 반영) |
| `/모험섬` | 오늘의 모험 섬 시간표 + 주요 보상 (골드섬 💰 표시) |
| `/시세 아이템명` | 거래소 가격 검색 (부분 검색 가능) |
| `/보석 종류 레벨` | 경매장 보석 최저가 (겁화/작열/멸화/홍염) |

## 구조

```
src/
  index.js              # 봇 본체 (디스코드 로그인 + 커맨드 디스패치)
  register-commands.js  # 슬래시 커맨드 등록 스크립트
  lostark.js            # 로스트아크 오픈 API 공용 모듈 (나중에 카톡 봇에도 재사용)
  format.js             # 임베드 공용 포맷터
  commands/             # 커맨드 1개 = 파일 1개 (data + execute 내보내기)
```

## 처음 한 번만 하는 설정

### 1. 로스트아크 API 키 발급

1. https://developer-lostark.game.onstove.com 접속 → 스토브 계정 로그인
2. 상단 **GET ACCESS** (클라이언트 등록) → 키 발급
3. 발급된 키(JWT, 아주 긴 문자열)를 복사해 둔다

### 2. 디스코드 봇 생성

1. https://discord.com/developers/applications 접속
2. **New Application** → 이름 입력 (예: 엉봇짭)
3. **General Information** 탭의 **Application ID** 복사
4. **Bot** 탭 → **Reset Token** → 토큰 복사 (이 화면 벗어나면 다시 못 봄!)

### 3. 봇을 내 서버에 초대

1. **OAuth2 → URL Generator** 탭
2. Scopes에서 `bot`, `applications.commands` 체크
3. Bot Permissions에서 `Send Messages`, `Embed Links` 체크
4. 아래 생성된 URL을 브라우저에 붙여넣고 내 서버 선택

### 4. 환경 변수 설정

`.env.example`을 복사해서 `.env` 파일을 만들고 위에서 복사한 값 3개를 채운다.

```
DISCORD_TOKEN=봇 토큰
DISCORD_CLIENT_ID=애플리케이션 ID
LOSTARK_API_KEY=로스트아크 API 키
```

⚠️ `.env`는 절대 다른 사람에게 보여주거나 깃허브에 올리지 말 것.

### 5. 슬래시 커맨드 등록 (커맨드 추가/수정 때마다)

```
npm run register
```

기본은 글로벌 등록이라 반영까지 최대 1시간 걸릴 수 있다.
**개발 중에는** `.env`에 `DISCORD_GUILD_ID=내_서버_ID`를 넣으면 그 서버에만 **즉시** 등록된다.
(서버 ID: 디스코드 설정 → 고급 → 개발자 모드 켜기 → 서버 아이콘 우클릭 → ID 복사)

## 실행

```
npm start
```

콘솔에 `로그인 완료: ...`가 뜨면 디스코드 서버에서 `/캐릭터 닉네임` 입력.

## 커맨드 추가하는 법

1. `src/commands/`에 새 파일 생성 — `data`(SlashCommandBuilder)와 `execute(interaction)`를 내보내면 됨
2. `src/commands/index.js`의 배열에 추가
3. `npm run register` 실행 후 봇 재시작

API 문서: https://developer-lostark.game.onstove.com/getting-started
(요청 한도: 기본 분당 100회)
