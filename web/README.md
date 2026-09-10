# 홈페이지 로그인 서비스

Node.js 24.19 이상 24.x와 기본 모듈만 사용하는 독립 서비스다. 외부 패키지 설치가 필요하지 않으며 봇 코드·환경·기록을 읽지 않는다. 별도 비권한 계정으로 실행하고, Nginx가 HTTPS를 종료한 뒤 인증 경로만 이 서비스로 전달한다.

## 실행 설정

| 환경변수 | 값 또는 용도 |
|---|---|
| `WEB_ORIGIN` | `https://pogeunhaeyong.duckdns.org` |
| `WEB_HOST` | `127.0.0.1`만 허용, 기본값 동일 |
| `WEB_PORT` | 기본값 `8090` |
| `WEB_DB_PATH` | 전용 SQLite 파일의 절대 경로 |
| `DISCORD_OAUTH_CLIENT_ID` | Discord OAuth2 애플리케이션 ID |
| `DISCORD_OAUTH_CLIENT_SECRET` | 해당 애플리케이션의 OAuth2 시크릿 |
| `KAKAO_OAUTH_CLIENT_ID` | 카카오 앱 REST API 키 |
| `KAKAO_OAUTH_CLIENT_SECRET` | 해당 REST API 키의 클라이언트 시크릿 |
| `KAKAO_ADMIN_KEY` | 동일 카카오 앱의 대표 어드민 키 |
| `KAKAO_APP_ID` | 동일 카카오 앱의 숫자 앱 ID |
| `GUILD_AUTO_APPROVAL_ENABLED` | 정확히 `true`일 때 자동 승인 사용 요청 |
| `GUILD_AUTO_DISCORD_GUILD_ID` | 인증 Discord 서버 ID. KOR Lost ARK는 `660684739056762891` |
| `GUILD_AUTO_DISCORD_ROLE_ID` | 인증 서버의 루페온 역할 ID `697681987850338314` |
| `LOSTARK_API_KEY` | 로스트아크 공식 캐릭터 프로필 조회 키. 서버에서만 제공 |

비밀값은 공개 저장소나 정적 파일에 넣지 않는다. 실행 환경은 운영 관리자가 서비스 전용 비공개 환경 파일에서 제공한다. 카카오 네 값이 모두 있어야 카카오 로그인 버튼이 사용 가능한 상태가 된다. Discord는 두 값이 모두 필요하다. 운영 시작 파일은 HTTP origin과 외부 인터페이스 바인딩을 거부한다. 키 재발급은 이 서비스의 설치 절차가 아니다.

자동 승인은 위 네 설정과 기존 Discord OAuth 두 값이 모두 있을 때만 활성화한다. 설정이 빠지거나 활성 값이 다르면 기존 게임 내 번호 확인을 유지한다. 게임 대상은 루페온 서버의 포근해 길드이며 조회 서버 주소는 설정으로 바꾸지 않는다.

```sh
node src/start.js
node --test test/*.test.js
```

DB 상위 디렉터리는 전용 디렉터리여야 한다. Linux에서 다른 사용자 권한이 열려 있으면 시작을 거부한다. 새 디렉터리는 `700`, DB와 WAL·SHM은 `600`이며 시작 프로세스는 `umask 077`을 사용한다. 기존 봇 DB나 다른 서비스 DB를 지정하면 안 된다. WAL, foreign keys, secure delete, 250밀리초 busy timeout을 사용한다. 저장소는 배포 소스 교체와 분리해서 보존한다.

## 생성 함수

`web/src/server.js`의 `createWebServer({ config, fetchImpl = fetch, now = Date.now, allowHttpForTests = false })`는 `{ server, close }`를 즉시 반환한다.

- `server`는 아직 listen하지 않은 표준 `http.Server`다.
- `close()`는 HTTP 요청, 진행 중인 탈퇴 처리, 정리 타이머와 SQLite를 닫는 Promise이며 중복 호출 가능하다.
- `config`는 `web/src/config.js`의 `loadConfig(env)` 반환값이다. 직접 구성할 때는 `{ origin, host, port, dbPath, providers: { discord: {clientId, clientSecret}, kakao: {clientId, clientSecret, adminKey, appId} } }`를 사용한다.
- `now()`는 밀리초를 반환한다. `fetchImpl`은 공급자 통신 경계에만 주입한다.
- `allowHttpForTests: true`는 로컬 HTTP origin 시험에만 사용한다. 운영 시작 파일에서는 이 옵션을 전달하지 않는다. TLS 프록시 뒤의 HTTP 리스너에는 이 옵션이 필요하지 않다.

`start.js`는 환경을 읽고 기본 `127.0.0.1:8090`에 바인딩한다. SIGTERM·SIGINT는 최대 20초 동안 정상 종료를 시도한다. 로그에는 준비 상태나 짧은 실패 종류만 남기며 오류 객체·URL·헤더·회원정보는 출력하지 않는다.

## HTTP 계약

모든 응답은 `Cache-Control: no-store`를 사용한다. 브라우저 쿠키 이름은 `__Host-web_binding`, `__Host-web_session`이며 Secure·HttpOnly·SameSite=Lax·Path=/를 적용한다. 브라우저 결합 쿠키와 인가 거래는 5분(300초)에 만료된다. 세션은 마지막 사용 시각과 무관하게 발급 후 7일에 만료된다.

| 경로 | 처리 |
|---|---|
| `GET /auth/discord/start` | `identify`로 인가 시작, 302 이동 |
| `GET /auth/kakao/start` | `profile_nickname`으로 인가 시작, 302 이동 |
| `GET /auth/{provider}/callback` | 검증·토큰 교환·회원 조회 후 `/account.html`로 303 이동 |
| `GET /api/auth/session` | 아래 세션 JSON |
| `POST /api/auth/logout` | Origin·CSRF 확인 후 현재 세션 삭제, 204 |
| `DELETE /api/auth/account` | Origin·CSRF·최근 5분 로그인 확인 후 회원과 모든 세션 삭제, 204 |
| `POST /api/auth/kakao/unlink` | 인증된 카카오 연결 해제 웹훅, 처리 완료 후 200 |
| `GET /api/auth/health` | 정상 시 `{ "ok": true }`, 저장 실패 또는 미완료 삭제가 있으면 503 |

비로그인 JSON:

```json
{"authenticated":false,"providers":{"discord":true,"kakao":true}}
```

로그인 JSON:

```json
{"authenticated":true,"providers":{"discord":true,"kakao":true},"user":{"id":"서비스 회원 식별자","provider":"discord","displayName":"표시 이름"},"csrfToken":"세션에 묶인 토큰"}
```

로그아웃·탈퇴 요청에는 설정된 origin과 정확히 일치하는 `Origin` 및 세션 API에서 받은 `X-CSRF-Token` 헤더가 필요하다. body는 비운다. 인증·CSRF 실패는 403이다. 탈퇴 시 5분보다 오래된 세션은 `401 {"error":"reauthentication_required"}`, 공급자 실패는 `502 {"error":"provider_error"}`, 저장 실패는 `503 {"error":"storage_unavailable"}`다.

콜백 오류는 `/account.html?error=...`로 전달한다. 허용 코드는 `provider_unavailable`, `invalid_request`, `access_denied`, `provider_error`, `deletion_pending`, `server_error`다. 횟수 제한은 429와 `Retry-After`를 유지하면서 고정 HTML 안내와 `/account.html` 복귀 링크를 표시한다. 안내 문구는 “로그인 요청이 잠시 많아졌어요. 잠시 후 다시 시도해 주세요.”이며 외부 자원이나 요청값을 포함하지 않는다. 그 외 알 수 없는 경로는 404, 잘못된 메서드는 405다. 과대 URL·쿠키/헤더·본문은 각각 414·431·413으로 거부한다.

## 상태와 제한

32바이트 state와 브라우저 결합값을 요청별로 확인하며 DB에는 그 해시만 저장한다. PKCE verifier는 5분짜리 거래에만 저장하고 소비 또는 만료 시 제거한다. 다른 브라우저·다른 공급자·누락·중복·만료 상태는 거래를 사용할 수 없다. 검증된 거절과 교환 실패도 이미 소비한 거래를 재사용하지 않는다.

회원은 공급자와 고유 ID의 고유 제약으로 구분한다. 같은 닉네임으로 계정을 합치지 않는다. 카카오 ID는 안전한 양의 정수만 허용한다. 공급자 토큰은 저장하지 않는다. 로그인 성공 시 요청에 있던 이전 세션을 교체하고 새 세션 해시를 저장한다. CSRF 값은 세션 비밀값으로부터 별도 도메인 구분을 두고 유도한다.

외부 요청은 각 8초, JSON 64 KiB로 제한하고 리다이렉트를 거부한다. 입력 URL은 4 KiB, Cookie는 4 KiB, 전체 HTTP 헤더는 8 KiB, 본문은 1 KiB로 제한한다. 기본 IP별 제한은 10분에 인가 시작 30회·콜백 60회이며 미완료 거래는 전체 1,000개다. 횟수 저장은 10,000개 항목으로 제한하고 만료 항목을 매분 정리한다.

Nginx는 `X-Real-IP $remote_addr`를 반드시 덮어써야 한다. 서비스는 loopback 연결에서 받은 유효한 단일 IP만 프록시 주소로 사용하고 `X-Forwarded-For`는 신뢰하지 않는다. 운영 8090은 외부에 공개하지 않는다. 세션·인가 거래의 만료 정리는 매분 및 관련 DB 쓰기 트랜잭션에서 수행한다.

## 회원 탈퇴와 복구

Discord 탈퇴는 로컬 프로필과 전체 세션을 한 트랜잭션으로 삭제한다. 카카오는 먼저 최소 삭제 의도를 DB에 저장한 다음, 저장된 회원번호를 사용해 대표 어드민 키로 연결 해제를 요청한다. 삭제 의도 저장 자체가 실패하면 원격 호출 없이 503을 반환한다. 성공 응답의 ID가 일치해야 로컬 삭제를 진행한다. HTTP 400과 명시적인 공급자 코드 `-101` 조합만 이미 해제된 상태로 인정한다. 다른 오류나 잘못된 ID는 완료로 처리하지 않는다.

삭제 의도가 DB에 저장되는 순간부터 해당 계정의 모든 세션은 원격 처리나 확인 기록의 성공 여부와 무관하게 인증에 사용할 수 없다. 세션 API는 회원정보·CSRF 없이 비로그인 상태와 쿠키 만료를 반환하며 로그아웃·탈퇴 보호 경로도 403으로 차단한다. 삭제 의도가 하나라도 남으면 health는 503이다. 카카오 inbox에 남은 계정에도 같은 인증 차단을 적용한다. 내부 삭제 재처리는 이 차단과 무관하게 계속되며 다른 계정·공급자의 데이터는 유지한다.

원격 성공이 확인되면 의도를 확인 완료로 기록하고 프로필·세션·의도를 함께 삭제한다. 원격 성공 직후 확인 기록 자체가 실패하거나 프로세스가 중단되어도 저장된 삭제 의도와 세션 차단은 유지된다. 재시도에서 이미 해제된 상태를 확인한 뒤 로컬 삭제를 완료한다. 확인 완료 기록 뒤 로컬 삭제가 실패하면 다음 처리는 원격 요청을 반복하지 않고 로컬 삭제를 재시도한다.

원격 결과가 불확실하거나 실패하면 삭제 요청은 502이며 자동 재시도 의도와 세션 차단이 유지된다. 시작 시와 매분, 한 번에 최대 10건을 직렬 재시도한다. 삭제 처리 중인 계정은 재로그인으로 복구하지 않으며 `deletion_pending`을 반환한다. 실패가 반복되면 운영자는 공급자 키·연결 상태와 전용 DB 상태를 확인해야 한다. 기존 DB를 덮어쓰는 복구는 삭제 사실을 되돌릴 수 있으므로 사용하면 안 된다.

카카오 웹훅은 동일 앱의 대표 어드민 키를 `Authorization: KakaoAK ...`로 보내야 한다. body는 `application/x-www-form-urlencoded`이며 정확한 `app_id`, 안전한 십진수 `user_id`를 확인한다. 예시 필드는 `app_id`, `user_id`, `referrer_type`이다. 유효한 미등록 회원·중복 통지는 200이다.

웹훅은 DB에 쓰기 전 `${WEB_DB_PATH}.unlink-inbox` 전용 디렉터리에 회원번호 하나만 원자적으로 기록하고 파일과 디렉터리를 fsync한다. 디렉터리 `700`, 파일 `600`이며 키·표시 이름·세션은 넣지 않는다. 같은 회원번호는 동일한 해시 파일명으로 중복 정리하고 최대 10,000개까지만 보관한다. DB 반영이 실패해도 durable inbox에 보관되면 3초 안에 200으로 수신을 확인한다. Linux 운영 기준으로 파일과 디렉터리를 동기화하며 Windows 테스트에서는 디렉터리 fsync를 제외한다.

남은 inbox는 시작 시와 매분 최대 10개씩 처리한 후 제거한다. 이 디렉터리와 DB는 서비스 프로세스 하나만 사용해야 한다. 원자적 파일 교체 전에 중단되어 남은 임시 파일은 성공 응답을 보내기 전의 미완료 쓰기이므로 재시작 때 제거한다. 해당 회원의 세션은 더 이상 인증된 것으로 반환하지 않고, 같은 공급자의 신규 로그인도 큐 처리 전까지 보류한다. 큐가 남으면 health는 503이다. DB와 inbox가 모두 실패한 경우에는 `503 storage_unavailable`을 반환하여 수신하지 못한 이벤트에 성공 응답을 보내지 않는다. 디스크 전체 장애·프로세스 중단 상태에서 200 수신 확인까지 보장할 수는 없다. 운영자는 503이 있었다면 공급자 전달 여부를 확인하고 재처리해야 한다. DB를 복구할 때 inbox도 반드시 보존한다.

탈퇴가 완료되거나 외부 해제를 수신하면 해당 공급자의 진행 중 인가 거래를 무효화한다. 회원번호를 추가로 보관하지 않고도 처리 중 콜백이 탈퇴 계정을 다시 생성하는 것을 막기 위한 공급자별 세대 번호를 사용한다. 그 순간 로그인 중이던 같은 공급자의 다른 사용자는 로그인을 다시 시작해야 할 수 있다. 제공되는 웹훅에는 사건 시각·고유 사건 ID가 없어, 해제 후 재가입 사이의 지연·중복 통지는 별도로 구분할 수 없다.

SQLite secure delete와 삭제 후 WAL checkpoint를 사용한다. 운영 백업·스냅샷에 별도로 남은 개인정보의 파기는 운영 보관 정책에서 함께 처리해야 한다. 서비스 삭제만으로 외부 백업이나 저장장치의 물리적 삭제를 보장하지 않는다.

## 공급자 콘솔

- Discord callback: `https://pogeunhaeyong.duckdns.org/auth/discord/callback`
- Kakao callback: `https://pogeunhaeyong.duckdns.org/auth/kakao/callback`
- Kakao 연결 해제 웹훅: `POST https://pogeunhaeyong.duckdns.org/api/auth/kakao/unlink`

카카오 로그인은 사용 설정을 ON으로 하고 닉네임 동의항목을 설정한다. REST 키·시크릿·대표 어드민 키·숫자 앱 ID는 모두 같은 앱의 값이어야 한다. 리다이렉트와 웹훅을 원본 운영 앱에 등록한다. 테스트 앱은 앱 멤버만 사용할 수 있으므로 운영 앱 대신 사용할 수 없다.

공식 근거: [Discord OAuth2](https://docs.discord.com/developers/topics/oauth2), [Discord PKCE](https://docs.discord.com/developers/discord-social-sdk/development-guides/account-linking-on-mobile), [카카오 REST API](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [카카오 REST PKCE](https://devtalk.kakao.com/t/oauth2-pkce/144590), [회원 탈퇴](https://developers.kakao.com/docs/ko/kakaologin/common), [연결 해제 웹훅](https://developers.kakao.com/docs/ko/kakaologin/callback), [이미 연결 해제된 회원](https://devtalk.kakao.com/t/topic/148225).

## 길드 가입과 관리자

일반 Discord 로그인은 `identify`만 요청한다. 자동 승인이 활성화된 Discord 회원은 KOR Lost ARK에서 인증한 대표 캐릭터명으로 신청하면 별도의 `identify guilds.members.read` 동의로 이어진다. 기존 pending 신청에는 재시도 버튼을 제공한다. `/auth/discord/callback`에서 기존 홈페이지 사용자·Discord 고유 ID·활성 세션·신청 revision과 캐릭터명이 그대로인지 확인하며 세션을 새로 만들거나 다른 Discord 계정을 결합하지 않는다. 공급자가 반환한 scope도 확인한다.

별도 확인은 인증 서버의 지정 역할, 서버가 관리하는 별명과 신청 캐릭터명의 일치, 로스트아크 프로필의 캐릭터명·루페온·포근해 소속을 모두 요구한다. 임의 별명이나 부캐명을 인정하지 않는다. 서버 별명을 사용자가 자유롭게 바꿀 수 없고 공식 변경도 인증된 게임 계정의 캐릭터로 제한된다는 운영 전제가 필요하다. 토큰은 조회에만 사용하고 저장하지 않는다. 취소·조회 실패·불일치는 pending을 유지하며 게임 내 수동 확인도 가능하다. 카카오는 기존 수동 확인만 제공한다.

자동 승인 거래는 5분 안에 한 번만 소비하며 사용자·세션·브라우저 결합 쿠키·state·PKCE·신청 revision과 캐릭터에 묶는다. 외부 응답 후에도 세션 만료·로그아웃·탈퇴·신청 변경·관리자 검토를 다시 검사한다. 관리자 거절·열람 철회를 받은 계정은 다시 신청해도 자동 승인되지 않고 수동 심사를 받아야 한다. 이 표시와 거래는 계정 탈퇴 시 함께 삭제한다. 자동 승인으로 관리자나 최고관리자 권한을 부여하지 않는다.

신청자의 일회용 번호는 본인 상태 응답에만 포함한다. 신청한 캐릭터로 실제 게임에서 관리자에게 번호를 전달하고, 관리자는 발신 캐릭터를 확인한 뒤 번호와 확인 항목을 제출해야 승인할 수 있다. 번호는 30분 만료, 60초 재발급 제한, 오류5회 잠금을 적용한다. 재발급은 revision을 증가시켜 이전 화면의 승인을 거부하며, 같은 캐릭터가 두 홈페이지 계정에서 동시에 승인되지 않도록 고유 제약을 둔다. 만료 번호는 기존 정기 정리에서 삭제하며 심사 종료·탈퇴 때도 제거한다. 게임사의 공식 계정 소유 인증을 제공하는 것은 아니다.

`GET /api/auth/guild`는 본인의 신청 상태와 역할을 반환한다. 신청·심사·관리자 변경과 일정 시트 경로는 [명세](../specs/guild-access.md)에 정의한다. 일반 로그인만으로 길드 자료를 열 수 없으며 승인 상태를 매 요청 확인한다. 관리자 변경과 심사는 같은 트랜잭션에서 행의 revision과 현재 권한을 재확인한다. 쓰기 요청은 Origin·CSRF·정확한 JSON 필드와 1 KiB 제한을 적용하고 IP별 10분 60회로 제한한다. 모든 길드 응답은 캐시하지 않는다.

초기 최고관리자는 자동으로 만들지 않는다. 사용자가 선택한 공급자와 현재 홈페이지 계정 UUID를 실제 로그인에서 확인한 뒤 서비스를 정지하고 전용 실행 계정으로 지정한다. 비밀키나 공급자 회원번호를 입력할 필요는 없다.

```sh
node src/guild-owner.js /absolute/private/auth.sqlite ACCOUNT_UUID discord --service-stopped
```

카카오 계정이면 `discord` 대신 `kakao`를 사용한다. 확인된 UUID로 치환하며 표시 이름으로 찾거나 임의의 첫 계정을 지정하면 안 된다. 명령은 DB 버전4, 실제 계정·공급자 일치, 기존 최고관리자 없음, 처리할 unlink 이벤트 없음, 비공개 저장 권한을 확인한다. `--service-stopped`는 운영자가 실제 서비스 정지를 확인했다는 입력이며 명령 자체가 서비스를 정지시키지는 않는다. 탈퇴한 최고관리자를 복구할 때도 사용자가 새 계정을 지정한 뒤 같은 절차를 따른다. 단순 재시작 때 이 명령을 반복 실행하지 않는다.

시트는 승인된 요청에만 고정된 Google 읽기 전용 preview 주소를 반환한다. 원본 공유 설정을 바꾸지 않으므로 원본 링크를 직접 전달받은 사람의 접근까지 제한하지 않는다. 승인 철회 후 다음 보호 API 요청은 거부하며 화면은 다시 표시될 때와 60초마다 재확인한다. 이전에 전달된 내용이나 링크를 원격으로 회수할 수 있다고 표시하지 않는다.

DB 버전1·2·3에서4로 users와 sessions를 변경하지 않고 길드 테이블·승인 캐릭터 고유 인덱스와 수동 심사 기록용 트리거를 원자적으로 추가한다. v4는 기존 길드 테이블3개 외에 guild_manual_reviews와 guild_auto_transactions를 사용하며 사용자 삭제를 FK cascade로 처리한다. 이전 중복 승인 기록은 자동 덮어쓰기 없이 전환을 중단한다. 이전 거절·철회와 pending revision>1은 과거 심사 여부를 확정할 수 없어 수동 심사 대상으로 이관한다. 번호만 재발급한 이전 pending도 수동 확인이 필요할 수 있다. revision1의 최초 신청은 자동 승인 조건을 확인할 수 있다.

배포 전에 웹 서비스를 정지하고 SQLite·WAL·SHM·unlink inbox 전체를 비공개 백업한다. 앱·정적 파일을 함께 전환하고 기존 세션·health·가입 상태를 확인한다. 이전 앱은 DB 4를 거부하므로 코드만 원복하지 않는다. 복구는 최신 DB와 inbox를 별도 보존한 상태에서 서비스 정지 후 `PRAGMA foreign_key_check`가 빈 결과인지 확인하고 `PRAGMA user_version=1`(기존 인증 앱) 또는 `3`(수동 번호 앱)으로 되돌린 뒤 해당 이전 앱·정적 파일을 실행한다. 추가된 테이블·인덱스·트리거를 삭제하거나 전환 전 DB로 덮어쓰지 않는다. 기존 앱의 사용자 삭제도 FK cascade를 적용하므로 새 탈퇴를 되살리지 않는다. 수동 번호 앱의 거절·철회도 남겨 둔 트리거가 기록한다. 이후 재전환하면 남아 있는 길드 상태와 수동 심사 표시를 유지한다. 이 절차는 기존 인증 테이블이 변경되지 않은 이번 버전에만 적용한다.

## 검증 범위

테스트는 임시 SQLite와 실제 로컬 HTTP 서버를 사용하고 공급자 통신만 고정 응답으로 대체한다. 양 공급자 정상 흐름, PKCE, 상태 결합·재사용·만료, 동시성, 재시작·세션 만료, CSRF, 공급자 실패·크기·시간 제한, 제한 횟수, 탈퇴·웹훅·복구를 확인한다. 실제 공급자 동의 화면과 운영 인증 왕복은 별도 검증이 필요하다.
