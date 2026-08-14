import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectDeploymentPayload } from "../src/lib/production-monitor.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, "site");
const REPORT = path.join(ROOT, "reports", "deploy-guard.json");
const critical = [];
const warnings = [];

function json(name) {
  try { return JSON.parse(fs.readFileSync(path.join(SITE, name), "utf8")); }
  catch (error) { critical.push({ file: name, reason: `json-${error.message}` }); return null; }
}
function requireFile(name) { if (!fs.existsSync(path.join(SITE, name))) critical.push({ file: name, reason: "missing" }); }

for (const file of ["index.html", "latest.json", "deployment.json", "search-manifest.json", "admin-review.json", "sitemap.xml", "news-sitemap.xml", "robots.txt", "_headers", "sw.js"]) requireFile(file);
const deployment = json("deployment.json");
if (deployment) critical.push(...inspectDeploymentPayload(deployment).critical.map((item) => ({ file: "deployment.json", ...item })));
const latest = json("latest.json");
const search = json("search.json");
const manifest = json("search-manifest.json");
const adminReview = json("admin-review.json");
function reportJson(name) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "reports", name), "utf8")); }
  catch { return null; }
}
const operationsStatus = reportJson("operations-status.json");
const imageRightsQueue = reportJson("image-rights-queue.json");
const newsroomWorkQueue = reportJson("newsroom-work-queue.json");
if (latest && (!Array.isArray(latest.items) || latest.items.length === 0)) critical.push({ file: "latest.json", reason: "empty-public-edition" });
if (search && (!Array.isArray(search.items) || search.items.length !== Number(search.count))) critical.push({ file: "search.json", reason: "count-mismatch" });
if (manifest && Number(manifest.count) !== Number(search?.count)) warnings.push({ file: "search-manifest.json", reason: "search-count-diff", manifest: manifest.count, search: search?.count });
if (!adminReview?.statusSyncedAt) critical.push({ file: "admin-review.json", reason: "status-not-synced" });
if (operationsStatus && adminReview?.operationsStatus?.generatedAt !== operationsStatus.generatedAt) critical.push({ file: "admin-review.json", reason: "operations-status-stale" });
if (imageRightsQueue && adminReview?.imageRightsQueue?.generatedAt !== imageRightsQueue.generatedAt) critical.push({ file: "admin-review.json", reason: "image-rights-queue-stale" });
if (!newsroomWorkQueue) critical.push({ file: "reports/newsroom-work-queue.json", reason: "missing" });
if (newsroomWorkQueue && adminReview?.workQueue?.generatedAt !== newsroomWorkQueue.generatedAt) critical.push({ file: "admin-review.json", reason: "newsroom-work-queue-stale" });
const sitemap = fs.existsSync(path.join(SITE, "sitemap.xml")) ? fs.readFileSync(path.join(SITE, "sitemap.xml"), "utf8") : "";
const newsSitemap = fs.existsSync(path.join(SITE, "news-sitemap.xml")) ? fs.readFileSync(path.join(SITE, "news-sitemap.xml"), "utf8") : "";
const sitemapCount = (sitemap.match(/<loc>/g) || []).length;
if (deployment && deployment.sitemapCount !== sitemapCount) critical.push({ file: "deployment.json", reason: "sitemap-count-mismatch", manifest: deployment.sitemapCount, actual: sitemapCount });
const newsSitemapCount = (newsSitemap.match(/<loc>/g) || []).length;
if (deployment && deployment.newsSitemapCount !== newsSitemapCount) critical.push({ file: "deployment.json", reason: "news-sitemap-count-mismatch", manifest: deployment.newsSitemapCount, actual: newsSitemapCount });
if (/<loc>undefined<\/loc>|<loc>[^<]*\/admin|<loc>[^<]*\/search\//i.test(sitemap)) critical.push({ file: "sitemap.xml", reason: "internal-url-in-sitemap" });
if (/<loc>undefined<\/loc>|<loc>[^<]*\/admin|<loc>[^<]*\/search\//i.test(newsSitemap)) critical.push({ file: "news-sitemap.xml", reason: "internal-url-in-news-sitemap" });
const headers = fs.existsSync(path.join(SITE, "_headers")) ? fs.readFileSync(path.join(SITE, "_headers"), "utf8") : "";
if (!headers.includes("X-Robots-Tag: noindex") || !headers.includes("Cache-Control: public, max-age=60")) critical.push({ file: "_headers", reason: "security-or-cache-contract-missing" });
const sw = fs.existsSync(path.join(SITE, "sw.js")) ? fs.readFileSync(path.join(SITE, "sw.js"), "utf8") : "";
if (!sw.includes("vmcache-v8") || !sw.includes("/api/")) critical.push({ file: "sw.js", reason: "service-worker-contract-missing" });

const result = { version: 1, generatedAt: new Date().toISOString(), critical, warnings, deployment: deployment ? { sourceCommit: deployment.sourceCommit, latestDate: deployment.latestDate, publicArticleCount: deployment.publicArticleCount, searchCount: deployment.searchCount, newsSitemapCount: deployment.newsSitemapCount } : null };
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(result, null, 2) + "\n");
console.log(`deploy guard: critical ${critical.length} · warnings ${warnings.length}`);
if (critical.length) process.exitCode = 1;
