# OpenTalk — 로스트아크 디스코드 봇

로스트아크 정보 조회 봇.

**요구 사항: Node.js 24 이상** (ESM + 내장 `--env-file` 사용)

## 운영 환경

- **봇 호스팅**: Oracle Cloud 무료 티어 VM (Ubuntu 24.04) — `pm2`로 24시간 상시 실행, 크래시 자동 재시작, 재부팅 시 자동 기동
- **홈페이지**: GitHub Pages — `docs/` 폴더가 main 브랜치에서 자동 배포
- **데이터**: 캐릭터/시세는 로스트아크 오픈 API 실시간 조회, 게임 상수(골드표·시너지 등)는 `src/data/` 파일로 관리

## 커맨드

| 커맨드 | 기능 |
|---|---|
| `/캐릭터 닉네임` | 캐릭터 기본 정보 (서버, 직업, 아이템 레벨 등) |
| `/군장 닉네임` | 장비 · 각인 · 보석 · 카드 한눈에 보기 |
| `/원정대 닉네임` | 계정 내 모든 캐릭터를 아이템 레벨 순으로 |
| `/분배금 가격 [인원]` | 경매 적정 입찰가 계산 (4/8/16인, 수수료 5% 반영) |
| `/모험섬` | 오늘의 모험 섬 시간표 + 주요 보상 (골드섬 💰 표시) |
| `/시세 아이템명` | 거래소 가격 검색 (부분 검색 가능) |
| `/보석 종류 레벨` | 경매장 보석 최저가 (겁화/작열/광휘/멸화/홍염) |
| `/장비` `/악세` `/스톤` `/팔찌` | 부위별 장비 상세 (품질 · 연마 효과 · 세공 각인) |
| `/스킬 닉네임` | 채용 스킬 · 트라이포드 · 룬 |
| `/앜패` `/앜그` | 아크 패시브 포인트/노드 · 아크 그리드 코어/효과 |
| `/아바타 닉네임` | 장착 아바타 목록 |
| `/내실 닉네임` | 수집품 진행도 (모코코, 섬의 마음 등) |
| `/낙원력 닉네임` | 낙원력 조회 (보주 툴팁 기준) |
| `/스킬코드 닉네임` | **게임 호환 스킬코드** (공식 전투정보실 발급) + 빌드 요약 |
| `/가토` | 이번 주 잔영 가디언 + 속성 취약 + 추천 카드 ([src/data/guardians.js](src/data/guardians.js)) |
| `/알림설정 켜기·끄기·상태` | 서버별 모험섬 아침 알림 설정 (서버 관리 권한 필요) |
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

- **모험섬 아침 알림** — 매일 아침 8시(KST) 자동 발송, 다른 서버는 `/알림설정 켜기`
- **이모티콘** — 채팅에 `[키워드` 입력 시 이미지 응답. `assets/emoticons/`에 `키워드.png`를 넣으면 등록됨 (Message Content Intent 필요)
- **채팅 커맨드** — 초성은 바로(`ㅂㅂㄱ 4000`), 원래 단어는 `.` 필수(`.분배금 4000`), 슬래시 별칭(`/ㅂㅂㄱ`)도 지원 ([src/text-commands.js](src/text-commands.js)의 ALIASES에서 추가)

## 프로젝트 구조

```
src/
  index.js              # 봇 본체 — 로그인, 채널 제한, 메시지 처리(초성 커맨드 → 이모티콘 순)
  register-commands.js  # 슬래시 커맨드 등록 스크립트 (npm run register)
  lostark.js            # 로스트아크 오픈 API 래퍼 (armory/거래소/경매장/캘린더/뉴스)
  format.js             # 임베드 공용 포맷터 (trunc, gold, 색상)
  tooltip.js            # 장비 툴팁(JSON) 파서 — 품질/연마/세공/낙원력 추출
  text-commands.js      # 채팅 커맨드 — 초성(ㅂㅂㄱ)은 바로, 단어는 "." 필수. 슬래시 별칭도 여기서 생성
  emoticons.js          # 이모티콘 — assets/emoticons/의 파일명 = 키워드, 재시작 없이 인식
  notify.js             # 모험섬 아침 알림 (매일 08:00 KST, 등록된 모든 채널로 발송)
  notify-store.js       # 서버별 알림 채널 영구 저장 (notify-channels.json)
  descent-shared.js     # /지옥·/나락 공용 로직 (랜덤 강하 추천)
  commands/             # 커맨드 1개 = 파일 1개 (data + execute 내보내기) → index.js 배열에 등록
  data/                 # 수동 관리 게임 데이터 — 패치 시 여기만 수정
    raids.js            #   레이드 클리어 골드표 (/클골, /주급)
    synergies.js        #   직업별 시너지표 (/시너지)
    guardians.js        #   가토 로테이션·속성·카드 (/가토)
    efficiency.js       #   지옥/나락 효율 단가·계산 (/효율)
    hellRewards.js      #   지옥/나락 단계별 보상표 (자동 생성분)
    cores.js            #   아크그리드 코어 558종 (/코어, 자동 생성분)
    descent.js          #   강하 등급 정의
assets/
  emoticons/            # 이모티콘 이미지 (파일명 = 키워드, 저작권 문제로 git 제외)
  charts/               # /체방 등 커맨드가 전송하는 차트 이미지
scripts/
  chembang-chart.html   # 체방 차트 원본 — 수정 후 렌더링 캡처로 assets/charts 갱신
docs/
  index.html            # 홈페이지 (GitHub Pages, main 브랜치에서 자동 배포)
```

**커맨드 추가 절차**: `src/commands/`에 파일 생성 → `commands/index.js` 배열에 추가 → `npm run register` → 서버 배포 → `/도움말`·README·홈페이지 갱신. 초성 별칭은 `text-commands.js`의 ALIASES에 한 줄 추가하면 채팅·슬래시 양쪽에 생긴다.

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
