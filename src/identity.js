import crypto from "node:crypto";

// RSS·Google News·원문 페이지가 서로 다른 URL을 가리켜도 같은 출처로 보도록
// 추적 파라미터와 fragment를 제거한 비교용 URL을 만든다.
export function normalizeSourceUrl(raw) {
  if (!raw) return "";
  try {
    const url = new URL(String(raw).trim());
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|gclid$|fbclid$|mc_cid$|mc_eid$|oc$)/i.test(key)) url.searchParams.delete(key);
    }
    url.hostname = url.hostname.toLowerCase();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  } catch {
    return String(raw).trim();
  }
}

export function sourceKeys(value) {
  const item = typeof value === "string" ? { url: value } : value || {};
  return [...new Set([
    item.url,
    item.sourceUrl,
    item.sourceUrlRaw,
    item.finalUrl,
    item.resolvedUrl,
  ].map(normalizeSourceUrl).filter(Boolean))];
}

export function addSourceKeys(set, value) {
  for (const key of sourceKeys(value)) set.add(key);
  return set;
}

export function stableItemId(value, fallback = "item") {
  const keys = sourceKeys(value);
  const preferred = [value?.sourceUrl, value?.finalUrl, value?.resolvedUrl, value?.url, value?.sourceUrlRaw]
    .map(normalizeSourceUrl)
    .find(Boolean);
  const seed = preferred || keys[0] || [value?.sourceLabel, value?.sourceTitle, value?.title, fallback].filter(Boolean).join("|");
  return `v1_${crypto.createHash("sha256").update(seed).digest("hex").slice(0, 16)}`;
}

export function titleKey(title = "") {
  return String(title).toLowerCase().replace(/[^a-z0-9가-힣]/g, "").slice(0, 80);
}
