// 슬래시 커맨드를 디스코드에 등록하는 스크립트.
// 커맨드를 추가/수정할 때마다 `npm run register` 로 한 번 실행하면 된다.
import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';

const body = commands.map((command) => command.data.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

try {
  if (guildId) {
    // 개발 모드: 지정한 서버에만 등록. 즉시 반영된다.
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log(`개발 서버(${guildId})에 커맨드 ${body.length}개 등록 완료! (즉시 반영)`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log(`글로벌 커맨드 ${body.length}개 등록 완료! (안 보이면 디스코드에서 Ctrl+R 새로고침)`);
  }
} catch (err) {
  // 배포 스크립트가 실패를 알아채도록 종료 코드를 실패로 둔다 — 출력만 하고 0으로 끝나면 배포가 성공한 줄 안다
  console.error('커맨드 등록 실패:', err);
  process.exitCode = 1;
}
