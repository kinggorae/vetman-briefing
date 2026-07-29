// 기사 이미지의 권리 상태는 추정하지 않는다. 데이터에 명시된 값만 신뢰하고,
// 확인되지 않은 외부 이미지는 화면·OG에서 사용하지 않도록 한다.
export const IMAGE_OWNERSHIPS = new Set([
  "owned",
  "licensed",
  "official-press",
  "source-embed",
  "unknown",
]);

export function normalizeImageOwnership(value, { hasImage = false, origin = "" } = {}) {
  const normalized = String(value || "").trim().toLowerCase();
  if (IMAGE_OWNERSHIPS.has(normalized)) return normalized;
  if (origin === "editorial-card") return "owned";
  return hasImage ? "unknown" : null;
}

export function isExternalImage(url = "") {
  try {
    const parsed = new URL(String(url));
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function imageCanRender({ url, ownership, origin } = {}) {
  if (!url) return false;
  if (/^http:\/\//i.test(url)) return false;
  if (origin === "editorial-card" || ownership === "owned" || ownership === "licensed" || ownership === "official-press" || ownership === "source-embed") return true;
  return !isExternalImage(url);
}

export function imageRightsIssues(article = {}) {
  const issues = [];
  const url = article.imageUrl || article.image || "";
  const ownership = normalizeImageOwnership(article.imageOwnership, {
    hasImage: Boolean(url),
    origin: article.imageOrigin,
  });
  if (url && ownership === "unknown") issues.push("image-ownership-unknown");
  if (ownership === "licensed" && !article.imageLicense && !article.imageLicenseUrl) issues.push("licensed-without-proof");
  if (ownership === "official-press" && !article.imageSourceUrl && !article.imageCredit) issues.push("official-press-without-source");
  if (ownership === "source-embed" && !isExternalImage(url)) issues.push("source-embed-not-external");
  if (url && /^http:\/\//i.test(url)) issues.push("image-http");
  return issues;
}

export function effectiveImage(article = {}, fallback = null) {
  const url = article.imageUrl || article.image || null;
  const ownership = normalizeImageOwnership(article.imageOwnership, {
    hasImage: Boolean(url),
    origin: article.imageOrigin,
  });
  if (url && imageCanRender({ url, ownership, origin: article.imageOrigin })) {
    return { url, ownership, origin: article.imageOrigin || "source-image" };
  }
  return fallback ? { ...fallback, ownership: fallback.ownership || "owned" } : null;
}
