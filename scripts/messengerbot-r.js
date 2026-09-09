// 포근해용 — 카카오톡 오픈채팅방 브리지 (메신저봇R 스크립트)
//
// 이 파일 내용으로 메신저봇R 앱의 기존 브리지 스크립트를 교체하고, 아래 두 값을 유지한 뒤 컴파일·활성화하면 된다.
// 처음 설치한다면 새 스크립트 하나에 붙여 넣고 두 값을 채운다. 같은 브리지 스크립트를 여러 개 활성화하지 않는다.
//   1) SERVER : 봇 서버 주소 + 비밀 경로   예: "http://서버주소/bridge/message/비밀경로"
//   2) ROOMS  : (선택) 봇이 반응할 방 제목 목록. 비워 두면([]) 봇 계정이 들어가 있는 모든 방·1:1 채팅에서 동작한다.
//               방을 옮기거나 제목을 바꿔도 손댈 게 없도록 기본은 비움. 특정 방만 원하면 ["포근해"]처럼 적는다.
//
// 동작: "/"·"."로 시작하는 커맨드, 접두사 없는 "ㅂㅂㄱ"·"ㅂㅆㅇㄱ"·"ㅊㅊ"와 단독 "한마디"·"ㅎㅁㄷ", "["로 시작하는 이모티콘만 서버에 보내고,
//       서버가 준 답을 그 방에 쓴다. 나머지 메시지는 서버로 보내지 않는다. 답은 최대 30초까지 기다린다.
//       이미지(캐릭터·체방 차트·이모티콘)는 폰 봇이 그림을 못 보내므로 미리보기 카드 링크(link)로 먼저 보내고 본문(text)을 이어 보낸다.
//       /등록은 보낸 사람의 카톡 닉네임에 묶인다 — 닉네임을 바꾸면 다시 /등록.
//       자동 알림은 한국 시간 수요일에 게시된 공지·상점·이벤트·점검을 그날 묶어 보낸다. 60초마다 서버를 확인한다.
//       ROOMS 범위에서 실제 카톡 알림을 받은 단체방만 기억하며, 첫 연결에도 그 수요일 당일 공지는 한 번 보낸다.
//       한 메시지는 1,500자 이하이며 묶음 안에서 최신 공지가 위에 온다. 다른 날짜의 공지는 보내지 않는다.
//       방별 진행 기록은 앱 내부에 저장한다. 재컴파일 후에도 이어지지만, 재부팅 후에는 방 알림을 다시 받아야 답장할 수 있다.
//       저장 오류가 나면 자동 알림만 중단한다. 앱 로그를 확인하며, 기록을 임의로 지우지 않는다.
//       자동 알림만 끄려면 AUTO_UPDATES = false로 바꾼 뒤 재컴파일한다. 다시 true로 바꿔 재컴파일하면 재개한다.
//
// 폰 준비:
//   메신저봇R 설치 → 앱에서 알림 접근 권한 허용 → 카카오톡 알림(내용 미리보기 포함) 켜기 →
//   봇 계정으로 오픈채팅방 참여(방 알림도 켜 두기) → 배터리 최적화에서 메신저봇R·카카오톡 제외(안 하면 화면 꺼진 뒤 멈춘다)

var SERVER = "http://서버주소/bridge/message/비밀경로";
var ROOMS = [];
var AUTO_UPDATES = true;

var TIMEOUT_MS = 30000;

// SERVER를 아직 안 채웠으면 방에 그 사실을 알린다 — 파일을 그대로 붙여 넣으면 자리표시자가 남는다
var SERVER_NOT_SET = SERVER.indexOf("서버주소") !== -1 || SERVER.indexOf("비밀경로") !== -1;

var UPDATE_INTERVAL_MS = 60000;
var UPDATE_TIMEOUT_MS = 10000;
var UPDATE_MAX_BODY = 1048576;
var UPDATE_MAX_MESSAGE = 1500;
var UPDATE_HEADER = "❕ 로스트아크 공지사항\n\n";
var updateTimer = null;
var updateLock = null;
var updateBusy = null;
var updateStopped = null;
var updatePrefs = null;
var updateState = null;
var updateBlocked = false;

function updateLog(message) {
  try { Log.e("포근해용 업데이트 알림: " + message); } catch (ignored) {}
}

function updateInteger(value) {
  return typeof value === "number" && isFinite(value) && value >= 0 && value <= 9007199254740991 && Math.floor(value) === value;
}

function updateRoomAllowed(room) {
  return typeof room === "string" && room.length > 0 && (ROOMS.length === 0 || ROOMS.indexOf(room) !== -1);
}

// 이 함수와 저장·발송은 updateLock을 잡은 상태에서만 실행한다.
function loadUpdateState() {
  if (updateBlocked) return false;
  if (updateState !== null) return true;
  try {
    updatePrefs = Api.getContext().getSharedPreferences("pogeun-update-notify", 0);
    var raw = updatePrefs.getString("state", null);
    if (raw === null) {
      updateState = { version: 1, rooms: [] };
      return true;
    }
    raw = String(raw);
    if (raw.length > UPDATE_MAX_BODY) throw new Error("state-size");
    var state = JSON.parse(raw);
    if (!state || state.version !== 1 || !Array.isArray(state.rooms)) throw new Error("state-format");
    for (var i = 0; i < state.rooms.length; i++) {
      var item = state.rooms[i];
      if (!item || typeof item.name !== "string" || !item.name.length || !updateInteger(item.cursor) || (item.blocked !== undefined && typeof item.blocked !== "boolean")) throw new Error("state-room");
      for (var j = 0; j < i; j++) if (state.rooms[j].name === item.name) throw new Error("state-duplicate");
    }
    updateState = state;
    return true;
  } catch (ignored) {
    updateBlocked = true;
    updateLog("저장 기록을 읽을 수 없어 자동 발송을 중단했습니다.");
    return false;
  }
}

function saveUpdateState() {
  try {
    var rooms = [];
    for (var i = 0; i < updateState.rooms.length; i++) {
      if (updateState.rooms[i].cursor !== null) rooms.push(updateState.rooms[i]);
    }
    var raw = JSON.stringify({ version: 1, rooms: rooms });
    if (raw.length > UPDATE_MAX_BODY || !updatePrefs.edit().putString("state", raw).commit()) throw new Error("state-write");
    return true;
  } catch (ignored) {
    // 전송 뒤 저장 실패여도 메모리의 진행점은 되돌리지 않는다. 다시 보내지 않고 중단한다.
    updateBlocked = true;
    updateLog("진행 기록을 저장하지 못해 자동 발송을 중단했습니다.");
    return false;
  }
}

function observeUpdateRoom(room, isGroupChat, packageName) {
  if (!updateLock || updateStopped.get() || !updateRoomAllowed(room)) return;
  updateLock.lock();
  try {
    if (updateStopped.get() || !loadUpdateState()) return;
    var isTarget = isGroupChat === true && packageName === "com.kakao.talk";
    for (var i = 0; i < updateState.rooms.length; i++) {
      var item = updateState.rooms[i];
      if (item.name !== room) continue;
      // 이름이 같은 개인방·다른 앱의 세션이 관측되면 단체방 알림을 다시 받을 때까지 보류한다.
      var shouldBlock = !isTarget;
      if (!!item.blocked !== shouldBlock) {
        item.blocked = shouldBlock;
        if (item.cursor !== null) saveUpdateState();
      }
      return;
    }
    if (!isTarget) return;
    // 서버가 준비된 첫 조회에서 그 수요일 당일 공지부터 시작한다. 준비 전에는 진행점을 추측하지 않는다.
    updateState.rooms.push({ name: room, cursor: null });
  } finally { updateLock.unlock(); }
}

function readUpdateFeed() {
  var url = SERVER.replace(/\/bridge\/message\//, "/bridge/updates/");
  if (url === SERVER) throw new Error("endpoint");
  var res = org.jsoup.Jsoup.connect(url)
    .ignoreContentType(true)
    .ignoreHttpErrors(true)
    .followRedirects(false)
    .timeout(UPDATE_TIMEOUT_MS)
    .maxBodySize(UPDATE_MAX_BODY)
    .method(org.jsoup.Connection.Method.GET)
    .execute();
  if (res.statusCode() !== 200) throw new Error("feed-http");
  var raw = String(res.body());
  if (raw.length > UPDATE_MAX_BODY) throw new Error("feed-size");
  var feed = JSON.parse(raw);
  if (!feed || feed.version !== 1 || typeof feed.ready !== "boolean" || !updateInteger(feed.cursor) || !Array.isArray(feed.events) || feed.events.length > 100 || (!feed.ready && feed.events.length)) throw new Error("feed-format");
  var previous = 0;
  for (var i = 0; i < feed.events.length; i++) {
    var item = feed.events[i];
    if (!item || !updateInteger(item.id) || item.id <= previous || item.id > feed.cursor || typeof item.text !== "string" || !item.text.length || item.text.length > 700 || !updateInteger(item.expiresAt) || !item.expiresAt) throw new Error("feed-event");
    previous = item.id;
  }
  return feed;
}

function canSendUpdate(event) {
  var now = new Date().getTime();
  return !updateStopped.get() && now < event.expiresAt && new Date(now + 9 * 60 * 60 * 1000).getUTCDay() === 3;
}

// 1: 진행 저장 완료, 0: 이 방만 다음 주기에 재시도, -1: 중지 또는 저장 실패.
function sendUpdateBatch(room, batch) {
  if (updateStopped.get() || updateBlocked) return -1;
  var texts = [];
  for (var i = batch.length - 1; i >= 0; i--) if (canSendUpdate(batch[i])) texts.push(batch[i].text);
  if (texts.length) {
    try {
      if (!Api.canReply(room.name)) return 0;
      if (updateStopped.get()) return -1;
      // 세션 확인 중 자정이 되거나 공지가 만료될 수 있어 보내기 직전에 다시 고른다.
      texts = [];
      for (var j = batch.length - 1; j >= 0; j--) if (canSendUpdate(batch[j])) texts.push(batch[j].text);
      if (texts.length && !Api.replyRoom(room.name, UPDATE_HEADER + texts.join("\n\n"), true)) return 0;
    } catch (ignored) { return 0; }
  }
  // replyRoom 성공은 전송 요청 성공이다. 카톡의 실제 도착 여부까지 알려 주지는 않는다.
  room.cursor = batch[batch.length - 1].id;
  return saveUpdateState() ? 1 : -1;
}

function pollUpdates() {
  if (!updateLock || updateStopped.get() || !updateBusy.compareAndSet(false, true)) return;
  try {
    updateLock.lock();
    try { if (!loadUpdateState() || updateStopped.get()) return; }
    finally { updateLock.unlock(); }
    var feed = readUpdateFeed();
    if (!feed.ready || updateStopped.get()) return;
    updateLock.lock();
    try {
      if (updateStopped.get() || updateBlocked) return;
      var rooms = updateState.rooms;
      var changed = false;
      for (var i = 0; i < rooms.length; i++) {
        if (rooms[i].cursor !== null && rooms[i].cursor > feed.cursor) return; // 서버 진행점이 되돌아가면 기록을 초기화하지 않는다.
      }
      for (var n = 0; n < rooms.length; n++) {
        if (rooms[n].cursor === null) {
          rooms[n].cursor = feed.events.length ? feed.events[0].id - 1 : feed.cursor;
          changed = true;
        }
      }
      if (changed && !saveUpdateState()) return;
      for (var r = 0; r < rooms.length; r++) {
        var room = rooms[r];
        if (room.blocked || !updateRoomAllowed(room.name)) continue;
        var failed = false;
        var batch = [];
        var batchLength = UPDATE_HEADER.length;
        for (var e = 0; e < feed.events.length; e++) {
          var item = feed.events[e];
          if (item.id <= room.cursor) continue;
          if (updateStopped.get()) return;
          if (!canSendUpdate(item)) {
            if (!batch.length) {
              room.cursor = item.id;
              if (!saveUpdateState()) return;
            }
            continue;
          }
          if (batch.length && batchLength + 2 + item.text.length > UPDATE_MAX_MESSAGE) {
            var result = sendUpdateBatch(room, batch);
            if (result < 0) return;
            if (result === 0) { failed = true; break; }
            batch = [];
            batchLength = UPDATE_HEADER.length;
          }
          batchLength += (batch.length ? 2 : 0) + item.text.length;
          batch.push(item);
        }
        if (!failed && batch.length) {
          var finalResult = sendUpdateBatch(room, batch);
          if (finalResult < 0) return;
          failed = finalResult === 0;
        }
        // 보관 기한이 지나 피드에서 빠진 공지도 이후 다시 보내지 않는다.
        if (!failed && room.cursor < feed.cursor) {
          room.cursor = feed.cursor;
          if (!saveUpdateState()) return;
        }
      }
    } finally { updateLock.unlock(); }
  } catch (ignored) {
    updateLog("조회하지 못했습니다. 다음 주기에 다시 확인합니다.");
  } finally { updateBusy.set(false); }
}

function onStartCompile() {
  if (updateStopped) updateStopped.set(true); // 진행 중인 HTTP 응답이 돌아와도 발송하지 않는다.
  if (updateTimer) { updateTimer.cancel(); updateTimer = null; }
  if (updateLock) { updateLock.lock(); updateLock.unlock(); }
}

function startUpdatePolling() {
  if (SERVER_NOT_SET || !AUTO_UPDATES) return;
  try {
    updateLock = new java.util.concurrent.locks.ReentrantLock();
    updateBusy = new java.util.concurrent.atomic.AtomicBoolean(false);
    updateStopped = new java.util.concurrent.atomic.AtomicBoolean(false);
    updateTimer = new java.util.Timer(true);
    updateTimer.schedule(new JavaAdapter(java.util.TimerTask, { run: pollUpdates }), UPDATE_INTERVAL_MS, UPDATE_INTERVAL_MS);
  } catch (ignored) {
    if (updateTimer) updateTimer.cancel();
    updateTimer = null;
    updateLock = null;
    updateLog("자동 조회를 시작하지 못했습니다.");
  }
}

startUpdatePolling();

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
  observeUpdateRoom(room, isGroupChat, packageName);
  if (!msg) return;
  var first = msg.charAt(0);
  var isBareAlias = /^\s*(?:ㅂㅂㄱ|ㅂㅆㅇㄱ|ㅊㅊ)(?:\s|$)/.test(msg) || /^\s*(?:한마디|ㅎㅁㄷ)\s*$/.test(msg); // 한마디는 단독 입력만 허용
  if (first !== "/" && first !== "." && first !== "[" && !isBareAlias) return; // "..." 같은 잡담은 서버가 커맨드가 아니면 침묵으로 처리한다
  if (SERVER_NOT_SET) {
    replier.reply("스크립트의 SERVER 값을 아직 채우지 않았어요. http://서버주소/bridge/message/비밀경로 형식으로 넣고 다시 컴파일해 주세요.");
    return;
  }
  try {
    var answer = askServer(room, sender, msg);
    if (answer.link) replier.reply(answer.link); // 카드 먼저 (엉뚱한 글자 없이 주소만 보내야 카톡이 카드로 접어 준다)
    if (answer.text) replier.reply(answer.text);
  } catch (e) {
    var why = String(e);
    if (why.indexOf("HTTP 404") !== -1) replier.reply("봇 서버에는 닿았지만 SERVER의 비밀 경로가 틀렸어요. 스크립트의 SERVER 값을 확인해 주세요.");
    else if (why.toLowerCase().indexOf("timed out") !== -1 || why.toLowerCase().indexOf("timeout") !== -1) {
      replier.reply("봇 서버의 응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.");
    } else {
      // 예외 원문에는 SERVER 주소와 비밀 경로가 들어갈 수 있어 방이나 기기 로그에 남기지 않는다.
      replier.reply("봇 서버에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
    }
    try { Log.e("포근해용 서버 연결 오류"); } catch (ignored) {}
  }
}
