import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSourceUrl } from "./identity.js";
import { qualityIssues } from "./quality.js";

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
    if (sourceUrl && allUrls.has(sourceUrl)) console.warn(`경고: 다른 날짜와 중복 sourceUrl ${sourceUrl} (${allUrls.get(sourceUrl)} → ${issue.date})`);
    if (sourceUrl) {
      urls.add(sourceUrl);
      allUrls.set(sourceUrl, issue.date);
    }
    const quality = qualityIssues(item).filter((flag) => flag === "foreign-script" || flag === "untranslated-term");
    if (quality.length) fail(`${issue.date} #${index + 1}: 품질 플래그 ${quality.join(", ")}`);
  }
}

const required = ["index.html", "latest.json", "archive.json", "sitemap.xml", "news-sitemap.xml", "robots.txt", "404.html", "admin-ui.html"];
for (const file of required) if (!fs.existsSync(path.join(SITE_DIR, file))) fail(`site/${file} 없음`);
if (fs.existsSync(path.join(SITE_DIR, "admin.html"))) fail("공개 admin.html이 남아 있습니다.");

const robots = fs.existsSync(path.join(SITE_DIR, "robots.txt")) ? fs.readFileSync(path.join(SITE_DIR, "robots.txt"), "utf8") : "";
for (const blocked of ["Disallow: /admin", "Disallow: /raw"]) if (!robots.includes(blocked)) fail(`robots.txt에 ${blocked} 없음`);

const sitemap = fs.existsSync(path.join(SITE_DIR, "sitemap.xml")) ? fs.readFileSync(path.join(SITE_DIR, "sitemap.xml"), "utf8") : "";
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (new Set(locs).size !== locs.length) fail("sitemap.xml에 중복 URL이 있습니다.");
if (!sitemap.includes("<urlset")) fail("sitemap.xml 형식 이상");

const home = fs.existsSync(path.join(SITE_DIR, "index.html")) ? fs.readFileSync(path.join(SITE_DIR, "index.html"), "utf8") : "";
if (home.includes("#202") && home.includes('"@type":"NewsArticle"')) fail("홈 JSON-LD에 legacy hash 기사 URL이 남아 있습니다.");
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
