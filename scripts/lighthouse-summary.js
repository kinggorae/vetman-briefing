import fs from "node:fs/promises";
import path from "node:path";
const dir = "reports/lighthouse";
const files = await fs.readdir(dir).catch(() => []);
const rows = [];
for (const file of files.filter((name) => name.endsWith(".json"))) {
  const value = await fs.readFile(path.join(dir, file), "utf8").then(JSON.parse).catch(() => null);
  if (!value?.categories) continue;
  const stat = await fs.stat(path.join(dir, file));
  rows.push({ file, mtimeMs: stat.mtimeMs, url: value.finalUrl, performance: value.categories.performance?.score, accessibility: value.categories.accessibility?.score, bestPractices: value.categories["best-practices"]?.score, seo: value.categories.seo?.score, cls: value.audits["cumulative-layout-shift"]?.numericValue ?? null, lcp: value.audits["largest-contentful-paint"]?.numericValue ?? null });
}
const median = (values) => { const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const urls = [...new Set(rows.map((row) => row.url))].map((url) => { const group = rows.filter((row) => row.url === url).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 3); return { url, runs: group.length, performance: median(group.map((row) => row.performance)), accessibility: median(group.map((row) => row.accessibility)), bestPractices: median(group.map((row) => row.bestPractices)), seo: median(group.map((row) => row.seo)), cls: median(group.map((row) => row.cls)), lcp: median(group.map((row) => row.lcp)) }; });
const result = { generatedAt: new Date().toISOString(), runsPerUrl: 3, urls, warnings: urls.filter((row) => row.performance < .8 || row.cls > .1 || row.lcp > 2500).map((row) => ({ url: row.url, performance: row.performance, cls: row.cls, lcp: row.lcp })) };
await fs.writeFile("reports/lighthouse-summary.json", JSON.stringify(result, null, 2) + "\n");
await fs.writeFile("reports/lighthouse-summary.md", [`# Lighthouse CI 중앙값`, ``, `- URL별 3회 실행 중앙값`, ``, ...urls.map((row) => `- ${row.url}: Performance ${Math.round(row.performance * 100)}, Accessibility ${Math.round(row.accessibility * 100)}, Best Practices ${Math.round(row.bestPractices * 100)}, SEO ${Math.round(row.seo * 100)}, CLS ${row.cls}, LCP ${Math.round(row.lcp)}ms`), ``, `경고: ${result.warnings.length}개 (네트워크 변동 포함)`].join("\n") + "\n");
console.log(`Lighthouse 중앙값 저장: ${urls.length} URL · warning ${result.warnings.length}`);
