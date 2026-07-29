import fs from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
const base = process.env.MONITOR_BASE_URL || "https://news.vetmanlab.com";
const paths = ["/", "/robots.txt", "/sitemap.xml", "/news-sitemap.xml", "/rss.xml"];
const result = { generatedAt: new Date().toISOString(), base, endpoints: [], critical: [], warnings: [] };
for (const pathname of paths) {
  try { const response = await fetch(base + pathname, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": "VetManLab-production-monitor/3.0" } }); const body = await response.text(); result.endpoints.push({ pathname, status: response.status, bytes: Buffer.byteLength(body), ok: response.ok }); if (!response.ok) result.critical.push({ pathname, reason: `http-${response.status}` }); if (pathname.endsWith(".xml")) { try { new XMLParser({ ignoreAttributes: false }).parse(body); } catch (error) { result.critical.push({ pathname, reason: `xml-${error.message}` }); } } if (pathname === "/" && !/<h1\b/i.test(body)) result.warnings.push({ pathname, reason: "h1-missing" }); } catch (error) { result.critical.push({ pathname, reason: error.name === "TimeoutError" ? "timeout" : error.message }); }
}
const sitemap = result.endpoints.find((row) => row.pathname === "/sitemap.xml");
if (sitemap && sitemap.bytes < 100) result.critical.push({ pathname: "/sitemap.xml", reason: "sitemap-too-small" });
try {
  const response = await fetch(base + "/sitemap.xml", { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": "VetManLab-production-monitor/3.0" } });
  const xml = await response.text();
  const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  result.sitemap = { urlCount: urls.length, representative: null };
  const expected = Number(process.env.MONITOR_EXPECTED_SITEMAP || 212);
  const maxDelta = Number(process.env.MONITOR_MAX_SITEMAP_DELTA || 20);
  if (Math.abs(urls.length - expected) > maxDelta) result.warnings.push({ pathname: "/sitemap.xml", reason: "sitemap-count-shift", expected, actual: urls.length, maxDelta });
  const representativeUrl = urls.find((url) => /\/article\//.test(url)) || urls[0];
  if (representativeUrl) {
    const articleResponse = await fetch(representativeUrl, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "user-agent": "VetManLab-production-monitor/3.0" } });
    const articleHtml = await articleResponse.text();
    const canonical = articleHtml.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1] || "";
    const noindex = /<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(articleHtml);
    result.sitemap.representative = { url: representativeUrl, status: articleResponse.status, canonical, canonicalMatches: canonical === representativeUrl, noindex };
    if (!articleResponse.ok) result.critical.push({ pathname: representativeUrl, reason: `representative-http-${articleResponse.status}` });
    if (canonical !== representativeUrl) result.critical.push({ pathname: representativeUrl, reason: "representative-canonical-mismatch", canonical });
    if (noindex) result.critical.push({ pathname: representativeUrl, reason: "representative-noindex" });
  }
} catch (error) {
  result.critical.push({ pathname: "/sitemap.xml", reason: `representative-${error.message}` });
}
await fs.mkdir("reports", { recursive: true });
await fs.writeFile("reports/production-monitoring.json", JSON.stringify(result, null, 2) + "\n");
console.log(`production monitor: ${result.endpoints.filter((row) => row.ok).length}/${paths.length} OK · critical ${result.critical.length} · warnings ${result.warnings.length}`);
if (result.critical.length) process.exitCode = 1;
