import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSourceUrl } from "./identity.js";
import { publishQualityIssues, qualityIssues } from "./quality.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, "data", "issues");
const SITE_DIR = path.join(ROOT, "site");

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
    const blockers = publishQualityIssues(item);
    if (blockers.length) fail(`${issue.date} #${index + 1}: 공개 차단 품질 플래그 ${blockers.join(", ")}`);
    const warnings = qualityIssues(item).filter((flag) => !blockers.includes(flag));
    if (warnings.length) console.warn(`경고: ${issue.date} #${index + 1}: 품질 플래그 ${warnings.join(", ")}`);
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
    const blockers = publishQualityIssues(item);
    if (blockers.length) fail(`site/latest.json #${index + 1}: 공개 차단 품질 플래그 ${blockers.join(", ")}`);
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

const home = fs.existsSync(path.join(SITE_DIR, "index.html")) ? fs.readFileSync(path.join(SITE_DIR, "index.html"), "utf8") : "";
if (home.includes("#202") && home.includes('"@type":"NewsArticle"')) fail("홈 JSON-LD에 legacy hash 기사 URL이 남아 있습니다.");
const firstScript = home.indexOf('<script id="vm-issue"');
const initialHtml = firstScript >= 0 ? home.slice(0, firstScript) : home;
if (!initialHtml.includes('id="main-content"') || !/href="\/article\/[^"]+"/.test(initialHtml)) {
  fail("홈 원본 HTML에 크롤링 가능한 본문·기사 링크가 없습니다.");
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
