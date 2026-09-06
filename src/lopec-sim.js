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
import { getLopecSnapshots, buildSnapshots } from './specup-prices.js';

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
// sudo는 SIGKILL을 전달할 수 없다. 래퍼를 살려 둔 채 종료 신호를 중계해야
// 다른 OS 사용자로 실행된 실제 계산 자식도 종료되고 close 뒤 슬롯이 반환된다.
const SANDBOX_STOP_SIGNAL = SANDBOX_WRAPPER.length && process.platform !== 'win32' ? 'SIGTERM' : 'SIGKILL';
const SANDBOX_TIMEOUT_MS = 15_000; // 격리 프로세스 전체(기동 + 모듈 평가 + 계산) 상한
const SANDBOX_OUTPUT_MAX = 1024 * 1024; // 결과 JSON 상한 — 이보다 크면 뭔가 잘못된 것
const SPECUP_TIMEOUT_MS = 20_000;

function createLimiter(size) {
  let active = 0;
  const waiting = [];
  return async (task) => {
    if (active >= size) await new Promise((resolve) => waiting.push(resolve));
    else active++;
    try { return await task(); }
    finally {
      const next = waiting.shift();
      if (next) next(); // 실행 중인 슬롯을 대기자에게 직접 넘긴다.
      else active--;
    }
  };
}
const limitSandbox = createLimiter(2);

function normalizeGuide(phaseA, phaseB, snapshots) {
  if (!Number.isFinite(phaseA?.baseScore) || !Number.isFinite(phaseB?.baseScore)
    || Math.abs(phaseA.baseScore - phaseB.baseScore) > 0.01
    || !Array.isArray(phaseA.candidates) || !Array.isArray(phaseB.candidates)) return null;
  const byId = new Map(phaseB.candidates.map((row) => [row.id, row]));
  if (byId.size !== phaseB.candidates.length
    || new Set(phaseA.candidates.map((row) => row.id)).size !== phaseA.candidates.length) return null;
  const rows = [];
  const usedTimes = [];
  const missing = new Set(snapshots.missing ?? []);
  let droppedForPrice = 0;
  let priceStale = false;
  for (const a of phaseA.candidates) {
    const gain = a.finalScore - phaseA.baseScore;
    if (!Number.isFinite(gain) || typeof a.kind !== 'string' || typeof a.option !== 'string') return null;
    if (gain <= 0) continue;
    const b = byId.get(a.id);
    const keys = b?.requiredKeys;
    const cost = b?.costValue;
    const per100k = cost === 0 ? null : gain / cost * 100_000;
    if (!b?.hasCostModel || !Array.isArray(keys) || !Number.isFinite(cost) || cost < 0
      || (cost > 0 && !Number.isFinite(per100k)) || (!keys.length && !b.fixedOnly)
      || keys.some((key) => missing.has(key) || !['api', 'lopec'].includes(snapshots.sourceByKey?.[key]))) {
      droppedForPrice++;
      continue;
    }
    const priceSource = b.fixedOnly && keys.length === 0 ? 'fixed'
      : keys.some((key) => snapshots.sourceByKey[key] === 'lopec') ? 'lopec' : 'api';
    for (const key of keys) {
      const time = snapshots.timeByKey?.[key];
      if (Number.isFinite(time)) usedTimes.push(time);
      if (snapshots.sourceByKey[key] === 'lopec'
        && (snapshots.staleByKey?.[key] ?? snapshots.stale)) priceStale = true;
    }
    rows.push({ kind: a.kind, option: a.option, finalScore: a.finalScore,
      expectedCost: cost, per100k, priceSource });
  }
  if (!rows.length && droppedForPrice) {
    console.error('[스펙업] 모든 후보의 비용을 확인하지 못했습니다');
    return null;
  }
  rows.sort((a, b) => (a.per100k === null ? b.per100k === null ? 0 : -1 : b.per100k === null ? 1 : b.per100k - a.per100k)
    || b.finalScore - a.finalScore);
  return { baseScore: phaseA.baseScore, pricedAt: usedTimes.length ? Math.min(...usedTimes) : null,
    priceStale, droppedForPrice, rows };
}

const bangleCache = new Map();
const arkgridCache = new Map();
let runtime = null; // { key, script } — 실행 가능한 함수가 아니라 격리 프로세스에 넘길 소스 문자열
let specupRuntime = null;
const specupRuntimePending = new Map();

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

// 이름이 아니라 원본 함수의 계약과 호출 형태로 찾는다. 후보가 여러 개면 추측하지 않는다.
function namedFunctions(source) {
  const pattern = /function ([\w$]+)\([^)]*\)\{/g;
  const found = [];
  for (let m; (m = pattern.exec(source));) {
    const end = matchBrace(source, pattern.lastIndex - 1);
    if (end < 0) throw new Error('로펙 함수 경계 확인 실패');
    found.push({ name: m[1], start: m.index, end: end + 1, source: source.slice(m.index, end + 1) });
    pattern.lastIndex = end + 1;
  }
  return found;
}
function only(values, label) {
  if (values.length !== 1) throw new Error(`로펙 ${label} 식별 실패 (${values.length}개)`);
  return values[0];
}

function buildSpecupScript(originalModules) {
  const entry = only([...originalModules].flatMap(([id, source]) => {
    if (!source.includes('initialRecommendationView:')) return [];
    return namedFunctions(source).filter((f) => f.source.slice(0,700).includes('candidateGenerators:')
      && f.source.includes('enhancementMarketPriceSnapshot:') && f.source.includes('initialRecommendationView:'))
      .map((baseline) => ({ id, source, baseline }));
  }), '스펙업 진입점');
  const { id, source, baseline } = entry;
  const functions = namedFunctions(source);
  const named = (name) => only(functions.filter((f) => f.name === name), '보조 함수');
  const required = (pattern, value = source) => {
    const m = pattern.exec(value);
    if (!m) throw new Error('로펙 스펙업 어댑터 경계 변경');
    return m;
  };
  const calculatorVar = required(/calculator:[\w$]+=([\w$]+)\./, baseline.source)[1];
  const start = source.indexOf(`var ${calculatorVar}=`);
  const requireName = required(/^\([^,]+,[^,]+,([\w$]+)\)=>\{/)[1];
  const rawName = required(/([\w$]+)\([\w$]+,\{calculator:[\w$]+,candidateGenerators:[\w$]+,resolver:[\w$]+\}\)/, baseline.source)[1];
  const zero = only(functions.filter((f) => /\.id\]=String\(/.test(f.source)
    && /\(0,[\w$]+\.[\w$]+\)\(\)/.test(f.source)), '보유 수량');
  const view = only(functions.filter((f) => f.start > baseline.start && f.end <= zero.start
    && f.source.includes('.candidates.map(') && !f.source.includes('sourceCharacterId')), '추천 평가');
  const sort = only(functions.filter((f) => f.source.includes('candidate:')
    && f.source.includes('efficiencyValue:') && f.source.includes('"asc"===')
    && !f.source.includes('useMemo')), '추천 정렬');
  const metric = only(functions.filter((f) => f.start < sort.start && f.start > zero.end
    && f.source.includes('if("combatPower"===') && f.source.length < 200), '점수 정렬');
  const groupAt = required(/function\([\w$]+\)\{var [\w$,]+;let [\w$]+=new Map;for\(let [\w$]+ of [\w$]+\)[\w$]+\.recommendationFamilyKey/).index;
  const group = source.slice(groupAt, matchBrace(source, source.indexOf('{', groupAt)) + 1);
  const cell = required(/\(0,([\w$]+)\.([\w$]+)\)\(\{prefix:[\w$]+\.prefix,currentLabel:[\w$]+\.currentLabel,nextLabel:[\w$]+\.nextLabel\}\)/);
  const kind = required(new RegExp('\\(0,' + cell[1] + '\\.([\\w$]+)\\)\\([\\w$]+\\.prefix\\)'))[1];
  const traceVar = required(/\(0,([\w$]+)\.[\w$]+\)\(\{trace:/, baseline.source)[1];
  const traceId = findBinding(source, traceVar);
  const optional = required(/([\w$]+)=Object\.freeze\(\[\{inputId:/)[1];
  if (start < 0 || !traceId || zero.end < baseline.end) throw new Error('로펙 코어 범위 변경');
  named(rawName);
  const modules = new Map(originalModules);
  modules.set(id, `(e,t,${requireName})=>{var ${traceVar}=${requireName}(${traceId});
    ${source.slice(start, zero.end)}
    ${source.slice(metric.start, sort.end)}
    const groupRows=${group};
    ${requireName}.d(t,{
      baseline:()=>${baseline.name}, view:()=>${view.name}, raw:()=>${rawName}, zero:()=>${zero.name},
      display:()=>rows=>groupRows(${sort.name}(rows,'desc','specPoint')),
      cells:()=>row=>${cell[1]}.${cell[2]}({prefix:row.prefix,currentLabel:row.currentLabel,nextLabel:row.nextLabel}),
      kind:()=>prefix=>${cell[1]}.${kind}(prefix), materialAliases:()=>${optional}
    });}`);
  const registry = [...modules].map(([key, body]) => `${JSON.stringify(key)}:${body}`).join(',\n');
  // 지연 require는 UI만 사용하는 의존성을 기동하지 않는다. 받은 함수·계산식은 변경하지 않는다.
  return `
    const MODULES={${registry}}, cache=new Map();
    function real(id){id=String(id);if(cache.has(id))return cache.get(id).exports;
      if(!MODULES[id])throw Error('모듈 '+id+' 없음');const m={exports:{}};cache.set(id,m);
      MODULES[id](m,m.exports,req);return m.exports;}
    function req(id){return new Proxy(function(){},{get(_,key){return real(id)[key]},apply(_,self,args){return Reflect.apply(real(id),self,args)}})}
    req.d=(target,defs)=>{for(const key of Object.keys(defs))Object.defineProperty(target,key,{enumerable:true,get:defs[key]})};
    req.n=m=>()=>m;req.r=()=>{};req.o=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
    ({specup(json){
      const input=JSON.parse(json), m=real(${JSON.stringify(id)}), parser=input.parser;
      if(!parser||parser.profile?.supportCheck)return null;
      const options={...input.options,excludeScorchGemUpgrades:true,excludePeonCost:true,peonCrystalPrice95Gold:null};
      const base=m.baseline(parser,options), raw=new Map(m.raw(parser).map(r=>[r.id,r]));
      const view=m.view(base,m.zero(),null,options);
      const definitions=new Map(base.candidates.map(c=>[c.id,c]));
      const rows=input.mode==='probe'||input.ids?view.candidates:m.display(view.candidates);
      const ids=input.ids?new Set(input.ids):null;
      const aliases={ 'destiny-leapstone':'leapstone','great-destiny-leapstone':'great-leapstone',
        destruction:'weapon-stone',protection:'armor-stone','destruction-crystal':'weapon-stone-crystal','protection-crystal':'armor-stone-crystal',
        ...Object.fromEntries(m.materialAliases.map(p=>[p.inputId,p.enhancementMaterialId])) };
      const prices=options.auctionPriceSnapshot?.pricesByTarget??{};
      const candidates=rows.filter(row=>(!ids||ids.has(row.id))&&!definitions.get(row.id)?.excludeOnScorchFilter).map(row=>{
        const origin=raw.get(row.id), meta=origin?.metadata??{}, def=definitions.get(row.id);
        if(!origin||!def)throw Error('원본 후보 메타데이터 없음');
        const requiredKeys=new Set((def.materialDependencies??[]).map(key=>aliases[key]??key));
        const fixedOnly=row.group==='abilityStone'||(row.group==='arkPassive'&&Number.isInteger(meta.upgradedKarmaLevel));
        let hasCostModel=fixedOnly||row.group==='equipment'&&requiredKeys.size>0;
        const targets=[meta.upgradedAuctionTarget,meta.upgradedAuctionFallbackTarget];
        const current=[meta.currentAuctionTarget,meta.currentAuctionFallbackTarget];
        if(targets[0]){
          hasCostModel=true;
          let index=targets.findIndex(key=>key&&Number.isFinite(prices[key]));if(index<0)index=0;
          requiredKeys.add(targets[index]);
          if(meta.currentTradeable&&current[index])requiredKeys.add(current[index]);
          if(input.mode==='probe')for(const key of [...targets,...(meta.currentTradeable?current:[])])if(key)requiredKeys.add(key);
        }
        const cells=m.cells(row);const next=row.recommendationPlan?.nextActionLabel??cells.nextState;
        const target=row.recommendationPlan?.recommendedTargetLabel;
        const option=[cells.mainInfo,[cells.currentState,next].filter(Boolean).join(' → ')].filter(Boolean).join(' · ')
          +(target&&target!==next?' (목표 '+target+')':'');
        return {id:row.id,kind:m.kind(row.prefix),option,finalScore:base.baseSpecPoint+row.scoreGain,
          costValue:row.costValue??null,requiredKeys:[...requiredKeys],fixedOnly,hasCostModel,
          engravingGrade:row.group==='engravings'?meta.upgradedGrade??meta.grade??null:null,
          cells:[cells.mainInfo,cells.currentState,row.recommendationPlan&&target!==next?next+' / 권장 목표 '+target:cells.nextState]};
      });
      return JSON.stringify({baseScore:base.baseSpecPoint,candidates});
    }});
  `;
}

async function ensureSpecupRuntime(html, fetcher = fetchText) {
  const paths = [...new Set([...html.matchAll(/src="(\/_next\/static\/chunks\/[^"\s]+\.js)"/g)].map((m) => m[1]))];
  const key = paths.join('|');
  if (!key) throw new Error('로펙 스크립트 없음');
  if (specupRuntime?.key === key) return specupRuntime.script;
  if (specupRuntimePending.has(key)) return specupRuntimePending.get(key);
  const pending = (async () => {
    const sources = new Map(await Promise.all(paths.map(async (path) => [path, await fetcher(BASE_URL + encodeURI(path))])));
    const webpack = only([...sources].filter(([path]) => /\/webpack-[^/]+\.js$/.test(path)), '브라우저 런타임')[1];
    const mapping = new Map([...webpack.matchAll(/"(static\/chunks\/(\d+)\.[a-f0-9]+\.js)"/g)].map((m) => [m[2], '/_next/' + m[1]]));
    const hashMap = /static\/chunks\/"\+[\w$]+\+"-"\+\(?\{([^}]+)\}\)?\[[\w$]+\]\+"\.js"/.exec(webpack);
    if (hashMap) for (const m of hashMap[1].matchAll(/(\d+):"([a-f0-9]+)"/g)) mapping.set(m[1], `/_next/static/chunks/${m[1]}-${m[2]}.js`);
    // .u(id)는 워커의 독립 런타임을 가리킬 수 있다. 브라우저의 .e(id) 참조만 재귀 수집한다.
    let frontier = [...sources.values()];
    while (frontier.length) {
      const next = new Set(frontier.flatMap((source) => [...source.matchAll(/\.e\((\d+)\)/g)]
        .map((m) => mapping.get(m[1])).filter((path) => path && !sources.has(path))));
      if (sources.size + next.size > 100) throw new Error('로펙 청크 수 상한 초과');
      const loaded = await Promise.all([...next].map(async (path) => [path, await fetcher(BASE_URL + encodeURI(path))]));
      for (const [path, source] of loaded) {
        if (!source.includes('webpackChunk_N_E')) throw new Error('브라우저와 다른 모듈 그래프');
        sources.set(path, source);
      }
      frontier = loaded.map(([, source]) => source);
    }
    const modules = new Map();
    for (const [path, source] of sources) {
      if (/\/webpack-|\/polyfills-/.test(path)) continue;
      for (const [id, body] of collectModules([source])) {
        // 같은 브라우저 그래프의 청크는 동일 모듈을 다른 축약 변수명으로 다시 선언하기도 한다.
        modules.set(id, body);
      }
    }
    const script = buildSpecupScript(modules);
    specupRuntime = { key, script };
    return script;
  })();
  specupRuntimePending.set(key, pending);
  try { return await pending; }
  finally { specupRuntimePending.delete(key); }
}

function collectNeeds(result) {
  if (!Array.isArray(result?.candidates)) throw new Error('로펙 스펙업 후보 응답 오류');
  const materialIds = new Set();
  const targets = new Set();
  const engravingGrades = Object.create(null);
  for (const row of result.candidates) {
    if (!Array.isArray(row.requiredKeys)) throw new Error('로펙 요구 시세 응답 오류');
    for (const key of row.requiredKeys) {
      if (/^(?:gem|accessory|market)\./.test(key)) targets.add(key);
      else materialIds.add(key);
      if (key.startsWith('market.engraving.') && row.engravingGrade) engravingGrades[key] = row.engravingGrade;
    }
  }
  return { materialIds: [...materialIds], targets: [...targets], engravingGrades };
}

function createSpecupGetter({
  fetchHtml = (name) => fetchText(`${BASE_URL}/character/specupGuide/${encodeURIComponent(name)}`),
  readParser = (html) => objectAfter(flightPayload(html), '"lostarkParser":'),
  ensure = ensureSpecupRuntime, getSnapshots = getLopecSnapshots, build = buildSnapshots,
  run = runInSandbox, now = Date.now, log = (message) => console.error('[스펙업]', message),
} = {}) {
  const results = new Map();
  const pending = new Map();
  return function getGuide(name) {
    if (typeof name !== 'string' || !name.trim()) return Promise.resolve(null);
    for (const [key, value] of results) if (now() - value.at >= RESULT_TTL) results.delete(key);
    if (results.has(name)) return Promise.resolve(results.get(name).value);
    if (pending.has(name)) return pending.get(name);
    const promise = (async () => {
      let script;
      try {
        const parserHtml = await fetchHtml(name);
        const parser = readParser(parserHtml);
        if (!parser || parser.profile?.supportCheck) return null;
        script = await ensure(parserHtml);
        const evaluate = (input) => run(script, 'specup', JSON.stringify({ parser, ...input }), { timeoutMs: SPECUP_TIMEOUT_MS });
        const probe = await evaluate({ mode: 'probe' });
        const needs = collectNeeds(probe);
        const lopec = await getSnapshots(needs.targets);
        const options = (snapshots) => ({ excludeScorchGemUpgrades: true, excludePeonCost: true,
          peonCrystalPrice95Gold: null, enhancementMarketPriceSnapshot: snapshots.enhancement, auctionPriceSnapshot: snapshots.auction });
        const phaseA = await evaluate({ options: options(lopec) });
        const prices = await build(collectNeeds(phaseA), lopec);
        // 두 번째 평가에서는 가족별 재선택 없이 첫 평가의 모든 ID를 그대로 찾는다.
        const phaseB = await evaluate({ options: options(prices), ids: phaseA.candidates.map((row) => row.id) });
        const value = normalizeGuide(phaseA, phaseB, prices);
        if (value) results.set(name, { at: now(), value });
        return value;
      } catch (error) {
        if (script && specupRuntime?.script === script) specupRuntime = null;
        log(error.message);
        return null;
      }
    })();
    pending.set(name, promise);
    promise.finally(() => pending.delete(name));
    return promise;
  };
}

export const getSpecupGuide = createSpecupGetter();

// 격리 프로세스에서 script를 평가하고 entry(bangle|arkgrid)를 json으로 호출한 결과를 받는다.
//   · 환경변수를 비워 봇의 토큰·API 키가 넘어가지 않는다 (env: {})
//   · SANDBOX_FLAGS: 권한 모델 + Function()/eval 금지 + 메모리 상한. 네트워크 전역과 process는 자식이 평가 전에 스스로 지운다(lopec-sandbox-harden.js)
//   · 시간을 넘기면 프로세스를 죽인다 — vm timeout은 동기 코드에만 걸리므로 바깥에서 한 번 더 지킨다
function runInSandbox(script, entry, json, { timeoutMs = SANDBOX_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    // 호출자 응답과 자식 수명을 분리한다. kill이 거부돼도 응답은 실패시키되,
    // 실제 close 전에는 슬롯을 돌려주지 않아 살아 있는 프로세스가 상한을 넘지 않는다.
    limitSandbox(() => new Promise((release) => {
      const [cmd, ...args] = [...SANDBOX_WRAPPER, process.execPath, ...SANDBOX_FLAGS, SANDBOX_PATH];
      const child = spawn(cmd, args, {
        env: {},
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let out = '';
      let errOut = '';
      let settled = false;
      let failure;
      let outBytes = 0;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        failure = new Error(`로펙 계산 시간 초과 (${timeoutMs / 1000}초)`);
        finish(reject, failure);
        child.kill(SANDBOX_STOP_SIGNAL);
      }, timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        if (failure) return;
        outBytes += Buffer.byteLength(chunk);
        if (outBytes > SANDBOX_OUTPUT_MAX) {
          failure = new Error('로펙 계산 결과가 비정상적으로 큽니다');
          finish(reject, failure);
          child.kill(SANDBOX_STOP_SIGNAL);
        } else out += chunk;
      });
      child.stderr.on('data', (chunk) => { errOut = (errOut + chunk).slice(-2000); });
      child.on('error', (err) => finish(reject, err));
      child.on('close', () => {
        release();
        if (failure) return finish(reject, failure);
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
    })).catch(reject);
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
export const __test = { runInSandbox, ensureRuntime, normalizeGuide, createLimiter, buildSpecupScript, ensureSpecupRuntime, collectNeeds, createSpecupGetter,
  resetRuntime: () => { runtime = null; specupRuntime = null; } };

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
