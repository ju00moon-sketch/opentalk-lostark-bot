// 장비 Tooltip(JSON 문자열) 파싱 헬퍼.
// 툴팁 구조가 바뀌어도 커맨드가 죽지 않도록 전부 방어적으로 처리한다.

export function parseTooltip(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// HTML 태그 제거. <BR>은 줄바꿈으로 보존한다 (효과 목록 구분자로 쓰임).
export function stripTags(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();
}

// ItemPartBox 중 제목(Element_000)에 label이 포함된 항목의 내용을 줄 단위 배열로 반환.
export function findPartBox(tooltip, label) {
  for (const el of Object.values(tooltip)) {
    if (el?.type !== 'ItemPartBox') continue;
    const title = stripTags(el.value?.Element_000);
    if (title.includes(label)) {
      return stripTags(el.value?.Element_001)
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return null;
}

// 품질 값 (없으면 null).
export function getQuality(tooltip) {
  for (const el of Object.values(tooltip)) {
    const q = el?.value?.qualityValue;
    if (typeof q === 'number' && q >= 0) return q;
  }
  return null;
}

// 어빌리티 스톤 세공 각인을 이름·레벨로 분해한다. 감소 각인은 붉은색(#FE2E2E)으로 구분된다.
export function findStoneEngravings(tooltip) {
  const out = [];
  for (const el of Object.values(tooltip)) {
    if (el?.type !== 'IndentStringGroup') continue;
    for (const group of Object.values(el.value ?? {})) {
      for (const item of Object.values(group?.contentStr ?? {})) {
        const raw = String(item?.contentStr ?? '');
        const m = /\[<FONT COLOR='(#[0-9A-Fa-f]{6})'>([^<]+)<\/FONT>\][\s\S]*?Lv\.(\d+)/.exec(raw);
        if (m) out.push({ name: m[2].trim(), level: Number(m[3]), negative: m[1].toUpperCase() === '#FE2E2E' });
      }
    }
  }
  return out;
}

// 팔찌 효과를 고정 스탯과 옵션으로 나눈다.
// 툴팁에서 고정 스탯 줄은 bracelet_locked 아이콘을 달고 나온다.
export function parseBracelet(tooltip) {
  const stats = [];
  const effects = [];
  for (const el of Object.values(tooltip)) {
    if (el?.type !== 'ItemPartBox') continue;
    if (!stripTags(el.value?.Element_000).includes('팔찌 효과')) continue;
    for (const segment of String(el.value?.Element_001 ?? '').split(/<BR>/i)) {
      const text = stripTags(segment);
      if (!text) continue;
      if (/bracelet_locked/i.test(segment)) {
        const m = /^(.+?)\s*\+([\d,]+)$/.exec(text);
        if (m) stats.push({ name: m[1].trim(), value: m[2] });
        else stats.push({ name: text, value: '' });
      } else {
        effects.push(text);
      }
    }
  }
  return { stats, effects };
}

// 어빌리티 스톤 세공 각인 목록 (IndentStringGroup) — 예: "[원한] Lv.2"
export function findIndentGroup(tooltip) {
  const lines = [];
  for (const el of Object.values(tooltip)) {
    if (el?.type !== 'IndentStringGroup') continue;
    for (const group of Object.values(el.value ?? {})) {
      for (const item of Object.values(group?.contentStr ?? {})) {
        const text = stripTags(item?.contentStr);
        if (text) lines.push(text);
      }
    }
  }
  return lines;
}
