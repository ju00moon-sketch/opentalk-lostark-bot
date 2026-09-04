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
