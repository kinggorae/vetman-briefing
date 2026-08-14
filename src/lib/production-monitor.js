import { recentNewsEntries, sitePublicationDate } from "./publication-dates.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const INDEXABLE_PUBLICATION_STATUSES = new Set(["index-low-risk", "index-analysis"]);

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

export function kstHour(date = new Date()) {
  const hour = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number(hour);
}

// latest.json is the public contract between the daily newsroom and the reader.
// A successful HTTP response alone is not enough: an old edition can keep the
// homepage technically "up" while the newsroom has silently stopped publishing.
export function inspectLatestPayload(payload, {
  today = kstDateString(),
  maxAgeDays = 3,
  minItems = 0,
  requireToday = false,
} = {}) {
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
  } else if (requireToday && ageDays > 0) {
    critical.push({ pathname: "/latest.json", reason: "latest-not-today", date, today, ageDays });
  } else if (ageDays > maxAgeDays) {
    critical.push({ pathname: "/latest.json", reason: "latest-stale", date, today, ageDays, maxAgeDays });
  }

  if (!hasItems && !hasCount) {
    critical.push({ pathname: "/latest.json", reason: "latest-items-invalid" });
  } else if (itemCount === 0) {
    warnings.push({ pathname: "/latest.json", reason: "latest-empty", date });
  }

  if (hasItems && hasCount && payload.count !== itemCount) {
    critical.push({ pathname: "/latest.json", reason: "latest-count-mismatch", declared: payload.count, actual: itemCount });
  }
  if (Number.isInteger(minItems) && minItems > 0 && itemCount !== null && itemCount < minItems) {
    critical.push({ pathname: "/latest.json", reason: "latest-below-minimum", expected: minItems, actual: itemCount });
  }

  return { date, itemCount, ageDays, minItems, requireToday, critical, warnings };
}

function extractInlineJson(html, id) {
  const pattern = new RegExp(`<script\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const match = String(html || "").match(pattern);
  if (!match) return { value: null, error: "missing" };
  try { return { value: JSON.parse(match[1].trim()), error: null }; }
  catch (error) { return { value: null, error: error.message }; }
}

export function inspectHomepageHtml(html = "", { minEditionItems = 30 } = {}) {
  const critical = [];
  const warnings = [];
  const text = String(html || "");
  const inline = extractInlineJson(text, "vm-issue");
  const issue = inline.value;
  const staticItems = issue
    ? [
        ...(Array.isArray(issue.articles) ? issue.articles : []),
        ...(Array.isArray(issue.briefs) ? issue.briefs : []),
        ...(Array.isArray(issue.stories) ? issue.stories : []),
        ...(Array.isArray(issue.recent) ? issue.recent : []),
      ]
    : [];
  const articleLinks = [...text.matchAll(/href=["']\/(?:article|issues\/)[^"']+/gi)].length;

  if (inline.error) critical.push({ reason: `homepage-issue-${inline.error === "missing" ? "missing" : "invalid"}` });
  if (!/<h1\b/i.test(text)) critical.push({ reason: "homepage-h1-missing" });
  if (!/<main\b[^>]*id=["']main-content["']/i.test(text)) critical.push({ reason: "homepage-main-missing" });
  if (!/SearchAction/i.test(text)) critical.push({ reason: "homepage-search-action-missing" });
  if (!/href=["']\/archive\//i.test(text)) critical.push({ reason: "homepage-archive-link-missing" });
  if (issue && (!Number.isInteger(issue.count) || issue.count < minEditionItems)) {
    critical.push({ reason: "homepage-edition-below-minimum", expected: minEditionItems, actual: issue.count ?? null });
  }
  if (issue && staticItems.length < minEditionItems) {
    critical.push({ reason: "homepage-static-items-below-minimum", expected: minEditionItems, actual: staticItems.length });
  }
  if (articleLinks === 0) warnings.push({ reason: "homepage-article-links-missing" });
  return { editionCount: Number.isInteger(issue?.count) ? issue.count : null, staticItemCount: staticItems.length, articleLinks, critical, warnings };
}

export function inspectSearchPayload(payload = {}) {
  const critical = [];
  const items = Array.isArray(payload.items) ? payload.items : null;
  if (!items) critical.push({ reason: "search-items-invalid" });
  if (!Number.isInteger(payload.count) || payload.count < 0) critical.push({ reason: "search-count-invalid" });
  if (items && Number.isInteger(payload.count) && payload.count !== items.length) critical.push({ reason: "search-count-mismatch", declared: payload.count, actual: items.length });
  if (items) {
    const missing = items.filter((item) => !String(item?.id || "").trim() || !String(item?.url || "").trim()).length;
    if (missing) critical.push({ reason: "search-item-key-missing", count: missing });
  }
  return { count: Number.isInteger(payload.count) ? payload.count : null, itemCount: items?.length ?? null, critical };
}

export function inspectSearchManifest(payload = {}, expectedCount = null) {
  const critical = [];
  const chunks = Array.isArray(payload.chunks) ? payload.chunks : null;
  if (!chunks) critical.push({ reason: "search-manifest-chunks-invalid" });
  if (!Number.isInteger(payload.count) || payload.count < 0) critical.push({ reason: "search-manifest-count-invalid" });
  if (Number.isInteger(expectedCount) && payload.count !== expectedCount) critical.push({ reason: "search-manifest-count-mismatch", expected: expectedCount, actual: payload.count });
  if (chunks && Number(payload.count) > 0 && chunks.length === 0) critical.push({ reason: "search-manifest-empty" });
  return { count: Number.isInteger(payload.count) ? payload.count : null, chunkCount: chunks?.length ?? null, critical };
}

export function inspectArchivePayload(payload = {}) {
  const critical = [];
  const warnings = [];
  const issues = Array.isArray(payload.issues) ? payload.issues : null;
  const weeklies = Array.isArray(payload.weeklies) ? payload.weeklies : null;
  if (!issues) critical.push({ reason: "archive-issues-invalid" });
  if (!weeklies) critical.push({ reason: "archive-weeklies-invalid" });
  if (issues && issues.length === 0) warnings.push({ reason: "archive-empty" });
  return { issueCount: issues?.length ?? null, weeklyCount: weeklies?.length ?? null, critical, warnings };
}

export function inspectServiceWorker(body = "", expectedCache = "vmcache-v8") {
  const critical = [];
  const text = String(body || "");
  if (!text.includes(`const C='${expectedCache}'`)) critical.push({ reason: "service-worker-cache-version-mismatch", expected: expectedCache });
  for (const shellPath of ["'/'", "'/latest.json'", "'/archive.json'", "'/search-manifest.json'"]) {
    if (!text.includes(shellPath)) critical.push({ reason: "service-worker-shell-missing", path: shellPath });
  }
  if (!/addEventListener\(['"]fetch['"]/.test(text)) critical.push({ reason: "service-worker-fetch-handler-missing" });
  return { cache: text.match(/const C='([^']+)'/)?.[1] || null, critical };
}

// Keep the production monitor's expectation identical to buildNewsSitemap:
// only indexable articles first published on this site within the News sitemap
// window should be able to trigger an empty-feed failure.
export function recentIndexableNewsCount(items = [], { now = Date.now(), maxAgeDays = 2 } = {}) {
  const entries = (Array.isArray(items) ? items : [])
    .filter((item) => INDEXABLE_PUBLICATION_STATUSES.has(item?.publicationStatus))
    .map((item) => ({ ...item, publishedAt: sitePublicationDate(item) }));
  return recentNewsEntries(entries, { now, maxAgeDays }).length;
}

export function inspectNewsSitemap(body = "", expectedCount = null) {
  const critical = [];
  const text = String(body || "");
  const urlCount = [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].length;
  if (!text.includes('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"')) {
    critical.push({ reason: "news-sitemap-namespace-missing" });
  }
  if (Number.isInteger(expectedCount) && expectedCount !== urlCount) {
    critical.push({ reason: "news-sitemap-count-mismatch", expected: expectedCount, actual: urlCount });
  }
  return { urlCount, critical };
}

function headerValue(headers, name) {
  if (!headers) return "";
  if (typeof headers.get === "function") return String(headers.get(name) || "");
  const target = String(name).toLowerCase();
  return String(Object.entries(headers).find(([key]) => key.toLowerCase() === target)?.[1] || "");
}

function contentTypeFor(pathname) {
  if (pathname.endsWith(".json")) return /application\/json|application\/manifest\+json/i;
  if (pathname.endsWith(".webmanifest")) return /application\/manifest\+json|application\/json/i;
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
