# 홈페이지 HTTPS와 소셜 로그인

## 범위와 구성

기존 Oracle 정적 홈페이지에 HTTPS와 Discord·카카오 소셜 로그인을 추가한다. 공개 안내 페이지는 로그인 없이 유지하며 세션 조회도 계정 페이지에서만 한다. 두 공급자 중 하나만으로 가입·로그인할 수 있다. 회원 영역은 공급자와 표시 이름, 로그인 상태·로그아웃·회원 탈퇴를 제공한다. 기존 봇 기록 연결·관리자 기능·계정 합치기는 이 단계의 기능이 아니다.

Nginx는 TLS와 정적 파일을 담당하고 /auth/ 및 /api/auth/만 127.0.0.1:8090의 별도 Node.js 24 서비스로 전달한다. 이 서비스는 전용 비권한 계정과 전용 SQLite 저장소를 사용하며 봇 경로에 접근하지 않는다. 운영 origin은 https://pogeunhaeyong.duckdns.org로 고정한다. 키·토큰·코드·쿠키를 정적 파일 또는 로그에 넣지 않는다.

## 인증 계약

- GET /auth/discord/start 또는 /auth/kakao/start: 준비된 공급자의 Authorization Code + S256 PKCE를 시작한다. 32바이트 무작위 state와 verifier를 만들고 공급자·브라우저 결합값·5분 만료를 DB에 저장한다. 콜백은 /auth/{provider}/callback으로 고정한다.
- 브라우저 결합 쿠키와 로그인 쿠키는 운영에서 __Host- 접두사, Secure, HttpOnly, SameSite=Lax, Path=/를 사용한다. 바인딩 및 세션은 최소 32바이트 무작위 값이고 DB에는 해시만 저장한다. 로그인 세션은 7일 절대 만료다.
- 콜백은 state 중복·누락·만료·다른 브라우저·다른 공급자를 거부하고, 정상 요청만 일회성으로 소비한다. 공급자 거절도 검증된 요청에만 처리한다. 코드를 서버에서 교환하고 토큰으로 본인 정보만 읽으며 토큰은 저장하지 않는다. 각 외부 요청은 8초 이내, 리다이렉트 금지, 응답 크기 제한, ID와 표시 이름 검증을 적용한다.
- Discord scope는 identify, Kakao scope는 profile_nickname만 요청한다. 회원 키는 (provider, providerId) 고유 제약이며 닉네임·이메일로 합치지 않는다. Kakao 숫자 ID가 안전한 정수 범위를 벗어나면 거부한다.
- 성공 시 이전 세션을 교체하고 /account.html로 303 이동한다. 오류는 허용된 짧은 오류 코드만 /account.html?error=...로 전달하며 외부 응답 내용을 노출하지 않는다. 미설정 공급자는 시작 불가로 표시한다.
- GET /api/auth/session: 항상 no-store. 비로그인은 {authenticated:false,providers:{discord:boolean,kakao:boolean}}. 로그인은 이에 authenticated:true, user:{id,provider,displayName}, csrfToken을 포함한다. 세션과 CSRF 비밀값은 로그에 남기지 않는다.
- POST /api/auth/logout: 운영 origin과 X-CSRF-Token을 확인한 뒤 현재 세션을 삭제하고 쿠키를 만료시킨다. 결과는 204. 외부 origin·누락 토큰·잘못된 세션은 거부한다.
- DELETE /api/auth/account: 같은 origin·CSRF·5분 이내 로그인한 세션을 확인한다. 오래된 세션은 401 reauthentication_required로 재로그인을 요구한다. Discord 회원은 본인 회원 정보와 모든 세션을 삭제한다. Kakao 회원은 서버 어드민 키로 연결 끊기 API를 호출하고 대상 ID가 일치하는 성공 응답을 확인한 뒤 삭제한다. 성공은 204, 공급자 실패는 502 provider_error, 저장 실패는 503 storage_unavailable이며 삭제하지 못한 요청을 성공으로 표시하지 않는다. 화면에서 삭제 범위를 확인하고 한 번 더 동의한 경우에만 요청한다.
- 카카오 탈퇴는 최소한의 처리 중 기록을 먼저 저장해 원격 해제 성공 뒤 중단되는 경우를 복구한다. 이 기록이 생긴 계정은 원격 응답과 확인 기록의 성공 여부에 관계없이 모든 세션·보호 API와 재가입을 차단하고 재시도한다. 기록 저장에 실패하면 원격 해제를 호출하지 않는다. 미완 처리 동안 health는 정상으로 표시하지 않는다. 공식 계약상 이미 해제된 사용자를 뜻하는 400/code -101만 성공한 해제와 동일하게 처리한다. 완료하면 해당 처리 기록도 제거한다.
- POST /api/auth/kakao/unlink: 카카오 어드민 키 Authorization을 상수 시간으로 확인하고 app_id와 user_id를 검증한다. 회원번호 하나를 전용 private inbox에 atomic rename·fsync로 보관한 뒤 회원·모든 세션·관련 처리 기록을 삭제한다. 정상 중복/알 수 없는 회원은 200이며 DB가 잠겨도 inbox에 보관되면 3초 이내 200으로 수신을 확인한다. DB와 inbox가 모두 실패할 때는 503으로 알린다. 남은 inbox는 시작·매분 최대 10건을 재처리하며 그 회원의 세션과 재가입을 차단한다. 본문 크기와 처리 시간을 제한하고 키·회원 ID는 로그에 기록하지 않는다. DB와 ${WEB_DB_PATH}.unlink-inbox를 함께 보존하고 운영 프로세스는 하나만 실행한다.
- GET /api/auth/health: 민감 정보 없는 ok 상태만 제공한다. 알 수 없는 경로는 404, 지원하지 않는 method는 405. 쿠키·헤더·본문·URL 크기를 제한한다. 인증 시작과 콜백은 IP별 횟수 및 전체 미완료 거래 수를 제한한다.

## 저장·실행

web/는 독립 패키지이며 봇 package·src 변경 없이 실행한다. node:sqlite를 사용하고 WAL·foreign_keys·busy_timeout, 생성 디렉터리700/DB600을 적용한다. 회원 생성·세션 발급과 만료 처리에는 트랜잭션을 사용한다. 동시 콜백이 같은 회원을 중복 생성하지 않도록 고유 제약을 둔다. 만료 거래·세션을 정기 정리한다. 운영에서는 HTTPS origin과 필요한 비밀값을 검증하며 임의 요청 Host를 신뢰하지 않는다.

환경 이름: WEB_ORIGIN, WEB_HOST(127.0.0.1), WEB_PORT(8090), WEB_DB_PATH, DISCORD_OAUTH_CLIENT_ID, DISCORD_OAUTH_CLIENT_SECRET, KAKAO_OAUTH_CLIENT_ID, KAKAO_OAUTH_CLIENT_SECRET, KAKAO_ADMIN_KEY, KAKAO_APP_ID. 카카오는 연결 해제까지 필요한 값이 모두 있어야 준비 상태로 표시한다. 테스트의 로컬 HTTP 허용은 명시적인 생성 함수의 테스트 옵션으로만 가능하며 운영 실행에서는 활성화하지 않는다.

## 화면·문서

현재 라운지 디자인을 유지한다. 홈페이지의 로그인 링크와 /account.html, 두 소셜 로그인 버튼, 로그인 처리 중/실패/미설정 안내, 로그인된 계정 카드·로그아웃·회원 탈퇴를 제공한다. 표시 이름은 textContent로 렌더하며 로그인마다 공급자에서 갱신한다. 현재 제공되는 계정 기능과 봇 기록 미연결을 설명한다. 개인정보 안내에는 실제 수집 정보(공급자 ID·표시 이름·가입/로그인 시각), 로그인 목적, 세션/진행 쿠키, 임시 접속 제한, 보관·직접 탈퇴 및 문의 연락처를 설명한다. 프로필 사진·이메일·친구 목록·외부 토큰은 저장하지 않는다. 카카오 버튼은 공식 제공 이미지의 심볼·문구·색상·비율을 유지하고 미설정 안내는 버튼 아래에 표시한다. 이미지 출처와 규칙은 [카카오 로그인 디자인 가이드](https://developers.kakao.com/docs/ko/kakaologin/design-guide)와 [공식 리소스](https://developers.kakao.com/tool/resource/login)를 따른다.

## HTTPS·배포

무료 ACME 인증서를 HTTP-01 webroot 방식으로 발급하고 Nginx443에 연결한다. 정적 페이지 HTTP는 고정 HTTPS 주소로 이동하되 기존 봇 HTTP 경로 및 IP 접속은 보존한다. API/인증 경로의 HTTP 요청은 인증 서비스에 전달하지 않는다. 갱신 후 nginx -t 통과 시에만 reload한다. 호스트 및 OCI443 규칙만 필요한 범위로 추가하고 기존 규칙을 보존한다.

사전 설정·파일·서비스 상태를 백업하고 단계별 검증 후 원자적 전환한다. 실패 시 새 웹 서비스/프록시만 복구하며 봇 상태를 덮어쓰거나 봇을 재시작하지 않는다. 새 DB는 소스 교체와 분리한다. 인증서와 키는 root 전용, 웹 서비스 자원·권한을 제한한다. Git 커밋·머지·푸시는 수행하지 않는다.

## 검증 계획

인증 HTTP 경로를 실제 로컬 서버와 가짜 공급자 응답으로 검증한다. 정상 두 공급자·거절·state 누락/위조/재사용/만료/브라우저 불일치·PKCE·공급자 실패/과대 응답·비밀 비노출·중복 가입·세션 만료·CSRF·로그아웃·재시작 후 지속성을 확인한다. 이는 실제 공급자 인증 성공과 구분한다. 배포 전 독립 보안 검토, HTTPS 인증서 체인/호스트/HTTP 이동/갱신 검증, 양 공급자의 실제 왕복 로그인과 로그아웃, PC·모바일 화면과 기존 봇 health를 확인한다. 외부 콘솔 인증이 막히면 준비·미완 범위를 구체적으로 기록하며 가능한 독립 작업을 계속한다.
