import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { fileURLToPath } from "node:url";
import { normalizeSourceUrl } from "../identity.js";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const SOURCE_REGISTRY_PATH = path.join(ROOT, "data", "sources", "registry.json");
export const SOURCE_CACHE_DIR = path.join(ROOT, ".source-cache", "feeds");
export const SOURCE_HEALTH_PATH = path.join(ROOT, "reports", "source-health.json");
export const SOURCE_USER_AGENT = "VetManLab-SourceFirst/5.0 (+https://news.vetmanlab.com/about)";
export const MAX_FEED_BYTES = 2_000_000;
export const MAX_FEED_ENTRIES = 1_000;
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text" });
const RELAY = /^https?:\/\/(?:news\.)?google\.[^/]+\/rss\/articles\//i;
const robotsCache = new Map();

export function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

export function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, file);
}

export function sourceId(label = "source") {
  const slug = String(label).normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 56);
  return `src-${slug || crypto.createHash("sha1").update(label).digest("hex").slice(0, 10)}`;
}

export function normalizeSource(source = {}) {
  const label = String(source.label || source.officialName || source.name || "").trim();
  const domains = [...new Set([...(source.officialDomains || source.domains || [])].map((x) => String(x).toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter(Boolean))];
  const rssUrls = [...new Set([...(source.rssUrls || source.feeds || [])].filter(Boolean))];
  const atomUrls = [...new Set([...(source.atomUrls || [])].filter(Boolean))];
  const sitemapUrls = [...new Set([...(source.sitemapUrls || [])].filter(Boolean))];
  const active = source.enabled ?? source.active ?? Boolean(domains.length && (rssUrls.length || atomUrls.length));
  return {
    ...source,
    id: source.id || sourceId(label),
    label,
    officialName: source.officialName || label,
    domains,
    officialDomains: domains,
    rssUrls,
    atomUrls,
    sitemapUrls,
    fetchStrategy: source.fetchStrategy || (rssUrls.length || atomUrls.length ? "rss" : "manual"),
    rateLimitMs: Math.max(250, Number(source.rateLimitMs) || 1000),
    timeoutMs: Math.min(60000, Math.max(3000, Number(source.timeoutMs) || 12000)),
    language: source.language || "en",
    timezone: source.timezone || "UTC",
    enabled: Boolean(active),
    active: Boolean(active),
    priority: Number.isFinite(Number(source.priority)) ? Number(source.priority) : (active ? 50 : 0),
    lastSuccessAt: source.lastSuccessAt || null,
    lastFailureAt: source.lastFailureAt || null,
    consecutiveFailures: Number(source.consecutiveFailures) || 0,
    healthStatus: source.healthStatus || (active ? "unknown" : "disabled"),
    notes: source.notes || null,
  };
}

export function loadRegistry() {
  const raw = readJson(SOURCE_REGISTRY_PATH, { version: 2, sources: [] });
  const sources = Array.isArray(raw) ? raw : raw.sources || [];
  return { ...raw, version: Math.max(2, Number(raw.version) || 2), sources: sources.map(normalizeSource) };
}

export function hostOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
}

export function isOfficialUrl(url, source) {
  const host = hostOf(url);
  return Boolean(host && (source.officialDomains || source.domains || []).some((domain) => host === domain || host.endsWith(`.${domain}`)));
}

export function isRelayUrl(url) { return RELAY.test(String(url || "")); }

export function safeSourceUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !isRelayUrl(url) && !/(?:\/search[/?]|\/tag[/?]|\/category[/?]|\/author[/?]|\/login|\/subscribe)/i.test(`${parsed.hostname}${parsed.pathname}`);
  } catch { return false; }
}

export function normalizeTitle(value = "") {
  return String(value).replace(/<[^>]+>/g, " ").replace(/&(?:amp|nbsp|quot|#39);/gi, " ").normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]+/gi, " ").replace(/\s+/g, " ").trim();
}

export function titleSimilarity(a, b) {
  const left = new Set(normalizeTitle(a).split(" ").filter((x) => x.length > 1));
  const right = new Set(normalizeTitle(b).split(" ").filter((x) => x.length > 1));
  if (!left.size || !right.size) return 0;
  return Number(([...left].filter((x) => right.has(x)).length / Math.max(left.size, right.size)).toFixed(3));
}

export function contentHash(value) { return crypto.createHash("sha256").update(String(value || "")).digest("hex"); }
export function metadataHash(value) { return contentHash(JSON.stringify(value)); }

function array(value) { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function text(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "object") return value["#text"] ? String(value["#text"]) : Object.values(value).filter((x) => typeof x === "string").join(" ");
  return "";
}
function firstLink(value) {
  for (const entry of array(value)) {
    if (typeof entry === "string") return entry;
    if (entry?.["@_href"]) return entry["@_href"];
    if (entry?.["#text"]) return entry["#text"];
  }
  return "";
}
function dateValue(entry) { return entry?.pubDate || entry?.published || entry?.updated || entry?.["dc:date"] || entry?.date || null; }

export function parseFeed(xml, feedUrl, source) {
  const bytes = Buffer.byteLength(String(xml || ""), "utf8");
  if (bytes > MAX_FEED_BYTES) throw new Error(`피드 응답이 너무 큽니다: ${bytes} bytes`);
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(String(xml || ""))) throw new Error("DOCTYPE/ENTITY가 포함된 XML은 처리하지 않습니다");
  if (/\u0000/.test(String(xml || ""))) throw new Error("허용되지 않는 제어 문자가 포함된 XML입니다");
  const root = parser.parse(xml);
  const channel = root?.rss?.channel || root?.feed || root?.["rdf:RDF"] || {};
  const rawEntries = array(channel.item || channel.entry);
  if (rawEntries.length > MAX_FEED_ENTRIES) throw new Error(`피드 항목이 너무 많습니다: ${rawEntries.length}`);
  const entries = rawEntries.map((entry) => {
    const url = normalizeSourceUrl(firstLink(entry.link) || text(entry.guid) || text(entry.id));
    const identifier = text(entry["dc:identifier"]) || "";
    const canonicalValue = text(entry.canonical) || "";
    const canonicalRaw = isUrl(canonicalValue) ? canonicalValue : (isUrl(identifier) ? identifier : "");
    const explicitCanonical = normalizeSourceUrl(canonicalRaw);
    // Wiley·Crossref 계열 피드는 dc:identifier에 article URL 대신 DOI를 넣는다.
    // DOI를 canonical URL로 저장하면 sourceStatusFor가 30건을 unresolved로
    // 분류하고, 같은 공식 article URL을 다시 확인하지 못한다. DOI는 별도
    // 메타데이터로 보존하고, 안전한 공식 feed item URL을 canonical 후보로 쓴다.
    const doi = normalizeDoi(identifier) || normalizeDoi(canonicalValue);
    const feedItemCanonical = doi && isOfficialUrl(url, source) && safeSourceUrl(url) ? url : null;
    const publishedRaw = dateValue(entry);
    const publishedAt = publishedRaw && !Number.isNaN(new Date(publishedRaw).getTime()) ? new Date(publishedRaw).toISOString() : null;
    const title = text(entry.title).replace(/\s+/g, " ").trim();
    const description = text(entry.description || entry.summary || entry["content:encoded"] || entry.content).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 1200);
    return {
      guid: text(entry.guid) || text(entry.id) || url || contentHash(`${title}|${publishedAt}`),
      title, url, canonicalUrl: explicitCanonical || feedItemCanonical || null, doi, publishedAt, description,
      sourceId: source.id, sourceLabel: source.label, feedUrl,
      official: isOfficialUrl(explicitCanonical || url, source), relay: isRelayUrl(url),
    };
  }).filter((entry) => entry.title && entry.url);
  return { root, entries, isFeed: Boolean(root?.rss || root?.feed || root?.["rdf:RDF"]) };
}

function isUrl(value) {
  try { return /^https?:$/i.test(new URL(String(value || "")).protocol); } catch { return false; }
}

function normalizeDoi(value) {
  const candidate = String(value || "").trim().replace(/^doi:\s*/i, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "");
  return /^10\.\d{4,9}\/\S+$/i.test(candidate) ? candidate.replace(/[.,;)]+$/, "") : null;
}

export function cachePath(url) { return path.join(SOURCE_CACHE_DIR, `${crypto.createHash("sha256").update(url).digest("hex")}.json`); }
export function pageCachePath(url) { return path.join(SOURCE_CACHE_DIR, "pages", `${crypto.createHash("sha256").update(url).digest("hex")}.json`); }
export function readFeedCache(url) { return readJson(cachePath(url), null); }
export function writeFeedCache(url, value) { atomicWrite(cachePath(url), JSON.stringify(value, null, 2) + "\n"); }

function metaContent(html, name) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i");
  const match = String(html || "").match(pattern);
  return match?.[1] || match?.[2] || null;
}
function linkCanonical(html) {
  const match = String(html || "").match(/<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>|<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*canonical[^"']*["'][^>]*>/i);
  return match?.[1] || match?.[2] || null;
}
async function robotsAllows(url, source) {
  const parsed = new URL(url); const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
  let rules = robotsCache.get(robotsUrl);
  if (!rules) {
    try { const response = await fetch(robotsUrl, { headers: { "User-Agent": source.userAgent || SOURCE_USER_AGENT }, signal: AbortSignal.timeout(source.timeoutMs) }); rules = response.ok ? await response.text() : ""; } catch { rules = ""; }
    robotsCache.set(robotsUrl, rules);
  }
  let active = false;
  for (const line of String(rules).split(/\r?\n/)) {
    const clean = line.split("#")[0].trim();
    if (/^user-agent\s*:\s*\*/i.test(clean)) active = true;
    else if (/^user-agent\s*:/i.test(clean)) active = false;
    else if (active && /^disallow\s*:/i.test(clean)) {
      const blocked = clean.replace(/^disallow\s*:/i, "").trim();
      if (blocked && parsed.pathname.startsWith(blocked)) return false;
    }
  }
  return true;
}
export async function fetchArticleMetadata(source, url, { useCache = true } = {}) {
  if (!safeSourceUrl(url) || isRelayUrl(url) || !isOfficialUrl(url, source)) throw new Error("공식 개별 기사 URL이 아닙니다");
  if (!(await robotsAllows(url, source))) throw new Error("robots.txt가 해당 URL 수집을 허용하지 않습니다");
  const cachedPath = pageCachePath(url);
  const cached = useCache ? readJson(cachedPath, null) : null;
  if (cached) return { ...cached, fromCache: true };
  const response = await fetch(url, { headers: { "User-Agent": source.userAgent || SOURCE_USER_AGENT, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(source.timeoutMs) });
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!/html|xhtml/i.test(contentType)) throw new Error(`HTML이 아닙니다: ${contentType || "MIME 없음"}`);
  const html = (await response.text()).slice(0, 500000);
  const canonicalRaw = linkCanonical(html);
  const result = {
    checkedAt: new Date().toISOString(), status: response.status, finalUrl: response.url || url, contentType,
    canonicalUrl: canonicalRaw ? normalizeSourceUrl(new URL(canonicalRaw, response.url || url).toString()) : null,
    title: metaContent(html, "og:title") || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || null,
    publishedAt: metaContent(html, "article:published_time") || metaContent(html, "datePublished") || null,
    hash: contentHash(`${canonicalRaw || ""}|${response.url || url}`),
  };
  atomicWrite(cachedPath, JSON.stringify(result, null, 2) + "\n");
  return { ...result, fromCache: false };
}

export async function fetchFeed(source, url, { useCache = true, maxCacheAgeMs = 86400000, retries = 2, force = false } = {}) {
  const cached = useCache ? readFeedCache(url) : null;
  const started = Date.now();
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers = { "User-Agent": source.userAgent || SOURCE_USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" };
      if (!force && cached?.etag) headers["If-None-Match"] = cached.etag;
      if (!force && cached?.lastModified) headers["If-Modified-Since"] = cached.lastModified;
      const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(source.timeoutMs) });
      const contentType = response.headers.get("content-type") || "";
      const etag = response.headers.get("etag") || cached?.etag || null;
      const lastModified = response.headers.get("last-modified") || cached?.lastModified || null;
      if (response.status === 304 && cached) {
        const result = { ...cached, checkedAt: new Date().toISOString(), status: 304, contentType: cached.contentType || contentType, etag, lastModified, notModified: true, fromCache: true };
        writeFeedCache(url, result);
        return result;
      }
      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (declaredLength > MAX_FEED_BYTES) throw new Error(`피드 응답이 너무 큽니다: ${declaredLength} bytes`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_FEED_BYTES) throw new Error(`피드 응답이 너무 큽니다: ${buffer.length} bytes`);
      const body = buffer.toString("utf8");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parsed = parseFeed(body, response.url || url, source);
      if (!parsed.isFeed) throw new Error("RSS/Atom/XML 형식이 아닙니다");
      if (!parsed.entries.length && cached?.entries?.length) throw new Error("빈 피드 응답으로 기존 캐시를 덮어쓰지 않습니다");
      const result = { fetchedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), url, finalUrl: response.url || url, redirected: (response.url || url) !== url, status: response.status, contentType, etag, lastModified, responseBytes: buffer.length, elapsedMs: Date.now() - started, consecutiveFailures: 0, ...parsed };
      writeFeedCache(url, result);
      return { ...result, fromCache: false };
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        const backoff = Math.min(8000, Math.max(250, source.rateLimitMs) * (2 ** attempt));
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  if (cached && Date.now() - new Date(cached.fetchedAt || 0).getTime() <= maxCacheAgeMs) return { ...cached, fromCache: true, error: lastError?.message || "fetch failed", lastError: lastError?.message || null };
  throw lastError || new Error("feed fetch failed");
}

export function dedupeFeedEntries(entries, existing = []) {
  const seen = new Map();
  const titles = [];
  for (const item of existing) {
    const title = item.sourceTitle || item.titleKo || item.title || "";
    for (const key of [item.canonicalUrl, item.url, item.sourceUrl, item.sourceUrlRaw, item.doi, item.guid].filter(Boolean)) seen.set(String(key), { type: "existing", id: item.id || null, title });
    if (title) titles.push({ type: "existing", id: item.id || null, title });
  }
  return entries.map((entry) => {
    const keys = [entry.canonicalUrl, normalizeSourceUrl(entry.url), entry.guid].filter(Boolean).map(String);
    const exact = keys.map((key) => seen.get(key)).find(Boolean);
    const prior = titles.find((row) => row.title && titleSimilarity(row.title, entry.title) >= 0.9);
    const duplicate = exact || prior;
    const status = exact ? "exact-duplicate" : prior ? "update-of-existing" : "unique";
    for (const key of keys) seen.set(key, { type: "incoming", id: entry.guid, title: entry.title });
    titles.push({ type: "incoming", id: entry.guid, title: entry.title });
    return { ...entry, duplicateStatus: status, duplicateOf: duplicate?.id || null };
  });
}

export function sourceStatusFor(entry, source) {
  if (!entry.url || !safeSourceUrl(entry.url)) return "unresolved";
  if (isRelayUrl(entry.url) || !entry.canonicalUrl) return "unresolved";
  if (!isOfficialUrl(entry.canonicalUrl, source)) return "unresolved";
  return "verified";
}
