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

// 버튼 인터랙션이면 해당 커맨드를 실행한다. 처리했으면 true.
export async function handleButton(interaction, commandMap) {
  const [tag, cmdName, characterName] = interaction.customId.split(':');
  if (tag !== 'run' || !characterName) return false;
  const command = commandMap.get(cmdName);
  if (!command) return false;

  // 슬래시 옵션 흉내 — 닉네임은 버튼에 새겨진 값으로 고정한다.
  interaction.options = {
    getString: (name) => (name === '닉네임' ? characterName : null),
    getInteger: () => null,
    getBoolean: () => null,
    getChannel: () => null,
    getSubcommand: () => null,
  };
  await command.execute(interaction);
  return true;
}
