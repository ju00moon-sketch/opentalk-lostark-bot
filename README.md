# OpenTalk — 로스트아크 디스코드 봇

로스트아크 정보 조회 봇.

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
| `/보석 종류 레벨` | 경매장 보석 최저가 (겁화/작열/광휘/멸화/홍염) |
| `/장비` `/악세` `/스톤` `/팔찌` | 부위별 장비 상세 (품질 · 연마 효과 · 세공 각인) |
| `/스킬 닉네임` | 채용 스킬 · 트라이포드 · 룬 |
| `/앜패` `/앜그` | 아크 패시브 포인트/노드 · 아크 그리드 코어/효과 |
| `/아바타 닉네임` | 장착 아바타 목록 |
| `/내실 닉네임` | 수집품 진행도 (모코코, 섬의 마음 등) |
| `/낙원력 닉네임` | 낙원력 조회 (보주 툴팁 기준) |
| `/스킬코드 닉네임` | 빌드 요약 + 빌드 지문 코드 (각인·스킬·룬·보석·앜패) |
| `/가토` | 이번 주 잔영 가디언 + 속성 취약 + 추천 카드 ([src/data/guardians.js](src/data/guardians.js)) |
| `/전투력 닉네임` | 전투력 · 전투 특성 · 공격력/생명력 |
| `/장착보석 닉네임` | 장착 보석과 스킬별 효과 |
| `/보석현황` | 4티어 보석 레벨별 최저가 표 (5분 캐시) |
| `/각인서 각인명` | 각인서 시세 (등급별) |
| `/각인서랭킹 [등급]` | 비싼 각인서 TOP 10 (유물/전설) |
| `/생활재료` | 생활 재료 분야별 시세 |
| `/이벤트` `/공지` | 진행 중 이벤트 · 최신 공지 (공식 news API) |
| `/클골 [레이드명]` | 레이드 클리어 골드표 ([src/data/raids.js](src/data/raids.js) 수정으로 갱신) |
| `/주급 닉네임` | 원정대 주간 골드 수입 추정 (상위 6캐릭 × 3레이드) |
| `/시너지 [검색]` | 직업별 파티 시너지 ([src/data/synergies.js](src/data/synergies.js) 수정으로 갱신) |
| `/체방` | 직업별 체방 계수표 이미지 (scripts/chembang-chart.html 렌더링으로 생성) |
| `/지옥` `/나락` | 강하 선택 추천 경로 ([src/data/descent.js](src/data/descent.js)) |
| `/효율 콘텐츠 단계 [레벨]` | 보상 선택지 가치 랭킹 — 실시간 시세 반영 ([src/data/efficiency.js](src/data/efficiency.js)) |
| `/연마표` | 악세서리 연마 효과 수치표 |
| `/코어 검색` | 아크 그리드 코어 정보 — 직업/각인/코어명/혼돈 검색 ([src/data/cores.js](src/data/cores.js)) |
| `/이모티콘` | 사용 가능한 이모티콘 키워드 목록 |
| `/도움말` | 커맨드 사용법 안내 (본인에게만 표시) |

그 외 기능:

- **모험섬 아침 알림** — 매일 아침 8시(KST)에 오늘의 모험 섬을 채널로 자동 발송
- **이모티콘** — 채팅에 `[키워드` 입력 시 이미지 응답. `assets/emoticons/`에 `키워드.png`를 넣으면 등록됨 (Message Content Intent 필요)

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

## 라이선스

[MIT](LICENSE)
