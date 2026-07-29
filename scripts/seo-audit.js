import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { normalizeContentTier, qualityIssues } from "../src/lib/quality.js";
import { normalizeSourceUrl } from "../src/identity.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, "site");
const ORIGIN = "https://news.vetmanlab.com";
const OUTPUT = path.join(ROOT, "reports", "seo-audit.json");
const RELAY = /^https?:\/\/(?:news\.)?google\.[^/]+\/rss\/articles\//i;
const ERROR_STRINGS = ["병원ugeom", "강아지 주인의 위한", "무뎌지", "원-health", "조객 참여", "백식", "백석", "각제", "수아지"];

function files(dir, suffix = ".html") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full, suffix) : entry.name.endsWith(suffix) ? [full] : [];
  });
}
function read(file) { return fs.readFileSync(file, "utf8"); }
function match(html, pattern) { return html.match(pattern)?.[1] || ""; }
function robots(html) { return match(html, /<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i).toLowerCase(); }
function canonical(html) { return match(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i); }
function title(html) { return match(html, /<title>([\s\S]*?)<\/title>/i).trim(); }
function description(html) { return match(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i); }
function articleUrl(file) { return `${ORIGIN}/article/${path.basename(file, ".html")}`; }
function targetFile(url) {
  if (!url.startsWith(`${ORIGIN}/`)) return null;
  const pathname = decodeURIComponent(new URL(url).pathname).replace(/^\//, "").replace(/\/$/, "");
  if (!pathname) return path.join(SITE, "index.html");
  for (const candidate of [path.join(SITE, pathname), path.join(SITE, `${pathname}.html`), path.join(SITE, pathname, "index.html")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function main() {
  const htmlFiles = files(SITE);
  const pages = htmlFiles.map((file) => ({ file, html: read(file), robots: robots(read(file)), canonical: canonical(read(file)), title: title(read(file)), description: description(read(file)) }));
  const articles = pages.filter((page) => page.file.includes(`${path.sep}article${path.sep}`));
  const indexPages = articles.filter((page) => !page.robots.includes("noindex"));
  const noindexPages = articles.filter((page) => page.robots.includes("noindex"));
  const warnings = [];
  const critical = [];
  const addWarn = (code, detail) => warnings.push({ code, detail });
  const addCritical = (code, detail) => critical.push({ code, detail });

  const byValue = (key) => {
    const map = new Map();
    for (const page of pages) { const value = page[key]; if (value) map.set(value, [...(map.get(value) || []), path.relative(SITE, page.file)]); }
    return [...map.entries()].filter(([, list]) => list.length > 1).map(([value, list]) => ({ value, files: list }));
  };
  const duplicate = { title: byValue("title"), description: byValue("description"), canonical: byValue("canonical") };
  for (const item of duplicate.canonical) addCritical("duplicate-canonical", item);
  for (const item of duplicate.title) addWarn("duplicate-title", item);
  for (const item of duplicate.description) addWarn("duplicate-description", item);

  const errorHits = [];
  for (const page of indexPages) {
    const visible = page.html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
    const hits = ERROR_STRINGS.filter((term) => visible.includes(term));
    if (hits.length) { errorHits.push({ file: path.relative(SITE, page.file), hits }); addCritical("known-quality-string", { file: path.relative(SITE, page.file), hits }); }
    const paragraphs = (visible.match(/<p\b/gi) || []).length;
    if (paragraphs < 3) addCritical("index-under-three-paragraphs", { file: path.relative(SITE, page.file), paragraphs });
    const og = match(page.html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i);
    const hero = /class=["'][^"']*hero-image/.test(page.html);
    if (!og || !hero) addCritical("index-image-missing", { file: path.relative(SITE, page.file), og: Boolean(og), hero });
    const ld = [...page.html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const block of ld) {
      try {
        const value = JSON.parse(block[1].trim());
        if (value.dateModified && !page.html.includes(`article:modified_time" content="${value.dateModified}`)) addWarn("dateModified-screen-mismatch", path.relative(SITE, page.file));
      } catch (error) { addCritical("jsonld-parse", { file: path.relative(SITE, page.file), error: error.message }); }
    }
    if (!page.canonical || page.canonical !== articleUrl(page.file)) addCritical("canonical-url-mismatch", { file: path.relative(SITE, page.file), canonical: page.canonical });
  }
  for (const page of pages) {
    for (const link of page.html.matchAll(/<a\b[^>]+href=["']([^"'#?]+)["']/gi)) {
      const href = link[1];
      if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/")) continue;
      if (!targetFile(`${ORIGIN}${href}`)) addCritical("broken-internal-link", { file: path.relative(SITE, page.file), href });
    }
  }

  const sitemapXml = fs.existsSync(path.join(SITE, "sitemap.xml")) ? read(path.join(SITE, "sitemap.xml")) : "";
  const newsXml = fs.existsSync(path.join(SITE, "news-sitemap.xml")) ? read(path.join(SITE, "news-sitemap.xml")) : "";
  const sitemapUrls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const newsUrls = [...newsXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const url of [...sitemapUrls, ...newsUrls]) { const file = targetFile(url); if (!file) addCritical("sitemap-target-missing", url); else if (robots(read(file)).includes("noindex")) addCritical("noindex-in-sitemap", url); else if (canonical(read(file)) !== url) addCritical("sitemap-canonical-mismatch", { url, canonical: canonical(read(file)) }); }
  const noindexInSitemap = [...new Set(noindexPages.map((page) => page.canonical).filter((url) => sitemapUrls.includes(url) || newsUrls.includes(url)))];

  let xmlError = null;
  try { new XMLParser({ ignoreAttributes: false }).parse(sitemapXml); new XMLParser({ ignoreAttributes: false }).parse(newsXml); new XMLParser({ ignoreAttributes: false }).parse(read(path.join(SITE, "rss.xml"))); } catch (error) { xmlError = error.message; addCritical("xml-parse", error.message); }
  const rss = fs.existsSync(path.join(SITE, "rss.xml")) ? read(path.join(SITE, "rss.xml")) : "";
  const rssItems = [...rss.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  const rssIncomplete = rssItems.filter((item) => !/<content:encoded><!\[CDATA\[[\s\S]+?\]\]><\/content:encoded>/.test(item)).length;
  if (rssIncomplete) addCritical("rss-full-body-missing", rssIncomplete);

  const searchFiles = [path.join(SITE, "search.json"), ...files(path.join(SITE, "search"), ".json")];
  const searchSizes = searchFiles.filter(fs.existsSync).map((file) => ({ file: path.relative(SITE, file), bytes: fs.statSync(file).size }));
  const articleBytes = articles.reduce((sum, page) => sum + Buffer.byteLength(page.html), 0);
  const relayUrls = [];
  const dataFiles = files(path.join(ROOT, "data", "issues"), ".json");
  const searchIds = fs.existsSync(path.join(SITE, "search.json")) ? new Set(JSON.parse(read(path.join(SITE, "search.json"))).items.map((item) => item.id).filter(Boolean)) : new Set();
  const policyRows = [];
  const policySeen = new Set();
  for (const file of dataFiles) { const data = JSON.parse(read(file)); for (const item of data.items || []) { const url = item.sourceUrlRaw || item.sourceUrl || ""; if (RELAY.test(url)) relayUrls.push({ file: path.relative(ROOT, file), id: item.id, title: item.titleKo }); } }
  for (const file of dataFiles.sort().reverse()) {
    const data = JSON.parse(read(file));
    for (const [index, item] of (data.items || []).entries()) {
      const date = path.basename(file, ".json");
      const id = item.id || `${date}_${index + 1}`;
      const source = normalizeSourceUrl(item.finalUrl || item.sourceUrl || item.sourceUrlRaw || "");
      const duplicate = Boolean(source && policySeen.has(source));
      if (source) policySeen.add(source);
      const q = qualityIssues(item);
      const indexable = searchIds.size ? searchIds.has(id) : false;
      const reasons = [];
      if (item.visibility === "suppressed") reasons.push("suppressed");
      if (duplicate) reasons.push("duplicate-source");
      if (normalizeContentTier(item) === "brief") reasons.push("brief-tier");
      for (const issue of q) reasons.push(issue);
      if (!reasons.length && !indexable) reasons.push("build-policy");
      policyRows.push({ date, id, title: item.titleKo || "", indexable, tier: normalizeContentTier(item), paragraphs: Array.isArray(item.bodyKo) ? item.bodyKo.filter(Boolean).length : 0, qualityIssues: q, reasons: [...new Set(reasons)] });
    }
  }
  const reasonCounts = {};
  for (const row of policyRows.filter((row) => !row.indexable)) for (const reason of row.reasons) reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  const audit = {
    generatedAt: new Date().toISOString(),
    status: critical.length ? "failed" : "passed",
    counts: { htmlPages: pages.length, articles: articles.length, index: indexPages.length, noindex: noindexPages.length, sitemap: sitemapUrls.length, newsSitemap: newsUrls.length, rssItems: rssItems.length, rssIncomplete, noindexInSitemap: noindexInSitemap.length, knownQualityHits: errorHits.length, brokenInternalLinks: critical.filter((item) => item.code === "broken-internal-link").length },
    performance: { homepageBytes: fs.existsSync(path.join(SITE, "index.html")) ? fs.statSync(path.join(SITE, "index.html")).size : 0, searchSizes, articleBytes, searchFirstRequestBytes: searchSizes.filter((item) => item.file === "search/2026-07.json")[0]?.bytes || searchSizes.find((item) => item.file === "search.json")?.bytes || 0 },
    duplicate,
    indexPolicy: { previousIndex: 318, currentIndex: indexPages.length, currentNoindex: noindexPages.length, delta: indexPages.length - 318, reasonCounts, samples: { index: policyRows.filter((row) => row.indexable).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20), noindex: policyRows.filter((row) => !row.indexable).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 20) } },
    relayUrls,
    xmlError,
    warnings,
    critical,
  };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, JSON.stringify(audit, null, 2) + "\n");
  console.log(`SEO 감사: ${audit.counts.index} index · ${audit.counts.noindex} noindex · sitemap ${audit.counts.sitemap} · 치명 ${critical.length} · 경고 ${warnings.length}`);
  if (critical.length) { for (const item of critical.slice(0, 20)) console.error(`[CRITICAL] ${item.code}`, item.detail); process.exitCode = 1; }
}

try { main(); } catch (error) { console.error(error); process.exitCode = 1; }
