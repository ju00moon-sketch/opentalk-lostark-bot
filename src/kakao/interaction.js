// 카카오 스킬 요청을 슬래시 인터랙션처럼 보이게 하는 어댑터 (text-commands.js의 TextInteraction과 같은 역할).
// 커맨드가 reply/editReply로 보낸 페이로드를 모아 두고, handler가 한 번에 카카오 응답으로 바꾼다.
export class KakaoInteraction {
  constructor(userKey, options = {}, { displayName } = {}) {
    this.platform = 'kakao';
    // 카카오 사용자 키에 접두사를 붙여 user-links.json에 디스코드 ID와 함께 저장한다.
    // 랭킹 집계는 스노플레이크만 골라 쓰므로 섞여도 영향이 없다.
    // displayName(오픈채팅방 브리지가 넘기는 카톡 닉네임)을 username에 넣어 두면 user-store의 resolveCharacter가
    // 디스코드와 똑같이 "등록 없으면 닉네임을 캐릭터명으로" 폴백한다. 1:1 채널 봇은 닉네임이 없어 그대로 undefined.
    this.user = { id: `kakao:${userKey}`, username: displayName || undefined };
    this.member = null;
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
