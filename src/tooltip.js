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
