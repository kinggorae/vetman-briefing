// 원문 대표 이미지 정리 규칙.
// 응답이 200이어도 사이트 로고·공통 배경·Google News 프록시 이미지는
// 기사 대표 이미지가 아니므로 지면에 사용하지 않는다.

const GENERIC_HOSTS = /(^|\.)googleusercontent\.com$|(^|\.)gstatic\.com$/i;
const GENERIC_PATHS = [
  /main[\s_-]*visual[\s_-]*green[\s_-]*website/i, // Frontiers 공통 배경
  /(?:^|[\/_-])(?:logo|placeholder|default|generic|fallback|social-preview|share-image)(?:[\/_\-.]|$)/i,
];

export function imageKey(url) {
  if (!url) return null;
  try {
    const parsed = new URL(String(url));
    parsed.hash = "";
    parsed.search = "";
    return parsed.href.toLowerCase();
  } catch {
    return null;
  }
}

export function isLikelyGenericImage(url) {
  if (!url) return true;
  try {
    const parsed = new URL(String(url));
    return GENERIC_HOSTS.test(parsed.hostname) || GENERIC_PATHS.some((pattern) => pattern.test(parsed.pathname));
  } catch {
    return true;
  }
}

export function cleanImageUrl(url, baseUrl = null) {
  if (!url) return null;
  let resolved;
  try {
    resolved = new URL(String(url), baseUrl || undefined);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(resolved.protocol) || isLikelyGenericImage(resolved.href)) return null;
  return resolved.href;
}

// 같은 이미지가 여러 기사에 붙으면 공통 이미지일 가능성이 높다.
// 실제 대표 이미지가 확실하지 않은 경우 모두 제거하고 지면은 이미지 없이 렌더링한다.
export function removeRepeatedImages(items = [], { minOccurrences = 2 } = {}) {
  const counts = new Map();
  for (const item of items) {
    const cleaned = cleanImageUrl(item.imageUrl);
    item.imageUrl = cleaned;
    const key = imageKey(cleaned);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }

  let removed = 0;
  for (const item of items) {
    const key = imageKey(item.imageUrl);
    if (key && counts.get(key) >= minOccurrences) {
      item.imageUrl = null;
      removed++;
    }
  }
  return removed;
}
