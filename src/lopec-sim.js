// 로펙 캐릭터 페이지의 "팔찌 효율" 배지를 그대로 재현한다.
//
// 이 값은 로펙이 브라우저에서 딜 시뮬레이터를 돌려 계산하는 것이라 HTML에 들어 있지 않다.
// 계산식(배율 8개의 곱)을 직접 옮기는 대신, 로펙이 배포하는 스크립트 모듈을 런타임에 받아
// 그대로 실행한다. 브라우저가 하는 일을 Node에서 똑같이 하는 셈이라 수치가 어긋나지 않고,
// 로펙 코드를 이 저장소에 담지 않아도 된다.
//
// 남의 코드를 실행하므로 node:vm의 빈 컨텍스트에 가둬 돌린다. 어디서든 실패하면 null을 주고,
// 커맨드는 효율표 값으로 물러난다.
import vm from 'node:vm';
import {
  fetchText, flightPayload, objectAfter, matchBrace, getSpecPointHtml,
} from './lopec.js';

const BASE_URL = 'https://lopec.kr';
const RESULT_TTL = 5 * 60 * 1000;

const bangleCache = new Map();
const arkgridCache = new Map();
let runtime = null; // { key, run }

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

// 모듈들을 격리된 컨텍스트에 올리고 "캐릭터 JSON → 계산 결과" 함수들을 만든다.
function buildRunner(modules, entries) {
  const registry = [...modules.entries()]
    .map(([id, body]) => `${JSON.stringify(id)}: ${body}`)
    .join(',\n');

  const call = (entry) =>
    entry
      ? `(json) => req(${JSON.stringify(entry.id)})[${JSON.stringify(entry.name)}](JSON.parse(json), {})`
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
  // 컨텍스트에 fetch·process 같은 건 없다 — 순수 계산만 돌아간다.
  return vm.runInNewContext(script, vm.createContext({}), { timeout: 10000 });
}

async function ensureRuntime(html) {
  const chunkPaths = [...new Set(
    [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+)"/g)].map((m) => m[1]),
  )];
  const key = chunkPaths.join('|');
  if (runtime?.key === key) return runtime.api;

  const sources = await Promise.all(
    chunkPaths.map((path) => fetchText(BASE_URL + encodeURI(path)).catch(() => '')),
  );
  const modules = collectModules(sources.filter(Boolean));
  const entries = findEntries(modules);
  if (!entries) throw new Error('로펙 계산 진입점을 찾지 못했어요');

  runtime = { key, api: buildRunner(modules, entries) };
  return runtime.api;
}

// 캐릭터 페이지 데이터를 받아 격리 컨텍스트에서 계산한다. 서폿은 계산 모듈이
// 이 페이지들에 실려 오지 않아 건너뛴다 (커맨드가 대체값으로 물러난다).
async function compute(characterName, pick) {
  const html = await getSpecPointHtml(characterName);
  const parser = objectAfter(flightPayload(html), '"lostarkParser":');
  if (!parser || parser.profile?.supportCheck) return null;
  const api = await ensureRuntime(html);
  const run = pick(api);
  return run ? run(JSON.stringify(parser)) : null;
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

// 로펙 캐릭터 페이지 팔찌 배지와 같은 값(%). 실패하면 null.
export function getBanglePercent(characterName) {
  return cached(bangleCache, characterName, async () => {
    const value = await compute(characterName, (api) => api.bangle);
    return Number.isFinite(value) ? value : null;
  });
}

// 아크 그리드 젬 효율. { efficiency, optionEfficiency, pointEfficiency, effectEfficiencies }
export function getArkgridEfficiency(characterName) {
  return cached(arkgridCache, characterName, async () => {
    const result = await compute(characterName, (api) => api.arkgrid);
    if (!result || !Number.isFinite(result.efficiency)) return null;
    return {
      efficiency: result.efficiency,
      optionEfficiency: result.optionEfficiency ?? null,
      pointEfficiency: result.pointEfficiency ?? null,
      effectEfficiencies: result.effectEfficiencies ?? null,
    };
  });
}
