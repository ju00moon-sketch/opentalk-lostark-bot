// 로펙 계산 스크립트를 돌리는 격리 프로세스의 진입점. lopec-sim.js가 이 파일을
//   node --permission --allow-fs-read=<harden 파일> --disallow-code-generation-from-strings --max-old-space-size=256 src/lopec-sandbox.js
// 로 띄우고(환경변수 없음), stdin으로 { script, entry, json }을 넣은 뒤 stdout의 마지막 JSON 한 줄을 받는다.
//
// 격리의 네 겹:
//   1) 별도 프로세스 — 봇과 PID·메모리·수명이 다르다. 죽어도 봇은 산다.
//   2) --permission — 파일·자식 프로세스·워커·애드온·WASI 차단. 읽을 수 있는 파일은 이 진입점과 harden 파일뿐.
//   3) --disallow-code-generation-from-strings — Function()/eval이 프로세스 전체에서 꺼진다. vm 컨텍스트에서
//      호스트로 새어 나오는 고전적 경로("this.constructor.constructor('return process')")가 원천 차단된다.
//   4) hardenRuntime() — 그래도 새어 나왔을 때를 대비해 네트워크 전역과 process 자체를 평가 전에 지운다.
// 여기에 컨텍스트는 프로토타입 없는 객체(Object.create(null))로 만들어 호스트 객체가 안으로 들어가지 않게 하고,
// 계산 결과는 컨텍스트 안에서 JSON 문자열로 바꿔 받아 호스트가 남의 객체를 만지지 않는다.
import vm from 'node:vm';
import { hardenRuntime, auditHardening } from './lopec-sandbox-harden.js';

const EVAL_TIMEOUT_MS = 10_000;

// 세션 플래그와 신뢰할 수 있는 입력 참조는 전역 process를 지우기 전에 확보한다.
const sessionStdin = process.argv.includes('--session') ? process.stdin : null;
if (sessionStdin) await runSession(sessionStdin);

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

const input = await readStdin();

// 남의 코드를 평가하기 직전에 무장 해제. 이 뒤로는 write·exit 참조로만 바깥과 말한다.
const { write, exit } = hardenRuntime();
const reply = (payload) => write(`${JSON.stringify(payload)}\n`, () => exit(payload.ok ? 0 : 2));

const problems = auditHardening();
if (problems.length > 0) {
  reply({ ok: false, error: `격리 자가 진단 실패: ${problems.join(' · ')}` });
} else {
  try {
    const { script, entry, json } = JSON.parse(input);
    if (typeof script !== 'string' || typeof entry !== 'string' || typeof json !== 'string') {
      reply({ ok: false, error: '입력 형식 오류' });
    } else {
      // codeGeneration: --disallow-code-generation-from-strings는 메인 컨텍스트에만 걸린다. 새 컨텍스트는 여기서 따로 끈다.
      const context = vm.createContext(Object.create(null), {
        codeGeneration: { strings: false, wasm: false },
        microtaskMode: 'afterEvaluate',
      });
      const api = vm.runInNewContext(script, context, { timeout: EVAL_TIMEOUT_MS });
      const run = api?.[entry];
      if (typeof run !== 'function') {
        reply({ ok: false, error: `계산 진입점 없음: ${entry}` });
      } else {
        // run은 컨텍스트 안에서 JSON 문자열을 돌려준다(buildScript 참고) — 문자열은 원시값이라 영역을 넘어도 안전하다
        const serialized = run(json);
        reply({ ok: true, value: typeof serialized === 'string' ? JSON.parse(serialized) : null });
      }
    }
  } catch (err) {
    reply({ ok: false, error: err?.message ?? String(err) });
  }
}

// 줄바꿈 전까지의 바이트 수를 제한한다. UTF-8 문자가 청크 경계에서 잘려도
// 프레임 전체를 받은 뒤 디코딩하므로 손상되지 않는다.
async function* readSessionFrames(stdin) {
  let chunks = [];
  let size = 0;
  let limit = 32 * 1024 * 1024;
  for await (const chunk of stdin) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline;
      size += end - start;
      if (size > limit) throw new Error('세션 입력 크기 초과');
      chunks.push(chunk.subarray(start, end));
      if (newline === -1) break;
      const frame = Buffer.concat(chunks, size).toString('utf8');
      chunks = [];
      size = 0;
      limit = 8 * 1024 * 1024;
      yield frame;
      start = newline + 1;
    }
  }
  if (size !== 0) throw new Error('세션 입력의 마지막 줄바꿈 누락');
}

async function runSession(stdin) {
  // write·exit는 hardenRuntime 내부에서 무장 해제 전에 잡은 참조다.
  // stdin과 이 함수들은 VM에 주입하지 않고 JSON 문자열만 건넨다.
  const { write, exit } = hardenRuntime();
  const send = payload => new Promise((resolve, reject) => {
    write(`${JSON.stringify(payload)}\n`, error => error ? reject(error) : resolve());
  });
  let id = 1;
  let run;
  try {
    const problems = auditHardening();
    if (problems.length) throw new Error(`격리 자가 진단 실패: ${problems.join(' · ')}`);
    for await (const frame of readSessionFrames(stdin)) {
      if (id > 3) throw new Error('세션은 세 단계까지만 실행할 수 있어요');
      const request = JSON.parse(frame);
      const keys = id === 1 ? ['id', 'script', 'entry', 'json'] : ['id', 'json'];
      if (!request || typeof request !== 'object' || Array.isArray(request)
        || Object.keys(request).length !== keys.length
        || keys.some(key => !Object.hasOwn(request, key))
        || request.id !== id || typeof request.json !== 'string'
        || (id === 1 && (typeof request.script !== 'string' || request.entry !== 'specup'))) {
        throw new Error('세션 입력 형식 또는 순서 오류');
      }
      if (id === 1) {
        const context = vm.createContext(Object.create(null), {
          codeGeneration: { strings: false, wasm: false },
          microtaskMode: 'afterEvaluate',
        });
        const api = vm.runInContext(request.script, context, { timeout: EVAL_TIMEOUT_MS });
        run = api?.specup;
        if (typeof run !== 'function') throw new Error('계산 진입점 없음: specup');
      }
      // 기존 단발 경로처럼 VM 객체를 직렬화하지 않고 원시 문자열만 파싱한다.
      const serialized = run(request.json);
      await send({ id, ok: true, value: typeof serialized === 'string' ? JSON.parse(serialized) : null });
      id++;
    }
    if (id !== 4) throw new Error('세션 입력이 세 단계 완료 전에 종료됐어요');
    // 마지막 응답 쓰기까지 완료하고 EOF를 확인한 경우에만 정상 종료한다.
    exit(0);
  } catch (err) {
    let error = '세션 계산 실패';
    // VM이 던진 객체나 변환 함수를 응답 직렬화 과정에 넘기지 않는다.
    try {
      const message = err?.message;
      if (typeof message === 'string') error = message;
      else if (typeof err === 'string') error = err;
    } catch { /* 오류 속성 접근도 실패하면 기본 문구를 쓴다 */ }
    try { await send({ id, ok: false, error }); } finally { exit(2); }
  }
}
