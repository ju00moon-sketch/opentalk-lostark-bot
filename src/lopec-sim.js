// 로펙 캐릭터 페이지의 "팔찌 효율" 배지를 그대로 재현한다.
//
// 이 값은 로펙이 브라우저에서 딜 시뮬레이터를 돌려 계산하는 것이라 HTML에 들어 있지 않다.
// 계산식(배율 8개의 곱)을 직접 옮기는 대신, 로펙이 배포하는 스크립트 모듈을 런타임에 받아
// 그대로 실행한다. 브라우저가 하는 일을 Node에서 똑같이 하는 셈이라 수치가 어긋나지 않고,
// 로펙 코드를 이 저장소에 담지 않아도 된다.
//
// 남의 코드를 실행하므로 봇과 분리된 프로세스(lopec-sandbox.js)에서 돌린다 — 환경변수 없이, 권한 모델로
// 파일·자식 프로세스·워커를 막은 채로. node:vm만으로는 보안 격리가 아니라는 게 Node 문서의 입장이다.
// 어디서든 실패하면 null을 주고, 커맨드는 효율표 값으로 물러난다.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  fetchText, flightPayload, objectAfter, matchBrace, getSpecPointHtml,
} from './lopec.js';

const BASE_URL = 'https://lopec.kr';
const RESULT_TTL = 5 * 60 * 1000;
const SANDBOX_PATH = fileURLToPath(new URL('./lopec-sandbox.js', import.meta.url));
const HARDEN_PATH = fileURLToPath(new URL('./lopec-sandbox-harden.js', import.meta.url));
// 격리 프로세스 플래그. 순서대로: 권한 모델(파일·자식·워커·애드온 차단) · harden 파일만 읽기 허용 ·
// Function()/eval 금지(vm 탈출 경로 차단) · 메모리 상한
const SANDBOX_FLAGS = [
  '--permission',
  `--allow-fs-read=${HARDEN_PATH}`,
  '--disallow-code-generation-from-strings',
  '--max-old-space-size=256',
];
// OS 사용자 경계까지 두려면 격리 프로세스 앞에 붙일 명령을 준다(절대 경로로 — 자식 환경변수가 비어 PATH가 없다).
//   예: LOPEC_SANDBOX_WRAPPER="/usr/bin/sudo -n -u lopec-sandbox --"   (공백이 든 경로는 큰따옴표로 감싼다)
// 없으면 봇과 같은 OS 사용자로 돈다(권한 모델·코드 생성 금지·무장 해제는 그대로 적용).
const splitArgs = (line) => [...String(line ?? '').matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]);
const SANDBOX_WRAPPER = splitArgs(process.env.LOPEC_SANDBOX_WRAPPER);
const SANDBOX_TIMEOUT_MS = 15_000; // 격리 프로세스 전체(기동 + 모듈 평가 + 계산) 상한
const SANDBOX_OUTPUT_MAX = 1024 * 1024; // 결과 JSON 상한 — 이보다 크면 뭔가 잘못된 것

const bangleCache = new Map();
const arkgridCache = new Map();
let runtime = null; // { key, script } — 실행 가능한 함수가 아니라 격리 프로세스에 넘길 소스 문자열

// 웹팩 청크에서 모듈 정의를 모두 꺼낸다.
// 인자가 하나면 괄호 없이 "12345:e=>{...}"로도 나오고, ID가 "59e3:"처럼 지수 표기로
// 줄어들기도 한다. 둘 다 받아야 한 모듈이라도 빠지지 않는다.
const MODULE_HEADER =
  /(?<![\w$.])(\d{2,6}(?:e\d)?):(?:\((?:[A-Za-z$_]+(?:,[A-Za-z$_]+){0,2})?\)|[A-Za-z$_]+)=>\{/g;

function collectModules(chunkSources) {
  const modules = new Map();
  for (const source of chunkSources) {
    for (const m of source.matchAll(MODULE_HEADER)) {
      const open = source.indexOf('{', m.index + m[0].length - 1);
      const close = matchBrace(source, open);
      if (close === -1) continue;
      // 지수 표기(59e3)를 실제 숫자 키로 되돌려 둔다
      modules.set(String(Number(m[1])), source.slice(m.index + m[1].length + 1, close + 1));
    }
  }
  return modules;
}

// 어떤 변수가 어느 모듈에서 왔는지 찾는다 — 축약된 "var r=t(12921)" 형태.
const BINDING = /^[A-Za-z$_]+\((\d{3,6})\)/;
const WORD_CHAR = /[A-Za-z0-9$_]/;

function findBinding(body, variable) {
  const marker = `${variable}=`;
  for (let at = body.indexOf(marker); at !== -1; at = body.indexOf(marker, at + 1)) {
    if (at > 0 && WORD_CHAR.test(body[at - 1])) continue; // 다른 변수 이름의 꼬리
    const found = BINDING.exec(body.slice(at + marker.length, at + marker.length + 24));
    if (found) return found[1];
  }
  return null;
}

// 진입점 찾기. 모듈 ID는 로펙이 배포할 때마다 바뀌므로 소스의 호출 형태로 역추적한다.
//
// 팔찌: 화면 코드의 "banglePercent:(0,n.l)(" 로 분배 함수를 찾고, 그 안의
//   "return(0,r.sh)(e,a)" 로 딜러용 계산 함수를 집어낸다. 분배 함수를 그대로 부르지 않는 이유는
//   서폿 계산 모듈이 이 페이지들에 실려 오지 않아 불러오는 순간 실패하기 때문이다.
// 아크그리드(젬): 같은 화면 코드의 딜러 분기 "else{let t=(0,s.cA)(e);m.arkgridPercent=" 에서
//   계산 함수를 집어낸다.
function findEntries(modules) {
  for (const [, body] of modules) {
    const bangleCall = /banglePercent:\(0,([A-Za-z$_]+)\.[A-Za-z$_]+\)\(/.exec(body);
    if (!bangleCall) continue;

    const dispatcherId = findBinding(body, bangleCall[1]);
    const dispatcher = dispatcherId && modules.get(dispatcherId);
    if (!dispatcher) continue;
    const dealer = /return\(0,([A-Za-z$_]+)\.([A-Za-z$_]+)\)\([A-Za-z$_]+,[A-Za-z$_]+\)\}/.exec(dispatcher);
    if (!dealer) continue;
    const bangleId = findBinding(dispatcher, dealer[1]);
    if (!bangleId || !modules.has(bangleId)) continue;

    const entries = { bangle: { id: bangleId, name: dealer[2] } };

    const grid = /else\{let [A-Za-z$_]+=\(0,([A-Za-z$_]+)\.([A-Za-z$_]+)\)\([A-Za-z$_]+\);[A-Za-z$_]+\.arkgridPercent=/
      .exec(body);
    const gridId = grid && findBinding(body, grid[1]);
    if (gridId && modules.has(gridId)) entries.arkgrid = { id: gridId, name: grid[2] };

    return entries;
  }
  return null;
}

// 모듈들을 한 스크립트로 묶는다. 평가하면 { bangle, arkgrid }(캐릭터 JSON → 계산 결과) 객체가 나온다.
// 여기서는 실행하지 않는다 — 실행은 격리 프로세스의 몫.
function buildScript(modules, entries) {
  const registry = [...modules.entries()]
    .map(([id, body]) => `${JSON.stringify(id)}: ${body}`)
    .join(',\n');

  // 결과는 컨텍스트 안에서 JSON 문자열로 바꿔 돌려준다 — 호스트(격리 프로세스)가 남의 객체의 getter를 건드리지 않게
  const call = (entry) =>
    entry
      ? `(json) => JSON.stringify(req(${JSON.stringify(entry.id)})[${JSON.stringify(entry.name)}](JSON.parse(json), {}) ?? null)`
      : 'null';

  const script = `
    const MODULES = {\n${registry}\n};
    const cache = new Map();
    function req(id) {
      const hit = cache.get(id);
      if (hit) return hit.exports;
      const mod = { exports: {} };
      cache.set(id, mod);
      if (typeof MODULES[id] !== 'function') throw new Error('모듈 ' + id + ' 없음');
      MODULES[id](mod, mod.exports, req);
      return mod.exports;
    }
    req.d = (target, defs) => {
      for (const key of Object.keys(defs)) {
        Object.defineProperty(target, key, { enumerable: true, get: defs[key] });
      }
    };
    req.n = (m) => () => m;
    req.r = () => {};
    req.o = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    ({ bangle: ${call(entries.bangle)}, arkgrid: ${call(entries.arkgrid)} });
  `;
  return script;
}

// 격리 프로세스에서 script를 평가하고 entry(bangle|arkgrid)를 json으로 호출한 결과를 받는다.
//   · 환경변수를 비워 봇의 토큰·API 키가 넘어가지 않는다 (env: {})
//   · SANDBOX_FLAGS: 권한 모델 + Function()/eval 금지 + 메모리 상한. 네트워크 전역과 process는 자식이 평가 전에 스스로 지운다(lopec-sandbox-harden.js)
//   · 시간을 넘기면 프로세스를 죽인다 — vm timeout은 동기 코드에만 걸리므로 바깥에서 한 번 더 지킨다
function runInSandbox(script, entry, json) {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = [...SANDBOX_WRAPPER, process.execPath, ...SANDBOX_FLAGS, SANDBOX_PATH];
    const child = spawn(cmd, args, {
      env: {},
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let out = '';
    let errOut = '';
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(reject, new Error(`로펙 계산 시간 초과 (${SANDBOX_TIMEOUT_MS / 1000}초)`));
    }, SANDBOX_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (out.length > SANDBOX_OUTPUT_MAX) {
        child.kill('SIGKILL');
        finish(reject, new Error('로펙 계산 결과가 비정상적으로 큽니다'));
      }
    });
    child.stderr.on('data', (chunk) => { errOut = (errOut + chunk).slice(-2000); });
    child.on('error', (err) => finish(reject, err));
    child.on('close', () => {
      let parsed;
      try {
        parsed = JSON.parse(out.trim().split('\n').pop() || 'null');
      } catch {
        parsed = null;
      }
      if (!parsed || typeof parsed !== 'object') {
        return finish(reject, new Error(`로펙 계산 프로세스 응답 없음${errOut ? `: ${errOut.trim().split('\n').pop()}` : ''}`));
      }
      if (!parsed.ok) return finish(reject, new Error(parsed.error || '로펙 계산 실패'));
      finish(resolve, parsed.value);
    });

    child.stdin.on('error', () => {}); // 자식이 먼저 죽으면 EPIPE — close에서 처리한다
    child.stdin.end(JSON.stringify({ script, entry, json }));
  });
}

async function ensureRuntime(html) {
  const chunkPaths = [...new Set(
    [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map((m) => m[1]),
  )];
  const key = chunkPaths.join('|');
  if (runtime?.key === key) return runtime.script;

  // 청크 하나라도 못 받으면 여기서 실패한다. 예전엔 빈 문자열로 넘겨 모듈이 빠진 환경을 만들고 그걸 캐시해서,
  // 서버가 정상으로 돌아온 뒤에도 6분이고 10분이고 계속 실패했다. 실패하면 캐시하지 않으니 다음 조회에서 다시 받는다.
  const sources = await Promise.all(chunkPaths.map((path) => fetchText(BASE_URL + encodeURI(path))));
  const modules = collectModules(sources);
  const entries = findEntries(modules);
  if (!entries) throw new Error('로펙 계산 진입점을 찾지 못했어요');

  runtime = { key, script: buildScript(modules, entries) };
  return runtime.script;
}

// 캐릭터 페이지 데이터를 받아 격리 컨텍스트에서 계산한다. 서폿은 계산 모듈이
// 이 페이지들에 실려 오지 않아 건너뛴다 (커맨드가 대체값으로 물러난다).
async function compute(characterName, entry) {
  const html = await getSpecPointHtml(characterName);
  const parser = objectAfter(flightPayload(html), '"lostarkParser":');
  if (!parser || parser.profile?.supportCheck) return null;
  const script = await ensureRuntime(html);
  try {
    return await runInSandbox(script, entry, JSON.stringify(parser));
  } catch (err) {
    // 스크립트 평가·계산이 깨졌다면 받아 둔 모듈 묶음을 믿을 수 없다 — 버리고 다음 조회에서 다시 만든다
    runtime = null;
    throw err;
  }
}

function cached(store, key, compute) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < RESULT_TTL) return Promise.resolve(hit.value);
  return compute().then(
    (value) => {
      store.set(key, { at: Date.now(), value });
      return value;
    },
    (err) => {
      console.error('[로펙 계산]', err.message);
      store.set(key, { at: Date.now(), value: null });
      return null;
    },
  );
}

// 테스트 훅 — 격리 실행과 런타임 준비를 네트워크 없이 검증하기 위한 것. 제품 코드에서는 쓰지 않는다.
export const __test = { runInSandbox, ensureRuntime, resetRuntime: () => { runtime = null; } };

// 로펙 캐릭터 페이지 팔찌 배지와 같은 값(%). 실패하면 null.
export function getBanglePercent(characterName) {
  return cached(bangleCache, characterName, async () => {
    const value = await compute(characterName, 'bangle');
    return Number.isFinite(value) ? value : null;
  });
}

// 아크 그리드 젬 효율. { efficiency, optionEfficiency, pointEfficiency, effectEfficiencies }
export function getArkgridEfficiency(characterName) {
  return cached(arkgridCache, characterName, async () => {
    const result = await compute(characterName, 'arkgrid');
    if (!result || !Number.isFinite(result.efficiency)) return null;
    return {
      efficiency: result.efficiency,
      optionEfficiency: result.optionEfficiency ?? null,
      pointEfficiency: result.pointEfficiency ?? null,
      effectEfficiencies: result.effectEfficiencies ?? null,
    };
  });
}
