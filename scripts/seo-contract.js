import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSeoContract } from "../src/lib/seo-contract.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, "site");
const ORIGIN = "https://news.vetmanlab.com";
const REPORT = path.join(ROOT, "reports", "seo-contract.json");
const critical = [];
const warnings = [];
const pages = [];

function read(file) { return fs.readFileSync(file, "utf8"); }
function urlsFrom(file) {
  if (!fs.existsSync(file)) return [];
  return [...read(file).matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
}
function targetFile(url) {
  if (!url.startsWith(`${ORIGIN}/`)) return null;
  const pathname = decodeURIComponent(new URL(url).pathname).replace(/^\//, "").replace(/\/$/, "");
  if (!pathname) return path.join(SITE, "index.html");
  for (const candidate of [path.join(SITE, pathname), path.join(SITE, `${pathname}.html`), path.join(SITE, pathname, "index.html")]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const urls = [...new Set([...urlsFrom(path.join(SITE, "sitemap.xml")), ...urlsFrom(path.join(SITE, "news-sitemap.xml"))])];
for (const url of urls) {
  const file = targetFile(url);
  if (!file) {
    critical.push({ url, reason: "sitemap-target-missing" });
    continue;
  }
  const result = validateSeoContract({ url, html: read(file), origin: ORIGIN });
  pages.push({ file: path.relative(SITE, file), ...result });
  critical.push(...result.critical.map((item) => ({ file: path.relative(SITE, file), ...item })));
  warnings.push(...result.warnings.map((item) => ({ file: path.relative(SITE, file), ...item })));
}

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  status: critical.length ? "failed" : "passed",
  counts: {
    sitemapUrls: urls.length,
    checkedPages: pages.length,
    critical: critical.length,
    warnings: warnings.length,
    byKind: Object.fromEntries(["article", "collection", "topic", "page"].map((kind) => [kind, pages.filter((page) => page.kind === kind).length])),
  },
  critical,
  warnings,
};
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(result, null, 2) + "\n");
console.log(`SEO 계약: ${pages.length}/${urls.length} 페이지 · 치명 ${critical.length} · 경고 ${warnings.length}`);
if (critical.length) process.exitCode = 1;
