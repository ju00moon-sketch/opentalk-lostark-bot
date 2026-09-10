# 길드 가입과 일정 시트

소셜 첫 로그인은 홈페이지 회원가입이다. 디스코드와 카카오는 별도 계정이며 자동으로 합치지 않는다. 로그인한 회원은 대표 캐릭터명(공백 없는 한글·영문·숫자 2~12자)으로 길드 가입을 신청한다. Discord 자동 승인이 활성화된 경우 KOR Lost ARK에서 인증한 대표 캐릭터명으로 신청하고 추가 동의를 거쳐 승인 조건을 확인한다. 카카오와 수동 확인이 필요한 회원은 게임에서 관리자에게 일회용 번호를 전달한다. 승인 뒤 길드 일정 시트를 홈페이지에서 볼 수 있다. 원본 Google 공유 설정은 유지하므로 원본 링크의 공개 범위까지 제한하지 않는다.

## 디스코드 자동 승인

일반 로그인은 identify scope를 유지한다. 신규 신청을 pending으로 저장한 뒤 별도 동의로 이동하며, 기존 pending에는 재시도 버튼을 제공한다. 추가 scope는 identify와 guilds.members.read이며 공급자가 반환한 scope에도 둘 다 있어야 한다. 같은 홈페이지 사용자·활성 세션·Discord 고유 ID를 확인하며 다른 계정으로 바꾸거나 연결하지 않는다.

Discord의 본인 회원 API에서 KOR Lost ARK 서버(660684739056762891)의 루페온 역할(697681987850338314)과 비어 있지 않은 서버 별명을 확인한다. 서버 별명은 신청 캐릭터와 일치해야 한다. 로스트아크 공식 프로필의 CharacterName도 같고 ServerName은 루페온, GuildName은 포근해여야 승인한다. 이름은 NFC와 영문 소문자로 정규화하며 서버·길드는 NFC 후 정확히 비교한다. 전역 별명·임의 입력·역할만으로 승인하지 않는다. 사용자가 서버 별명을 자유롭게 바꿀 수 없고 공식 변경도 인증된 게임 계정의 캐릭터만 허용한다는 전제에 의존한다. 별도 부캐 조회는 하지 않는다.

5분 거래는 state·PKCE·브라우저 결합 쿠키·회원·현재 세션·신청 revision과 캐릭터명을 묶고 한 번만 원자적으로 소비한다. 토큰은 저장하지 않는다. 고정 Discord/로스트아크 API만 호출하고 각 요청은 8초와 64KiB JSON 상한 및 리다이렉트 거부를 적용한다. 외부 응답 후에도 사용자 차단·탈퇴·로그아웃·세션 만료·신청 변경·관리자 검토를 트랜잭션에서 재확인한다. 취소·실패·불일치는 pending을 유지하며 일정 권한을 열지 않는다. 관리자 거절·열람 철회 후 재신청은 계정이 유지되는 동안 자동 승인을 차단하고 수동 심사를 요구한다. 자동 승인으로 관리 권한을 주지 않는다.

기능 활성 값·인증 서버 ID·역할 ID·로스트아크 API 키와 기존 Discord OAuth 설정이 모두 있어야 활성화한다. 비활성일 때 기존 응답과 게임 내 수동 확인을 유지한다. 카카오 계정은 자동 병합 없이 수동 확인한다.

## 게임 내 확인

인증번호는 신청자 본인에게만 표시하는 8자리 숫자이며 30분 동안 유효하다. 관리자의 목록이나 응답에는 예상 번호를 제공하지 않는다. 관리자는 게임에서 받은 번호를 입력하고 발신 캐릭터를 직접 확인했다는 항목에 체크해야 승인할 수 있다. 홈페이지·외부 메신저에서 받은 번호만으로 승인하지 않도록 안내한다. 닉네임 공개 조회나 소셜 로그인만으로 캐릭터 주인임을 확인할 수 없으며, 이 절차를 게임사의 공식 계정 소유 인증으로 표시하지 않는다.

발급 후 60초부터 새 번호를 받을 수 있다. 재발급하면 이전 번호가 즉시 무효가 되고 신청 revision이 증가한다. 잘못된 번호는 최대 5회까지 확인하며 이후에는 재발급이 필요하다. 오류 횟수와 만료는 서버가 판단하고 재시작 후에도 유지한다. 같은 캐릭터명은 대소문자를 구분하지 않고 한 홈페이지 계정에서만 승인할 수 있다. 중복 신청은 심사할 수 있으나 이미 승인된 다른 계정이 있으면 승인을 거부하며 자동 병합하지 않는다.

인증번호는 승인·거절·철회·탈퇴 때 제거하며, 재발급하면 교체한다. 만료 후에는 사용할 수 없고 정기 정리 때 삭제한다. 최초 최고관리자 지정은 별도의 사용자 계정 확인 절차로 처리한다. 실제 게임에서 캐릭터를 조작해 번호를 전달했는지는 관리자의 확인에 의존하며 계정 공유·대리 조작까지 구분하지는 못한다.

## 권한과 화면

- 일반 회원: 본인 신청과 상태 확인. 미신청·거절·철회 상태에서 다시 신청할 수 있다. 심사 중·승인 상태의 신청은 덮어쓰지 않는다.
- 승인 회원: 읽기 전용 시트와 새 창 열기. 원본 데이터를 홈페이지 정적 파일에 포함하지 않는다.
- 관리자: 신청 목록과 승인·거절·열람 철회. 다른 관리자나 최고관리자의 권한을 변경할 수 없다.
- 최고관리자: 위 기능과 승인 회원의 관리자 부여·회수. 홈페이지에서 최고관리자를 추가하거나 본인을 강등할 수 없다.
- 최초 최고관리자는 사용자가 확인한 현재 계정 UUID로 비공개 운영 명령에서 한 번 지정한다. 기존 최고관리자가 있으면 거부한다. 탈퇴로 최고관리자가 없어졌다면 같은 확인 절차로 복구한다.
- 회원 탈퇴와 카카오 연결 해제는 신청과 관리자 권한도 삭제한다. 재가입은 미승인 상태다. 디스코드 서버 가입이나 봇 출석 기록에는 영향이 없다.

## API 계약

모든 경로는 기존 프록시의 `/api/auth/guild` 아래에 둔다. 기존 세션·탈퇴 의도·연결 해제 차단 관문을 재사용한다. 응답은 `no-store`, 쓰기는 Origin·CSRF와 정확한 JSON 필드를 검증한다. 오류는 `{error}`이며 401 로그인 필요, 403 권한 없음, 409 상태 변경 충돌, 400 잘못된 입력, 429 요청 제한, 503 저장 오류다.

- `GET /api/auth/guild`: `{role, membership, canViewSheet, verification}`. role은 `member|admin|owner`. membership은 null 또는 `{status,characterName,revision,appliedAt,reviewedAt}`. status는 `pending|approved|rejected|revoked`. verification은 null 또는 `{code,expiresAt,reissueAt,serverNow,attemptsRemaining}`이며 본인 pending 상태에만 반환한다. 시간은 epoch milliseconds, code는 8자리 문자열이며 만료/잠금이면 null이다. 화면은 serverNow와 수신 뒤 단조 증가 경과 시간을 기준으로 만료·재발급을 표시하며 브라우저 시계 설정에 의존하지 않는다. 정리되어 번호가 없는 상태와 만료 상태는 모두 새 번호 발급을 안내한다.
- `POST /api/auth/guild/automatic`: 정확히 `{revision}` → `{authorizationUrl}`. 활성 설정의 자격 있는 Discord pending 회원만 추가 동의를 시작한다. 동의 후 기존 `/auth/discord/callback`에서 전용 거래를 처리하고 `/account.html?guild_auto=approved` 또는 `?error=automatic_...`로 돌아온다. 세션은 교체하지 않는다.
- `POST /api/auth/guild/apply`: `{characterName}` → 같은 본인 상태 응답.
- `POST /api/auth/guild/verification`: `{revision}` → 새 번호가 포함된 본인 상태. pending 본인만 재발급하며 60초 제한과 revision 검사를 적용한다.
- `GET /api/auth/guild/sheet`: 승인/운영자만 `{title,url,embedUrl}`. 새 창 url도 읽기 전용 preview를 사용한다.
- `GET /api/auth/guild/members?status=pending&cursor=<uuid>`: 관리자만 `{items,nextCursor}`. status 생략은 전체, 한 페이지 25명. 각 행은 `{userId,provider,displayName,role,status,characterName,revision,appliedAt,reviewedAt}`.
- `POST /api/auth/guild/review`: 승인에는 `{userId,status:'approved',revision,verificationCode,verifiedInGame:true}`, 거절/철회에는 `{userId,status,revision}`. pending → approved/rejected, approved → revoked. 최고관리자를 심사하거나 관리자 본인을 심사할 수 없다. 일반 관리자는 관리자 대상을 심사할 수 없다. 최고관리자의 관리자 열람 철회는 관리자 권한도 회수한다. 응답 `{ok:true}`.
- `POST /api/auth/guild/role`: 최고관리자만 `{userId,role,revision}`, role은 `member|admin`. approved 회원만 승격, 최고관리자 본인 변경 불가. 응답 `{ok:true}`.

자동 승인이 활성화되면 본인 상태 응답에 `automaticApproval:{enabled:true,eligible,reason}`을 추가한다. reason은 null 또는 discord_required·manual_required·not_pending·state_changed이며 설정 비활성 때 필드는 생략한다. 시작 단계는 automatic_unavailable(503), automatic_discord_required/automatic_manual_required(403), automatic_not_pending/automatic_state_changed(409) 등으로 거부한다. 콜백 오류는 automatic_cancelled, automatic_permission_denied, automatic_identity_mismatch, automatic_role_missing, automatic_character_mismatch, automatic_guild_mismatch, automatic_membership_missing, automatic_rate_limited, automatic_unavailable, automatic_state_changed, automatic_manual_required 등 고정 코드만 전달한다. 외부 본문·토큰은 전달하지 않으며 사용자는 다시 확인하거나 수동 심사를 받을 수 있다.

목록의 revision은 신청·심사·역할 변경·번호 재발급 때 증가한다. 번호 오류는 verification_invalid(400), 만료는 verification_expired(409), 번호 없음은 verification_required(409), 5회 잠금은 verification_locked(429), 빠른 재발급은 verification_cooldown(429), 이미 승인된 캐릭터는 character_already_verified(409)로 구분한다. 오래된 화면의 변경은 409로 거부하며 다시 조회하도록 안내한다. 허용된 전이와 권한은 같은 SQLite 트랜잭션에서 다시 검사한다. 읽기 전용 시트는 원본 공개 설정을 유지한 preview iframe으로 보여주며 새 창 보기를 제공한다. 이미 전달된 원본 링크의 접근까지 철회할 수 있다고 표시하지 않는다.

GitHub Pages의 `/opentalk-lostark-bot/`는 공개 안내 사본이다. 계정·길드 링크는 운영 홈페이지의 고정 주소로 연결하며, Pages에서 계정·길드 페이지를 직접 열면 쿼리와 해시를 전달하지 않고 해당 운영 페이지로 이동한다. Pages 사본은 인증 API를 호출하지 않는다.

## 저장과 복구

기존 users/sessions 구조와 데이터를 유지하고 FK cascade를 갖는 guild_memberships, guild_roles, guild_verifications, guild_manual_reviews, guild_auto_transactions와 승인 캐릭터 고유 인덱스를 사용한다. DB 버전 1·2·3에서 4로 한 트랜잭션에서 전환한다. 이전 중복 승인 기록이 있으면 데이터를 덮어쓰지 않고 전환을 중단한다. 거절·철회와 pending revision>1인 이전 회원은 과거 심사 여부를 알 수 없어 수동 심사 표시를 남긴다. 번호만 재발급한 이전 회원도 수동 심사가 필요할 수 있다. 최초 pending revision1은 자동 승인 조건을 확인할 수 있다.

구 코드는 버전4를 거부하므로 코드만 원복하지 않는다. 서비스 정지 후 DB·WAL·SHM·unlink inbox를 비공개 백업한다. 복구할 때도 최신 DB·inbox를 보존하고, 서비스가 정지한 상태에서 FK 검사를 통과한 현재 DB의 user_version만 1(기존 인증 앱) 또는 3(수동 번호 앱)으로 되돌린 뒤 해당 이전 앱·정적 파일을 실행한다. 추가 테이블·인덱스·트리거와 현재 계정 데이터는 그대로 둔다. 기존 앱의 탈퇴가 FK cascade로 새 테이블을 삭제하며 수동 번호 앱의 거절·철회도 트리거로 기록된다. 이후 버전4로 재전환하면 남은 상태를 유지한다. 인증 테이블이 그대로인 이번 버전에만 적용하는 복구 절차다.

## 구현 순서와 검증

1. 저장·권한·버전 전환 테스트부터 추가하고 schema, 트랜잭션, 최초 지정 CLI를 구현한다.
2. HTTP 진입점에서 세션·CSRF·역할 행렬, 상태 충돌, 삭제 의도·unlink 차단, 탈퇴 후 재가입을 검사한다.
3. 계정 화면에 회원가입 안내와 길드 신청/상태, 길드 페이지에 시트와 관리자 목록을 구현한다. 작은 화면·키보드·만료/권한 철회·오류 표시를 검증한다.
4. 기존 소셜 인증 전체 테스트를 실행하고, 독립 검토자가 최종 코드·실패 경로·복구 전제를 직접 확인한다.
5. 실제 최고관리자 계정 확인과 운영 적용은 검토된 결과와 사용자 승인 범위에서 진행한다. 합성 UI/로컬 HTTP와 실제 운영 검증은 구분한다.
