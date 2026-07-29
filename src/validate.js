import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XMLParser } from "fast-xml-parser";
import { normalizeSourceUrl } from "./identity.js";
import { isCardRenderable, qualityIssues } from "./quality.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, "data", "issues");
const SITE_DIR = path.join(ROOT, "site");
const SITE_ORIGIN = "https://news.vetmanlab.com";

function fail(message) {
  console.error(`검증 실패: ${message}`);
  process.exitCode = 1;
}

function json(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { fail(`${file}: ${err.message}`); return null; }
}

const files = fs.existsSync(DATA_DIR)
  ? fs.readdirSync(DATA_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()
  : [];
if (!files.length) fail("발행 이슈 파일이 없습니다.");

const issues = files.map((f) => json(path.join(DATA_DIR, f))).filter(Boolean);
const latest = issues[0];
const allIds = new Map();
const allUrls = new Map();
if (latest && (!/^\d{4}-\d{2}-\d{2}$/.test(latest.date) || !Array.isArray(latest.items) || latest.items.length < 5)) {
  fail(`최신 이슈 형식 또는 건수 이상: ${latest.date || "날짜 없음"}`);
}

for (const issue of issues) {
  const ids = new Set();
  const urls = new Set();
  for (const [index, item] of (issue.items || []).entries()) {
    if (item.visibility === "suppressed") {
      if (!Array.isArray(item.suppressedReason) || item.suppressedReason.length === 0) {
        fail(`${issue.date} #${index + 1}: 억제 사유 없음`);
      }
      continue;
    }
    if (!String(item.titleKo || "").trim()) fail(`${issue.date} #${index + 1}: 제목 없음`);
    if (!Array.isArray(item.bodyKo) || !item.bodyKo.join("").trim()) fail(`${issue.date} #${index + 1}: 본문 없음`);
    if (item.id && ids.has(item.id)) fail(`${issue.date}: 중복 id ${item.id}`);
    if (item.id && allIds.has(item.id)) console.warn(`경고: 다른 날짜와 중복 id ${item.id} (${allIds.get(item.id)} → ${issue.date})`);
    if (item.id) {
      ids.add(item.id);
      allIds.set(item.id, issue.date);
    }
    const sourceUrl = normalizeSourceUrl(item.sourceUrl);
    if (sourceUrl && urls.has(sourceUrl)) fail(`${issue.date}: 중복 sourceUrl ${sourceUrl}`);
    if (sourceUrl && allUrls.has(sourceUrl)) fail(`${issue.date}: 다른 날짜와 중복 sourceUrl ${sourceUrl} (${allUrls.get(sourceUrl)} → ${issue.date})`);
    if (sourceUrl) {
      urls.add(sourceUrl);
      allUrls.set(sourceUrl, issue.date);
    }
    const flags = qualityIssues(item);
    if (flags.length) console.warn(`경고: ${issue.date} #${index + 1}: 품질 플래그 ${flags.join(", ")} (기사 페이지는 색인 게이트에서 제외)`);
  }
}

const required = [
  "index.html",
  "latest.json",
  "archive.json",
  "archive/index.html",
  "sources/index.html",
  "search.json",
  "search-manifest.json",
  "sitemap.xml",
  "news-sitemap.xml",
  "rss.xml",
  "robots.txt",
  "_headers",
  "404.html",
  "admin-ui.html",
];
for (const file of required) if (!fs.existsSync(path.join(SITE_DIR, file))) fail(`site/${file} 없음`);
if (fs.existsSync(path.join(SITE_DIR, "admin.html"))) fail("공개 admin.html이 남아 있습니다.");

const searchFile = path.join(SITE_DIR, "search.json");
if (fs.existsSync(searchFile)) {
  const search = json(searchFile);
  if (!search || !Array.isArray(search.items) || search.items.length !== Number(search.count)) fail("search.json 형식 또는 건수 이상");
  const searchIds = new Set(search.items.map((item) => item.id).filter(Boolean));
  if (searchIds.size !== search.items.length) fail("search.json에 중복 id가 있습니다.");
  if (search.items.some((item) => !item.url || !/^https:\/\//.test(item.url))) fail("search.json에 잘못된 기사 URL이 있습니다.");
}

const latestFile = path.join(SITE_DIR, "latest.json");
if (fs.existsSync(latestFile)) {
  const latestPublic = json(latestFile);
  const latestUrls = new Set();
  for (const [index, item] of (latestPublic?.items || []).entries()) {
    if (item.visibility === "suppressed") fail(`site/latest.json #${index + 1}: 억제 항목이 공개 JSON에 남아 있습니다.`);
    if (!isCardRenderable(item)) fail(`site/latest.json #${index + 1}: 카드 렌더링 차단 품질 플래그가 남아 있습니다.`);
    const sourceUrl = normalizeSourceUrl(item.sourceUrl);
    if (sourceUrl && latestUrls.has(sourceUrl)) fail(`site/latest.json 중복 sourceUrl ${sourceUrl}`);
    if (sourceUrl) latestUrls.add(sourceUrl);
  }
}

const manifestFile = path.join(SITE_DIR, "search-manifest.json");
if (fs.existsSync(manifestFile)) {
  const manifest = json(manifestFile);
  if (!manifest || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0) fail("search-manifest.json 형식 이상");
  const chunkCount = manifest.chunks.reduce((sum, chunk) => {
    if (!chunk.href || !/^\/search\/.+\.json$/.test(chunk.href)) fail(`잘못된 검색 청크 경로: ${chunk.href || "없음"}`);
    const file = path.join(SITE_DIR, chunk.href.replace(/^\//, ""));
    if (!fs.existsSync(file)) { fail(`검색 청크 없음: ${chunk.href}`); return sum; }
    const data = json(file);
    if (!data || !Array.isArray(data.items) || data.items.length !== Number(data.count)) fail(`검색 청크 형식 또는 건수 이상: ${chunk.href}`);
    return sum + data.items.length;
  }, 0);
  if (chunkCount !== Number(manifest.count)) fail(`검색 청크 합계 불일치: ${chunkCount} !== ${manifest.count}`);
}

const robots = fs.existsSync(path.join(SITE_DIR, "robots.txt")) ? fs.readFileSync(path.join(SITE_DIR, "robots.txt"), "utf8") : "";
for (const blocked of ["Disallow: /admin", "Disallow: /api/", "Disallow: /raw/", "Disallow: /data/", "Disallow: /search/"]) {
  if (!robots.includes(blocked)) fail(`robots.txt에 ${blocked} 없음`);
}
const headers = fs.existsSync(path.join(SITE_DIR, "_headers")) ? fs.readFileSync(path.join(SITE_DIR, "_headers"), "utf8") : "";
if (!headers.includes("X-Robots-Tag: noindex")) fail("_headers에 내부 경로 noindex 없음");

const sitemap = fs.existsSync(path.join(SITE_DIR, "sitemap.xml")) ? fs.readFileSync(path.join(SITE_DIR, "sitemap.xml"), "utf8") : "";
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (new Set(locs).size !== locs.length) fail("sitemap.xml에 중복 URL이 있습니다.");
if (!sitemap.includes("<urlset")) fail("sitemap.xml 형식 이상");

function htmlFiles(dir = SITE_DIR) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

function canonicalOf(html) {
  return html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || null;
}

function robotsOf(html) {
  return html.match(/<meta[^>]+name=["']robots["'][^>]+content=["']([^"']+)/i)?.[1].toLowerCase() || "";
}

function titleOf(html) {
  return html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim() || null;
}

function descriptionOf(html) {
  return html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i)?.[1] || null;
}

function fileForUrl(url) {
  if (!url.startsWith(`${SITE_ORIGIN}/`)) return null;
  const pathname = decodeURIComponent(new URL(url).pathname);
  if (pathname === "/") return path.join(SITE_DIR, "index.html");
  const clean = pathname.replace(/^\//, "").replace(/\/$/, "");
  const asset = path.join(SITE_DIR, clean);
  if (fs.existsSync(asset) && fs.statSync(asset).isFile()) return asset;
  const direct = path.join(SITE_DIR, `${clean}.html`);
  if (fs.existsSync(direct)) return direct;
  return path.join(SITE_DIR, clean, "index.html");
}

const pageFiles = htmlFiles();
const pageMeta = new Map();
const titles = new Map();
const descriptions = new Map();
const canonicals = new Map();
for (const file of pageFiles) {
  const html = fs.readFileSync(file, "utf8");
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(match[1].trim()); } catch (error) { fail(`${path.relative(SITE_DIR, file)} JSON-LD 파싱 실패: ${error.message}`); }
  }
  const title = titleOf(html);
  const description = descriptionOf(html);
  const canonical = canonicalOf(html);
  const robots = robotsOf(html);
  if (title) { if (titles.has(title)) fail(`중복 title: ${title}`); else titles.set(title, file); }
  if (description) { if (descriptions.has(description)) fail(`중복 description: ${description}`); else descriptions.set(description, file); }
  if (canonical) { if (canonicals.has(canonical)) fail(`중복 canonical: ${canonical}`); else canonicals.set(canonical, file); }
  pageMeta.set(file, { canonical, robots });
  for (const match of html.matchAll(/<a\b[^>]+href=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/api/") || href.startsWith("/search")) continue;
    const target = href.split("#")[0].split("?")[0];
    const targetFile = fileForUrl(`${SITE_ORIGIN}${target || "/"}`);
    if (targetFile && !fs.existsSync(targetFile)) fail(`${path.relative(SITE_DIR, file)} 내부 링크 대상 없음: ${href}`);
  }
}

const homeMeta = pageMeta.get(path.join(SITE_DIR, "index.html"));
if (!homeMeta || homeMeta.robots.includes("noindex")) fail("홈페이지가 noindex입니다.");
for (const loc of locs) {
  const file = fileForUrl(loc);
  if (!file || !fs.existsSync(file)) fail(`sitemap URL의 생성 파일 없음: ${loc}`);
  const meta = file ? pageMeta.get(file) : null;
  if (meta?.robots.includes("noindex")) fail(`noindex URL이 sitemap에 포함됨: ${loc}`);
  if (meta?.canonical !== loc) fail(`sitemap/canonical 불일치: ${loc} / ${meta?.canonical || "없음"}`);
}
for (const [file, meta] of pageMeta) {
  if (meta.robots.includes("noindex") && meta.canonical && locs.includes(meta.canonical)) fail(`noindex 페이지가 sitemap에 포함됨: ${meta.canonical}`);
}

const newsSitemap = fs.existsSync(path.join(SITE_DIR, "news-sitemap.xml"))
  ? fs.readFileSync(path.join(SITE_DIR, "news-sitemap.xml"), "utf8")
  : "";
const newsLocs = [...newsSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (!newsSitemap.includes('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"')) {
  fail("news-sitemap.xml 형식 이상");
}
if (newsSitemap.includes("<loc>undefined</loc>")) fail("news-sitemap.xml에 undefined 기사 URL이 있습니다.");
if (newsLocs.some((url) => !url.startsWith("https://news.vetmanlab.com/article/"))) {
  fail("news-sitemap.xml에 잘못된 기사 URL이 있습니다.");
}
if (new Set(newsLocs).size !== newsLocs.length) fail("news-sitemap.xml에 중복 URL이 있습니다.");
for (const loc of newsLocs) {
  const file = fileForUrl(loc);
  const meta = file ? pageMeta.get(file) : null;
  if (!file || !fs.existsSync(file) || meta?.robots.includes("noindex")) fail(`news sitemap에 색인 불가 URL: ${loc}`);
}

for (const [file, meta] of pageMeta) {
  if (meta.canonical && !meta.canonical.startsWith(`${SITE_ORIGIN}/`) && meta.canonical !== SITE_ORIGIN) fail(`canonical origin 이상: ${file}`);
}
try {
  new XMLParser({ ignoreAttributes: false }).parse(fs.readFileSync(path.join(SITE_DIR, "sitemap.xml"), "utf8"));
  new XMLParser({ ignoreAttributes: false }).parse(fs.readFileSync(path.join(SITE_DIR, "news-sitemap.xml"), "utf8"));
  new XMLParser({ ignoreAttributes: false }).parse(fs.readFileSync(path.join(SITE_DIR, "rss.xml"), "utf8"));
} catch (error) {
  fail(`XML 파싱 실패: ${error.message}`);
}

const home = fs.existsSync(path.join(SITE_DIR, "index.html")) ? fs.readFileSync(path.join(SITE_DIR, "index.html"), "utf8") : "";
if (home.includes("#202") && home.includes('"@type":"NewsArticle"')) fail("홈 JSON-LD에 legacy hash 기사 URL이 남아 있습니다.");
const firstScript = home.indexOf('<script id="vm-issue"');
const initialHtml = firstScript >= 0 ? home.slice(0, firstScript) : home;
if (!initialHtml.includes('id="main-content"') || !/href="\/(?:article|issues)\/[^"]+"/.test(initialHtml)) {
  fail("홈 원본 HTML에 크롤링 가능한 본문·기사 링크가 없습니다.");
}
if (firstScript >= 0) {
  const endScript = home.indexOf("</script>", firstScript);
  try {
    const issueData = JSON.parse(home.slice(home.indexOf(">", firstScript) + 1, endScript));
    const visibleCount = [issueData.articles, issueData.briefs, issueData.stories]
      .reduce((sum, list) => sum + (Array.isArray(list) ? list.length : 0), 0);
    const initialVisibleCount = issueData.initialCounts
      ? ["articles", "briefs", "stories"].reduce((sum, key) => sum + Number(issueData.initialCounts[key] || 0), 0)
      : visibleCount;
    if (Number(issueData.count) !== initialVisibleCount) fail("홈 기사 수 표기 불일치: " + issueData.count + " !== " + initialVisibleCount);
    if (visibleCount > 0 && (initialHtml.match(/href="\/(?:article|issues)\//g) || []).length < Math.min(visibleCount, 24)) {
      fail("홈 원본 HTML 기사 링크 부족: " + visibleCount + "건 중 정적 링크 부족");
    }
  } catch (err) {
    fail("홈 vm-issue JSON 형식 이상: " + err.message);
  }
}
if (/vm-search\{display:none\s*!important/.test(home)) fail("모바일 검색창이 숨겨져 있습니다.");

const rss = fs.existsSync(path.join(SITE_DIR, "rss.xml")) ? fs.readFileSync(path.join(SITE_DIR, "rss.xml"), "utf8") : "";
if (!/<item>[\s\S]*?<link>https:\/\/news\.vetmanlab\.com\/article\//.test(rss)) {
  fail("RSS가 개별 기사 URL을 제공하지 않습니다.");
}
for (const directoryUrl of ["https://news.vetmanlab.com/archive/", "https://news.vetmanlab.com/sources/"]) {
  if (!sitemap.includes(`<loc>${directoryUrl}</loc>`)) fail(`sitemap.xml에 ${directoryUrl} 없음`);
}
if (home.includes("vetman2026")) fail("관리자 비밀번호가 빌드 결과에 남아 있습니다.");

// 개별 기사 canonical이 중복되면 서로 다른 파일이 검색 결과에서 경쟁한다.
// 제목 교정·legacySlug 이관 시 회귀를 조기에 잡기 위한 정적 검증이다.
const articleDir = path.join(SITE_DIR, "article");
if (fs.existsSync(articleDir)) {
  const canonicals = new Map();
  for (const file of fs.readdirSync(articleDir).filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(articleDir, file), "utf8");
    const match = html.match(/<link rel="canonical" href="([^"]+)"/);
    if (!match) { fail(`site/article/${file}: canonical 없음`); continue; }
    if (canonicals.has(match[1])) fail(`중복 canonical ${match[1]} (${canonicals.get(match[1])}, ${file})`);
    canonicals.set(match[1], file);
  }
}

console.log(`검증 완료: ${issues.length}개 이슈, 최신 ${latest?.date || "없음"}, sitemap ${locs.length}개 URL`);
