const DAY_MS = 24 * 60 * 60 * 1000;

function isCalendarDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function calendarMs(value) {
  if (!isCalendarDate(value)) return NaN;
  const [year, month, day] = String(value).split("-").map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : NaN;
}

export function kstDateString(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function calendarAgeDays(latestDate, today = kstDateString()) {
  const latestMs = calendarMs(latestDate);
  const todayMs = calendarMs(today);
  if (!Number.isFinite(latestMs) || !Number.isFinite(todayMs)) return null;
  return Math.round((todayMs - latestMs) / DAY_MS);
}

// latest.json is the public contract between the daily newsroom and the reader.
// A successful HTTP response alone is not enough: an old edition can keep the
// homepage technically "up" while the newsroom has silently stopped publishing.
export function inspectLatestPayload(payload, { today = kstDateString(), maxAgeDays = 3 } = {}) {
  const critical = [];
  const warnings = [];
  const date = payload?.date || null;
  const hasItems = Array.isArray(payload?.items);
  const hasCount = Number.isInteger(payload?.count) && payload.count >= 0;
  const itemCount = hasItems ? payload.items.length : hasCount ? payload.count : null;
  const ageDays = calendarAgeDays(date, today);

  if (ageDays === null) {
    critical.push({ pathname: "/latest.json", reason: "latest-date-invalid", date });
  } else if (ageDays < 0) {
    warnings.push({ pathname: "/latest.json", reason: "latest-date-in-future", date, today, ageDays });
  } else if (ageDays > maxAgeDays) {
    critical.push({ pathname: "/latest.json", reason: "latest-stale", date, today, ageDays, maxAgeDays });
  }

  if (!hasItems && !hasCount) {
    critical.push({ pathname: "/latest.json", reason: "latest-items-invalid" });
  } else if (itemCount === 0) {
    warnings.push({ pathname: "/latest.json", reason: "latest-empty", date });
  }

  return { date, itemCount, ageDays, critical, warnings };
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const target = String(name).toLowerCase();
  return String(Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1] || "");
}

function contentTypeFor(pathname) {
  if (pathname.endsWith(".json")) return /application\/json|application\/manifest\+json/i;
  if (pathname.endsWith(".xml")) return /application\/xml|text\/xml/i;
  if (pathname.endsWith(".js")) return /application\/javascript|text\/javascript/i;
  if (pathname === "/robots.txt") return /text\/plain/i;
  return /text\/html/i;
}

export function inspectResponseContract({ pathname, status, headers, body = "" } = {}) {
  const critical = [];
  const warnings = [];
  const contentType = headerValue(headers, "content-type");
  const cacheControl = headerValue(headers, "cache-control");
  const nosniff = headerValue(headers, "x-content-type-options").toLowerCase();

  if (!Number.isInteger(status) || status < 200 || status >= 300) critical.push({ pathname, reason: `http-${status ?? "invalid"}` });
  if (!contentType || !contentTypeFor(pathname).test(contentType)) critical.push({ pathname, reason: "content-type-invalid", contentType });
  if (nosniff !== "nosniff") warnings.push({ pathname, reason: "x-content-type-options-missing" });
  if (!cacheControl) warnings.push({ pathname, reason: "cache-control-missing" });
  if (pathname === "/" && !/<h1\b/i.test(body)) critical.push({ pathname, reason: "h1-missing" });
  if (pathname === "/" && !/<main\b[^>]*id=["']main-content["']/i.test(body)) warnings.push({ pathname, reason: "main-content-missing" });
  if (pathname === "/deployment.json" && !/noindex/i.test(headerValue(headers, "x-robots-tag"))) warnings.push({ pathname, reason: "deployment-noindex-header-missing" });
  return { contentType, cacheControl, critical, warnings };
}

function extractCanonical(html) {
  return html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1]
    || html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1]
    || "";
}

export function inspectArticleHtml(html = "", expectedUrl = "") {
  const critical = [];
  const warnings = [];
  const canonical = extractCanonical(html);
  const noindex = /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  const jsonLdTypes = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1].trim());
      const entries = Array.isArray(value) ? value : [value];
      for (const entry of entries) for (const type of [].concat(entry?.["@type"] || [])) jsonLdTypes.push(type);
    } catch {
      critical.push({ reason: "article-jsonld-invalid" });
    }
  }
  if (!canonical) critical.push({ reason: "article-canonical-missing" });
  else if (expectedUrl && canonical !== expectedUrl) critical.push({ reason: "article-canonical-mismatch", canonical, expectedUrl });
  if (noindex) critical.push({ reason: "article-noindex" });
  if (!/<h1\b/i.test(html)) critical.push({ reason: "article-h1-missing" });
  if (!jsonLdTypes.some((type) => ["Article", "NewsArticle", "Report"].includes(type))) warnings.push({ reason: "article-jsonld-article-type-missing", jsonLdTypes });
  return { canonical, noindex, jsonLdTypes, critical, warnings };
}

export function inspectDeploymentPayload(payload = {}) {
  const critical = [];
  if (payload.version !== 1) critical.push({ reason: "deployment-version-invalid" });
  if (!payload.builtAt || Number.isNaN(Date.parse(payload.builtAt))) critical.push({ reason: "deployment-built-at-invalid" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(payload.latestDate || ""))) critical.push({ reason: "deployment-latest-date-invalid" });
  if (!/^local$|^[0-9a-f]{7,64}$/i.test(String(payload.sourceCommit || ""))) critical.push({ reason: "deployment-source-commit-invalid" });
  for (const key of ["publicArticleCount", "searchCount", "sitemapCount"]) if (!Number.isInteger(payload[key]) || payload[key] < 0) critical.push({ reason: `deployment-${key}-invalid` });
  if (payload.newsSitemapCount !== undefined && (!Number.isInteger(payload.newsSitemapCount) || payload.newsSitemapCount < 0)) critical.push({ reason: "deployment-newsSitemapCount-invalid" });
  return { critical };
}

const DEPLOYMENT_MATCH_FIELDS = ["version", "sourceCommit", "latestDate", "publicArticleCount", "searchCount", "sitemapCount", "newsSitemapCount"];

export function compareDeploymentPayload(actual = {}, expected = {}) {
  const critical = [];
  for (const field of DEPLOYMENT_MATCH_FIELDS) {
    if (String(actual[field] ?? "") !== String(expected[field] ?? "")) {
      critical.push({ reason: `deployment-${field}-mismatch`, expected: expected[field] ?? null, actual: actual[field] ?? null });
    }
  }
  return { critical };
}
