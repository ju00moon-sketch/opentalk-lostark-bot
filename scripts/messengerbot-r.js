// 포근해용 — 카카오톡 오픈채팅방 브리지 (메신저봇R 스크립트)
//
// 이 파일 내용을 메신저봇R 앱의 새 스크립트에 붙여 넣고, 아래 두 값만 채운 뒤 컴파일·활성화하면 된다.
//   1) SERVER : 봇 서버 주소 + 비밀 경로   예: "http://서버주소/bridge/message/비밀경로"
//   2) ROOMS  : (선택) 봇이 반응할 방 제목 목록. 비워 두면([]) 봇 계정이 들어가 있는 모든 방·1:1 채팅에서 동작한다.
//               방을 옮기거나 제목을 바꿔도 손댈 게 없도록 기본은 비움. 특정 방만 원하면 ["포근해"]처럼 적는다.
//
// 동작: "/"·"."로 시작하는 커맨드, 접두사 없는 "ㅂㅂㄱ", "["로 시작하는 이모티콘만 서버에 보내고,
//       서버가 준 답을 그 방에 쓴다. 나머지 메시지는 서버로 보내지 않는다. 답은 최대 30초까지 기다린다.
//       이미지(캐릭터·체방 차트·이모티콘)는 폰 봇이 그림을 못 보내므로 미리보기 카드 링크(link)로 먼저 보내고 본문(text)을 이어 보낸다.
//       /등록은 보낸 사람의 카톡 닉네임에 묶인다 — 닉네임을 바꾸면 다시 /등록.
//
// 폰 준비:
//   메신저봇R 설치 → 앱에서 알림 접근 권한 허용 → 카카오톡 알림(내용 미리보기 포함) 켜기 →
//   봇 계정으로 오픈채팅방 참여(방 알림도 켜 두기) → 배터리 최적화에서 메신저봇R·카카오톡 제외(안 하면 화면 꺼진 뒤 멈춘다)

var SERVER = "http://서버주소/bridge/message/비밀경로";
var ROOMS = [];

var TIMEOUT_MS = 30000;

// SERVER를 아직 안 채웠으면 방에 그 사실을 알린다 — 파일을 그대로 붙여 넣으면 자리표시자가 남는다
var SERVER_NOT_SET = SERVER.indexOf("서버주소") !== -1 || SERVER.indexOf("비밀경로") !== -1;

function askServer(room, sender, msg) {
  var body = JSON.stringify({ room: room, sender: sender, text: msg });
  var res = org.jsoup.Jsoup.connect(SERVER)
    .ignoreContentType(true)
    .ignoreHttpErrors(true)
    .header("Content-Type", "application/json; charset=utf-8")
    .requestBody(body)
    .timeout(TIMEOUT_MS)
    .method(org.jsoup.Connection.Method.POST)
    .execute();
  var status = res.statusCode();
  // 404면 주소는 닿았지만 비밀 경로가 틀린 것 — 서버가 평문 "not found"를 주므로 JSON으로 읽기 전에 가른다
  if (status !== 200) throw new Error("HTTP " + status + (status === 404 ? " (비밀 경로가 틀림)" : ""));
  return JSON.parse(res.body()); // { text, link } — .post().text()는 줄바꿈을 지워 버리므로 응답 원문을 그대로 받는다
}

// 메신저봇R 레거시 API — 메시지가 올 때마다 호출된다
function response(room, msg, sender, isGroupChat, replier, imageDB, packageName) {
  if (ROOMS.length > 0 && ROOMS.indexOf(room) === -1) return;
  if (!msg) return;
  var first = msg.charAt(0);
  var isBareBid = /^\s*ㅂㅂㄱ(?:\s|$)/.test(msg);
  if (first !== "/" && first !== "." && first !== "[" && !isBareBid) return; // "..." 같은 잡담은 서버가 커맨드가 아니면 침묵으로 처리한다
  if (SERVER_NOT_SET) {
    replier.reply("스크립트의 SERVER 값(17번째 줄)을 아직 채우지 않았어요. http://서버주소/bridge/message/비밀경로 형식으로 넣고 다시 컴파일해 주세요.");
    return;
  }
  try {
    var answer = askServer(room, sender, msg);
    if (answer.link) replier.reply(answer.link); // 카드 먼저 (엉뚱한 글자 없이 주소만 보내야 카톡이 카드로 접어 준다)
    if (answer.text) replier.reply(answer.text);
  } catch (e) {
    var why = String(e);
    if (why.indexOf("HTTP 404") !== -1) replier.reply("봇 서버에는 닿았지만 SERVER의 비밀 경로가 틀렸어요. 스크립트 17번째 줄을 확인해 주세요.");
    else if (why.toLowerCase().indexOf("timed out") !== -1 || why.toLowerCase().indexOf("timeout") !== -1) {
      replier.reply("봇 서버의 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.");
    } else {
      // 예외 원문에는 SERVER 주소와 비밀 경로가 들어갈 수 있어 방에는 보여 주지 않고 기기 로그에만 남긴다.
      replier.reply("봇 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    try { Log.e("포근해용 서버 오류: " + e); } catch (ignored) {}
  }
}
