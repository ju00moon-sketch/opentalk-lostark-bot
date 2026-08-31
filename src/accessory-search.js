// 악세 연마 조합 최저가 검색 — ".상상 70" 같은 입력을 경매장 조회 계획으로 바꾼다.
import { searchAccessories } from './lostark.js';
import { OPTIONS, GRADE_INDEX, SLOTS, ROLE_FILLERS, DEFAULT_QUALITY } from './data/refine.js';

// "상상", "상중", "상단일", "상상하" → ['상','상'] 같은 등급 배열. 형식이 아니면 null.
export function parsePattern(text) {
  const raw = String(text ?? '').replace(/\s+/g, '');
  if (!raw) return null;

  const single = /^([상중하])단일$/.exec(raw);
  if (single) return [single[1]];

  if (!/^[상중하]{2,3}$/.test(raw)) return null;
  return [...raw];
}

// 등급 배열 하나에 대해 조회할 항목 목록을 만든다.
// 2옵에서 등급이 서로 다르면 두 배치를 모두 넣고, 3옵이면 앞 두 개가 메인·세 번째가 필러다.
function buildQueries(slot, grades) {
  const queries = [];
  const add = (codes) => {
    const key = codes.map((c) => `${c.code}${c.grade}`).join('|');
    if (!queries.some((q) => q.key === key)) queries.push({ key, codes });
  };

  if (grades.length === 1) {
    const seen = new Set();
    for (const { codes } of slot.combos) {
      for (const code of codes) {
        if (seen.has(code)) continue;
        seen.add(code);
        add([{ code, grade: grades[0] }]);
      }
    }
    return queries;
  }

  for (const { role, codes } of slot.combos) {
    if (grades.length === 2) {
      add([{ code: codes[0], grade: grades[0] }, { code: codes[1], grade: grades[1] }]);
      if (grades[0] !== grades[1]) {
        add([{ code: codes[0], grade: grades[1] }, { code: codes[1], grade: grades[0] }]);
      }
      continue;
    }
    // 3옵: 메인 두 개는 앞 등급 그대로, 세 번째 등급은 역할별 필러가 받는다
    for (const filler of ROLE_FILLERS[role]) {
      if (codes.includes(filler)) continue;
      add([
        { code: codes[0], grade: grades[0] },
        { code: codes[1], grade: grades[1] },
        { code: filler, grade: grades[2] },
      ]);
    }
  }
  return queries;
}

// 등급이 섞였을 때만 옵션 뒤에 (상)/(중)을 붙여 어느 배치인지 알 수 있게 한다.
function label(codes) {
  const mixed = new Set(codes.map((c) => c.grade)).size > 1;
  return codes
    .map((c) => OPTIONS[c.code].name + (mixed ? `(${c.grade})` : ''))
    .join(' + ');
}

async function lowestPrice(slot, codes, quality) {
  const etcOptions = codes.map((c) => {
    const value = OPTIONS[c.code].values[GRADE_INDEX[c.grade]];
    return { second: c.code, min: value, max: value };
  });
  const result = await searchAccessories({ category: slot.category, etcOptions, quality });
  const item = result?.Items?.[0];
  return {
    price: item?.AuctionInfo?.BuyPrice ?? null,
    quality: item?.GradeQuality ?? null,
    count: result?.TotalCount ?? 0,
  };
}

// 부위별 결과를 돌려준다. 조회 실패한 줄은 price가 null이다.
export async function searchPattern(grades, quality = DEFAULT_QUALITY) {
  const jobs = SLOTS.map(async (slot) => {
    const queries = buildQueries(slot, grades);
    const rows = await Promise.all(
      queries.map(async (q) => {
        try {
          const found = await lowestPrice(slot, q.codes, quality);
          return { label: label(q.codes), ...found };
        } catch {
          return { label: label(q.codes), price: null, quality: null, count: 0, failed: true };
        }
      }),
    );
    return { slot: slot.name, rows };
  });
  return Promise.all(jobs);
}
