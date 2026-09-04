// 조회 결과 아래에 붙는 후속 조회 버튼 (디스코드 전용 기능).
// customId "run:커맨드명:닉네임" → index.js의 버튼 핸들러가 해당 커맨드를 실행한다.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export function characterButtons(characterName, commandNames) {
  const row = new ActionRowBuilder();
  for (const cmd of commandNames) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`run:${cmd}:${characterName}`)
        .setLabel(cmd)
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return [row];
}

// 캐릭터 없이 커맨드만 실행하는 버튼 (예: /랭킹 ↔ /체급). customId "cmd:커맨드명"
export function commandButtons(items) {
  const row = new ActionRowBuilder();
  for (const { cmd, label } of items) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`cmd:${cmd}`)
        .setLabel(label ?? cmd)
        .setStyle(ButtonStyle.Secondary),
    );
  }
  return [row];
}

// 옵션 몇 개를 실은 버튼 (예: 랭킹 쪽 넘김). customId "opt:커맨드명:이름=값&이름=값" — 값은 URL 인코딩.
// disabled 버튼은 현재 위치 표시용(누를 수 없다).
export function optionButtons(cmd, items) {
  const row = new ActionRowBuilder();
  for (const { label, options, disabled = false, style = ButtonStyle.Secondary } of items) {
    const query = Object.entries(options ?? {})
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    row.addComponents(
      new ButtonBuilder().setCustomId(`opt:${cmd}:${query}`).setLabel(label).setStyle(style).setDisabled(disabled),
    );
  }
  return [row];
}

// "이름=값&이름=값" → { 이름: 값 } (값은 문자열 그대로)
function parseQuery(query) {
  const out = {};
  for (const pair of String(query ?? '').split('&')) {
    if (!pair) continue;
    const at = pair.indexOf('=');
    const key = decodeURIComponent(at === -1 ? pair : pair.slice(0, at));
    out[key] = at === -1 ? '' : decodeURIComponent(pair.slice(at + 1));
  }
  return out;
}

// 슬래시 옵션 흉내 — 버튼에 새겨진 값들로 고정한다. 정수·숫자는 문자열에서 바꿔 준다.
const fakeOptions = (values) => {
  const get = (name) => (name in values ? values[name] : null);
  return {
    getString: (name) => (get(name) === null ? null : String(get(name))),
    getInteger: (name) => { const n = Number(get(name)); return get(name) !== null && Number.isInteger(n) ? n : null; },
    getNumber: (name) => { const n = Number(get(name)); return get(name) !== null && Number.isFinite(n) ? n : null; },
    getBoolean: (name) => (get(name) === null ? null : String(get(name)) === 'true'),
    getChannel: () => null,
    getSubcommand: () => null,
  };
};

// 버튼 인터랙션이면 해당 커맨드를 실행한다. 처리했으면 true.
export async function handleButton(interaction, commandMap) {
  const raw = interaction.customId;
  const [tag, cmdName] = raw.split(':');
  const rest = raw.slice(tag.length + 1 + (cmdName?.length ?? 0) + 1); // 세 번째 칸 이후 전부 (값에 ':'가 있어도 안전)
  const command = commandMap.get(cmdName);
  if (!command) return false;

  if (tag === 'cmd') interaction.options = fakeOptions({});
  else if (tag === 'run' && rest) interaction.options = fakeOptions({ 닉네임: rest });
  else if (tag === 'opt') interaction.options = fakeOptions(parseQuery(rest));
  else return false;

  await command.execute(interaction);
  return true;
}
