// Google News relay/추적 URL의 최종 출판사 URL을 보수적으로 확인하는 도구.
// 기본은 dry-run이며 --apply 없이는 data/issues를 변경하지 않는다.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSourceUrl } from "../src/identity.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, "data", "issues");
const CACHE_FILE = path.join(ROOT, "data", "source-resolutions.json");
const REPORT_FILE = path.join(ROOT, "reports", "source-url-audit.json");
const APPLY = process.argv.includes("--apply");
const MAX_RETRIES = 2;
const CONCURRENCY = 3;
const DELAY_MS = 350;
const TIMEOUT_MS = 9000;
const RELAY_RE = /^https?:\/\/([^/]*\.)?google\.[^/]+\/rss\/articles\//i;
const BLOCKED_HOST = /(^|\.)(google\.[^/.]+|googleusercontent\.com|gstatic\.com)$/i;
const TRACKING_KEY = /^(utm_|gclid$|fbclid$|mc_cid$|mc_eid$|oc$)/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isRelay = (url) => RELAY_RE.test(String(url || ""));

function htmlMeta(html, name, attr = "property") {
  const re = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]+content=["']([^"']+)`, "i");
  return html.match(re)?.[1] || null;
}

function pageTitle(html) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || null;
}

function hostAllowed(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || BLOCKED_HOST.test(parsed.hostname)) return false;
    if (/\/login|\/signin|\/subscribe|oauth|accounts\./i.test(parsed.pathname + parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function titleTokens(value) {
  return new Set(String(value || "").toLowerCase().replace(/[^a-z0-9가-힣]+/gi, " ").split(/\s+/).filter((x) => x.length >= 2));
}

function titleConfidence(sourceTitle, pageTitleValue) {
  if (!sourceTitle || !pageTitleValue) return null;
  const expected = titleTokens(sourceTitle);
  const actual = titleTokens(pageTitleValue);
  if (!expected.size || !actual.size) return null;
  let overlap = 0;
  for (const token of expected) if (actual.has(token)) overlap++;
  return Number((overlap / Math.max(expected.size, 1)).toFixed(3));
}

async function fetchCandidate(raw, item) {
  let lastError = "unknown";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(raw, {
        redirect: "follow",
        headers: { "user-agent": "VetManLab-source-normalizer/2.0 (+https://news.vetmanlab.com/about)", accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const html = await response.text();
      const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1]
        || htmlMeta(html, "og:url")
        || response.url;
      const finalUrl = normalizeSourceUrl(canonical || response.url || "");
      const resolvedTitle = pageTitle(html) || htmlMeta(html, "og:title") || null;
      const confidence = titleConfidence(item.sourceTitle || item.titleKo, resolvedTitle);
      if (!response.ok) return { status: "failed", reason: `http-${response.status}`, httpStatus: response.status, finalUrl, pageTitle: resolvedTitle };
      if (!hostAllowed(finalUrl) || isRelay(finalUrl)) return { status: "candidate", reason: "relay-or-blocked-final-url", httpStatus: response.status, finalUrl: null, pageTitle: resolvedTitle };
      if (confidence !== null && confidence < 0.12) {
        return { status: "manual-review", reason: "title-mismatch", httpStatus: response.status, finalUrl, pageTitle: resolvedTitle, titleConfidence: confidence };
      }
      return { status: "resolved", reason: "canonical-or-redirect", httpStatus: response.status, finalUrl, pageTitle: resolvedTitle, titleConfidence: confidence };
    } catch (error) {
      lastError = error.name === "TimeoutError" ? "timeout" : error.code || error.message || "request-failed";
      if (attempt < MAX_RETRIES) await sleep(DELAY_MS * (attempt + 1));
    }
  }
  return { status: "failed", reason: lastError, finalUrl: null };
}

async function loadItems() {
  const files = (await fs.readdir(DATA_DIR)).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort();
  const items = [];
  for (const file of files) {
    const issue = JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8"));
    for (const [index, item] of (issue.items || []).entries()) items.push({ file, index, item });
  }
  return items;
}

function candidateQueries(item) {
  return [...new Set([
    item.sourceTitle,
    item.titleKo,
    `${item.sourceLabel || ""} ${item.titleKo || ""}`.trim(),
  ].filter(Boolean))].slice(0, 3);
}

async function main() {
  const items = await loadItems();
  const cache = await fs.readFile(CACHE_FILE, "utf8").then(JSON.parse).catch(() => ({}));
  const grouped = new Map();
  for (const record of items) {
    const raw = record.item.sourceUrlRaw || record.item.sourceUrl;
    if (!isRelay(raw) || grouped.has(raw)) continue;
    grouped.set(raw, { raw, ...record });
  }
  const results = { ...cache };
  const queue = [...grouped.values()].filter(({ raw }) => !results[raw] || process.argv.includes("--refresh"));
  const worker = async () => {
    while (queue.length) {
      const record = queue.shift();
      const result = await fetchCandidate(record.raw, record.item);
      results[record.raw] = {
        raw: record.raw,
        checkedAt: new Date().toISOString(),
        sourceLabel: record.item.sourceLabel || null,
        sourceTitle: record.item.sourceTitle || null,
        titleKo: record.item.titleKo || null,
        publishedAt: record.item.publishedAt || null,
        candidateQueries: candidateQueries(record.item),
        ...result,
      };
      await sleep(DELAY_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (APPLY) {
    for (const [file, records] of Object.groupBy(items, (record) => record.file)) {
      const issuePath = path.join(DATA_DIR, file);
      const issue = JSON.parse(await fs.readFile(issuePath, "utf8"));
      let changed = false;
      for (const record of records) {
        const raw = record.item.sourceUrlRaw || record.item.sourceUrl;
        const result = results[raw];
        if (!result || result.status !== "resolved" || !result.finalUrl) continue;
        const item = issue.items[record.index];
        if (!item.sourceUrlRaw) item.sourceUrlRaw = raw;
        if (item.sourceUrl !== result.finalUrl) {
          item.sourceUrl = result.finalUrl;
          item.finalUrl = result.finalUrl;
          changed = true;
        }
      }
      if (changed) await fs.writeFile(issuePath, JSON.stringify(issue, null, 2) + "\n");
    }
    await fs.writeFile(CACHE_FILE, JSON.stringify(results, null, 2) + "\n");
  }

  const rows = [...grouped.keys()].map((raw) => {
    const record = grouped.get(raw);
    const cached = results[raw] || {};
    const row = {
      raw,
      ...cached,
      sourceLabel: cached.sourceLabel || record?.item?.sourceLabel || null,
      sourceTitle: cached.sourceTitle || record?.item?.sourceTitle || null,
      titleKo: cached.titleKo || record?.item?.titleKo || null,
      publishedAt: cached.publishedAt || record?.item?.publishedAt || null,
      candidateQueries: cached.candidateQueries?.length ? cached.candidateQueries : candidateQueries(record?.item || {}),
      status: cached.status || "failed",
      reason: cached.reason || "not-checked",
    };
    return row.status === "unresolved" ? { ...row, status: "failed", reason: row.reason || "cached-unresolved" } : row;
  });
  const counts = Object.fromEntries(["resolved", "candidate", "manual-review", "failed"].map((status) => [status, rows.filter((row) => row.status === status).length]));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: APPLY ? "apply" : "dry-run",
    totalRelayUrls: rows.length,
    counts,
    manualReviewQueue: rows.filter((row) => row.status !== "resolved").map((row) => ({
      articleId: grouped.get(row.raw)?.item?.id || (grouped.get(row.raw) ? `${grouped.get(row.raw).file.replace(/\.json$/, "")}_${grouped.get(row.raw).index + 1}` : null),
      titleKo: row.titleKo || null,
      sourceTitle: row.sourceTitle || null,
      sourceLabel: row.sourceLabel || null,
      rawUrl: row.raw,
      publishedAt: row.publishedAt || null,
      candidateQueries: row.candidateQueries || [],
      status: row.status,
      reason: row.reason || null,
      finalUrl: row.finalUrl || null,
    })),
    results: rows,
  };
  await fs.mkdir(path.dirname(REPORT_FILE), { recursive: true });
  await fs.writeFile(REPORT_FILE, JSON.stringify(report, null, 2) + "\n");
  console.log(`Google News URL ${APPLY ? "적용" : "감사"}: ${rows.length}건 · ${JSON.stringify(counts)} · 보고서 ${path.relative(ROOT, REPORT_FILE)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
