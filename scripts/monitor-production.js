import fs from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";
import {
  inspectArticleHtml,
  inspectDeploymentPayload,
  inspectLatestPayload,
  inspectNewsSitemap,
  inspectResponseContract,
  kstDateString,
  recentIndexableNewsCount,
} from "../src/lib/production-monitor.js";

const base = process.env.MONITOR_BASE_URL || "https://news.vetmanlab.com";
const userAgent = "VetManLab-production-monitor/4.0";
const paths = [
  "/",
  "/robots.txt",
  "/sitemap.xml",
  "/news-sitemap.xml",
  "/rss.xml",
  "/latest.json",
  "/deployment.json",
];
const result = {
  generatedAt: new Date().toISOString(),
  base,
  endpoints: [],
  critical: [],
  warnings: [],
};
const responses = new Map();
let latestPayload = null;
const parser = new XMLParser({ ignoreAttributes: false });

function addIssues(target, issues, pathname) {
  for (const issue of issues || []) {
    const { pathname: issuePathname, ...details } = issue;
    target.push({ pathname: issuePathname || pathname, ...details });
  }
}

function parseJson(pathname, body) {
  try {
    return JSON.parse(body);
  } catch (error) {
    result.critical.push({ pathname, reason: `json-${error.message}` });
    return null;
  }
}

function parseXml(pathname, body) {
  try {
    parser.parse(body);
    return true;
  } catch (error) {
    result.critical.push({ pathname, reason: `xml-${error.message}` });
    return false;
  }
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].trim()).filter(Boolean);
}

function countRssItems(xml) {
  return [...xml.matchAll(/<item\b/gi)].length;
}

async function fetchUrl(url, pathname, { record = false } = {}) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
      headers: { "user-agent": userAgent },
    });
    const body = await response.text();
    const headers = Object.fromEntries(response.headers.entries());
    const contract = inspectResponseContract({ pathname, status: response.status, headers, body });
    addIssues(result.critical, contract.critical, pathname);
    addIssues(result.warnings, contract.warnings, pathname);
    const endpoint = {
      pathname,
      status: response.status,
      bytes: Buffer.byteLength(body),
      contentType: contract.contentType,
      cacheControl: contract.cacheControl,
      ok: response.ok,
    };
    if (record) {
      result.endpoints.push(endpoint);
      responses.set(pathname, { body, headers, endpoint });
    }
    return { body, headers, endpoint };
  } catch (error) {
    result.critical.push({ pathname, reason: error.name === "TimeoutError" ? "timeout" : error.message });
    return null;
  }
}

for (const pathname of paths) await fetchUrl(base + pathname, pathname, { record: true });

for (const pathname of ["/sitemap.xml", "/news-sitemap.xml", "/rss.xml"]) {
  const response = responses.get(pathname);
  if (response) parseXml(pathname, response.body);
}

const latestResponse = responses.get("/latest.json");
if (latestResponse) {
  latestPayload = parseJson("/latest.json", latestResponse.body);
  if (latestPayload) {
    result.latest = inspectLatestPayload(latestPayload, {
      today: process.env.MONITOR_TODAY || kstDateString(),
      maxAgeDays: Number(process.env.MONITOR_LATEST_MAX_AGE_DAYS || 3),
    });
    addIssues(result.critical, result.latest.critical, "/latest.json");
    addIssues(result.warnings, result.latest.warnings, "/latest.json");
  }
}

const deploymentResponse = responses.get("/deployment.json");
if (deploymentResponse) {
  const payload = parseJson("/deployment.json", deploymentResponse.body);
  if (payload) {
    result.deployment = payload;
    const inspection = inspectDeploymentPayload(payload);
    addIssues(result.critical, inspection.critical, "/deployment.json");
  }
}

const sitemapResponse = responses.get("/sitemap.xml");
if (sitemapResponse) {
  if (sitemapResponse.endpoint.bytes < 100) result.critical.push({ pathname: "/sitemap.xml", reason: "sitemap-too-small" });
  const urls = extractLocs(sitemapResponse.body);
  const manifestExpected = Number.isInteger(result.deployment?.sitemapCount) ? result.deployment.sitemapCount : null;
  const configuredExpected = Number.isInteger(Number(process.env.MONITOR_EXPECTED_SITEMAP))
    ? Number(process.env.MONITOR_EXPECTED_SITEMAP)
    : null;
  const expected = manifestExpected ?? configuredExpected;
  result.sitemap = {
    urlCount: urls.length,
    expected,
    expectedSource: manifestExpected !== null ? "deployment.json" : configuredExpected !== null ? "MONITOR_EXPECTED_SITEMAP" : null,
    representative: null,
  };

  if (manifestExpected !== null && urls.length !== manifestExpected) {
    result.critical.push({ pathname: "/sitemap.xml", reason: "sitemap-count-manifest-mismatch", expected: manifestExpected, actual: urls.length });
  }
  if (configuredExpected !== null) {
    const maxDelta = Number(process.env.MONITOR_MAX_SITEMAP_DELTA || 20);
    if (Math.abs(urls.length - configuredExpected) > maxDelta) {
      result.warnings.push({ pathname: "/sitemap.xml", reason: "sitemap-count-config-shift", expected: configuredExpected, actual: urls.length, maxDelta });
    }
  }

  const representativeUrl = urls.find((url) => /\/article\//.test(url)) || urls[0];
  if (representativeUrl) {
    const article = await fetchUrl(representativeUrl, representativeUrl);
    if (article) {
      const trust = inspectArticleHtml(article.body, representativeUrl);
      result.sitemap.representative = {
        url: representativeUrl,
        status: article.endpoint.status,
        canonical: trust.canonical,
        canonicalMatches: trust.canonical === representativeUrl,
        noindex: trust.noindex,
        jsonLdTypes: trust.jsonLdTypes,
      };
      addIssues(result.critical, trust.critical, representativeUrl);
      addIssues(result.warnings, trust.warnings, representativeUrl);
    }
  } else {
    result.critical.push({ pathname: "/sitemap.xml", reason: "sitemap-empty" });
  }
}

const newsSitemapResponse = responses.get("/news-sitemap.xml");
if (newsSitemapResponse) {
  const expected = Number.isInteger(result.deployment?.newsSitemapCount) ? result.deployment.newsSitemapCount : null;
  const inspection = inspectNewsSitemap(newsSitemapResponse.body, expected);
  addIssues(result.critical, inspection.critical, "/news-sitemap.xml");
  const newsMaxAgeDays = Number(process.env.MONITOR_NEWS_MAX_AGE_DAYS || 2);
  const latestIndexableCount = recentIndexableNewsCount(latestPayload?.items, { maxAgeDays: newsMaxAgeDays });
  result.newsSitemap = { urlCount: inspection.urlCount, expected, expectedSource: expected === null ? null : "deployment.json", latestIndexableCount, maxAgeDays: newsMaxAgeDays };
  if (latestIndexableCount > 0 && inspection.urlCount === 0) result.critical.push({ pathname: "/news-sitemap.xml", reason: "news-sitemap-empty-for-indexable-latest", latestIndexableCount });
}

const rssResponse = responses.get("/rss.xml");
if (rssResponse) {
  const itemCount = countRssItems(rssResponse.body);
  result.rss = { itemCount };
  if (itemCount === 0) result.warnings.push({ pathname: "/rss.xml", reason: "rss-empty" });
}

await fs.mkdir("reports", { recursive: true });
await fs.writeFile("reports/production-monitoring.json", JSON.stringify(result, null, 2) + "\n");
console.log(`production monitor: ${result.endpoints.filter((row) => row.ok).length}/${paths.length} OK · critical ${result.critical.length} · warnings ${result.warnings.length}`);
if (result.critical.length) process.exitCode = 1;
