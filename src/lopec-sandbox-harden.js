// 격리 프로세스(lopec-sandbox.js)가 남의 코드를 평가하기 전에 자기 자신을 무장 해제하는 절차.
//
// 겹겹이 두는 이유: node:vm 컨텍스트는 보안 경계가 아니고(Node 문서), 권한 모델(--permission)은 파일·자식 프로세스·
// 워커·애드온만 막을 뿐 네트워크는 막지 않는다. 그래서 설령 컨텍스트 밖으로 새어 나와도 이 프로세스 안에서
// 할 수 있는 일이 없도록, 바깥세상과 닿는 손잡이를 평가 전에 전부 떼어 낸다:
//   · 네트워크: fetch·WebSocket·EventSource 등 전역 삭제. 내장 모듈에 닿는 길(process.getBuiltinModule·binding·dlopen)은
//     막힌 함수로 바꾸고, import()는 컨텍스트에 콜백이 없어 원래 거부되며 Function()/eval은 --disallow-code-generation-from-strings로
//     프로세스 전체에서 꺼져 있다.
//   · 부모 프로세스: process.kill 등 신호를 보낼 수 있는 함수도 막고, 마지막에 전역 process 자체를 지운다.
// 응답에 필요한 stdout.write·exit는 지우기 전에 잡아 둔 참조로만 쓴다.
//
// 이 파일은 아무것도 import하지 않는다 — 권한 모델 아래에서 읽도록 허용된 파일은 진입 스크립트와 이 파일뿐이다.

const NETWORK_GLOBALS = ['fetch', 'WebSocket', 'EventSource', 'Request', 'Response', 'Headers', 'FormData', 'navigator', 'MessageChannel', 'BroadcastChannel'];

// 이 프로세스나 부모, 혹은 바깥세상에 닿을 수 있는 process의 손잡이들.
const PROCESS_HANDLES = [
  'kill', 'getBuiltinModule', 'binding', '_linkedBinding', 'dlopen', 'abort', '_kill', // reallyExit는 process.exit이 쓰므로 남긴다(자기 종료만 가능)
  'chdir', 'setuid', 'setgid', 'seteuid', 'setegid', 'setgroups', 'initgroups', 'umask',
  'openStdin', '_debugProcess', '_debugEnd', '_startProfilerIdleNotifier', '_stopProfilerIdleNotifier',
  'loadEnvFile', 'execve', 'ref', 'unref',
];

const blocked = (name) => () => { throw new Error(`격리 프로세스에서는 ${name}을(를) 쓸 수 없어요`); };

function seal(target, key, value) {
  try {
    Object.defineProperty(target, key, { value, writable: false, configurable: false, enumerable: false });
  } catch {
    // 정의할 수 없는 속성이면 삭제라도 시도한다
    try { delete target[key]; } catch { /* 둘 다 안 되면 그대로 — 아래 전역 삭제로 닿는 길 자체를 끊는다 */ }
  }
}

// 무장 해제를 수행하고, 응답에 쓸 write·exit를 돌려준다. 한 번만 부른다.
export function hardenRuntime() {
  const proc = globalThis.process;
  const write = proc.stdout.write.bind(proc.stdout);
  const exit = proc.exit.bind(proc);

  for (const key of PROCESS_HANDLES) seal(proc, key, blocked(`process.${key}`));
  seal(proc, 'env', Object.freeze({}));
  seal(proc, 'ppid', 0);

  for (const key of NETWORK_GLOBALS) {
    try { delete globalThis[key]; } catch { /* 지울 수 없으면 아래에서 덮어쓴다 */ }
    if (key in globalThis) seal(globalThis, key, undefined);
  }
  // 전역 process를 없앤다 — 어떤 경로로 이 영역에 닿아도 process에 다시 닿을 수 없게
  try { delete globalThis.process; } catch { seal(globalThis, 'process', undefined); }

  return { write, exit };
}

// 무장 해제가 실제로 됐는지 스스로 점검한다 (테스트·부팅 자가 진단용). 문제 목록을 돌려준다(비어 있으면 통과).
export function auditHardening() {
  const problems = [];
  if (typeof globalThis.process !== 'undefined') problems.push('전역 process가 남아 있음');
  for (const key of NETWORK_GLOBALS) if (typeof globalThis[key] !== 'undefined') problems.push(`전역 ${key}가 남아 있음`);
  try {
    // eslint-disable-next-line no-new-func
    new Function('return 1');
    problems.push('Function() 생성이 허용됨 (--disallow-code-generation-from-strings 필요)');
  } catch { /* 기대한 결과 */ }
  return problems;
}
