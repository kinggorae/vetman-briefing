// Google News relay를 반복 스크래핑하지 않고, 공식 매체 매핑·저장소 내 직접 URL·
// 편집자가 지정한 feed 후보만 비교하는 보수적 출처 후보 생성기다.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSourceUrl } from "../src/identity.js";
import { XMLParser } from "fast-xml-parser";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const MAPPING = path.join(ROOT, "data", "source-publishers.json");
const CACHE = path.join(ROOT, "data", "source-candidate-cache.json");
const REPORT_JSON = path.join(ROOT, "reports", "source-resolution.json");
const REPORT_MD = path.join(ROOT, "reports", "source-resolution.md");
const RELAY = /^https?:\/\/(?:news\.)?google\.[^/]+\/rss\/articles\//i;
const HIGH = 0.92;
const CANDIDATE = 0.62;
const USER_AGENT = "VetManLab-SourceReview/4.0 (+https://news.vetmanlab.com/about)";

const tokens = (value) => new Set(String(value || "").toLowerCase().replace(/[^a-z0-9가-힣]+/gi, " ").split(/\s+/).filter((token) => token.length >= 2));
function similarity(a, b) {
  const left = tokens(a); const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let hit = 0; for (const token of left) if (right.has(token)) hit++;
  return Number((hit / Math.max(left.size, right.size)).toFixed(3));
}
function daysApart(a, b) {
  if (!a || !b) return null;
  const left = new Date(a).getTime(); const right = new Date(b).getTime();
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.round(Math.abs(left - right) / 86400000 * 10) / 10;
}
function hostOf(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }
function official(url, mapping) {
  const host = hostOf(url); return Boolean(host && (mapping?.domains || []).some((domain) => host === domain || host.endsWith(`.${domain}`)));
}
function safeArticleUrl(url) {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) && !/google\.|search|tag|category|login|subscribe|author/i.test(`${u.hostname}${u.pathname}`); } catch { return false; }
}

async function fetchFeedItems(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" }).parse(await response.text());
    const entries = parsed?.rss?.channel?.item || parsed?.feed?.entry || [];
    return (Array.isArray(entries) ? entries : [entries]).map((entry) => {
      const link = typeof entry.link === "string" ? entry.link : entry.link?.["@_href"] || entry.link?.[0]?.["@_href"];
      return { url: normalizeSourceUrl(link || entry.guid || ""), title: String(entry.title || "").replace(/<[^>]+>/g, "").trim(), publishedAt: entry.pubDate || entry.published || entry.updated || null };
    }).filter((entry) => safeArticleUrl(entry.url) && entry.title);
  } finally { clearTimeout(timer); }
}

async function loadRecords() {
  const files = (await fs.readdir(ISSUES)).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort();
  const all = []; const direct = [];
  for (const file of files) {
    const issue = JSON.parse(await fs.readFile(path.join(ISSUES, file), "utf8"));
    for (const [index, item] of (issue.items || []).entries()) {
      const record = { file, index, issueDate: issue.date, item };
      all.push(record);
      const url = item.sourceUrlRaw || item.sourceUrl;
      if (url && !RELAY.test(url) && safeArticleUrl(url)) direct.push({ ...record, url: normalizeSourceUrl(url) });
    }
  }
  return { all, direct };
}

function queryStrings(item) {
  return [...new Set([item.sourceTitle, item.titleKo, `${item.sourceLabel || ""} ${item.titleKo || ""}`.trim()].filter(Boolean))];
}

async function main() {
  const mapping = JSON.parse(await fs.readFile(MAPPING, "utf8"));
  const registry = await fs.readFile(path.join(ROOT, "data", "sources", "registry.json"), "utf8").then(JSON.parse).catch(() => ({ sources: [] }));
  const { all, direct } = await loadRecords();
  const relayRecords = all.filter(({ item }) => RELAY.test(item.sourceUrlRaw || item.sourceUrl || ""));
  const cache = await fs.readFile(CACHE, "utf8").then(JSON.parse).catch(() => ({}));
  const decisions = await fs.readFile(path.join(ROOT, "data", "source-resolution-decisions.json"), "utf8").then(JSON.parse).catch(() => ({}));
  const rssCandidates = [];
  const sourceCounts = relayRecords.reduce((result, { item }) => { result[item.sourceLabel] = (result[item.sourceLabel] || 0) + 1; return result; }, {});
  for (const source of (registry.sources || []).filter((source) => source.rssUrls?.length).sort((a, b) => (sourceCounts[b.label] || 0) - (sourceCounts[a.label] || 0)).slice(0, 10)) {
    for (const feedUrl of source.rssUrls.slice(0, 2)) {
      const cacheKey = `feed:${feedUrl}`;
      try {
        const items = await fetchFeedItems(feedUrl);
        cache[cacheKey] = { fetchedAt: new Date().toISOString(), items };
        rssCandidates.push(...items.map((item) => ({ ...item, sourceLabel: source.label, evidence: `official RSS: ${feedUrl}` })));
      } catch (error) {
        cache[cacheKey] = { fetchedAt: new Date().toISOString(), error: error.message, items: cache[cacheKey]?.items || [] };
        rssCandidates.push(...(cache[cacheKey].items || []).map((item) => ({ ...item, sourceLabel: source.label, evidence: `cached official RSS: ${feedUrl}` })));
      }
    }
  }
  const rows = relayRecords.map(({ file, index, issueDate, item }) => {
    const raw = item.sourceUrlRaw || item.sourceUrl;
    const map = mapping[item.sourceLabel] || { domains: [], feeds: [] };
    const candidates = [
      ...direct
        .filter((record) => record.item.sourceLabel === item.sourceLabel && official(record.url, map))
        .map((record) => ({ url: record.url, title: record.item.sourceTitle || record.item.titleKo, similarity: similarity(item.sourceTitle || item.titleKo, record.item.sourceTitle || record.item.titleKo), dateDiffDays: daysApart(item.publishedAt, record.item.publishedAt), evidence: "same-source direct URL already in repository" }))
        .filter((candidate) => candidate.similarity >= CANDIDATE),
      ...rssCandidates
        .filter((candidate) => candidate.sourceLabel === item.sourceLabel && official(candidate.url, map))
        .map((candidate) => ({ url: candidate.url, title: candidate.title, similarity: similarity(item.sourceTitle || item.titleKo, candidate.title), dateDiffDays: daysApart(item.publishedAt, candidate.publishedAt), evidence: candidate.evidence }))
        .filter((candidate) => candidate.similarity >= CANDIDATE),
    ].sort((a, b) => b.similarity - a.similarity || (a.dateDiffDays ?? 999) - (b.dateDiffDays ?? 999)).slice(0, 5);
    const top = candidates[0] || null;
    const decision = decisions[item.id] || decisions[raw];
    let status = "unresolved"; let reason = map.domains.length ? "official-domain-mapped-no-verified-candidate" : "publisher-domain-not-mapped";
    if (decision?.status === "manually-approved" && safeArticleUrl(decision.url) && official(decision.url, map)) { status = "manually-approved"; reason = "explicit-editor-approval"; }
    else if (decision?.status === "rejected") { status = "rejected"; reason = decision.reason || "explicit-editor-rejection"; }
    else if (top && top.similarity >= HIGH && (top.dateDiffDays == null || top.dateDiffDays <= 3)) { status = "resolved"; reason = "high-confidence-official-direct-match"; }
    else if (top) { status = "candidate"; reason = "medium-confidence-needs-human-review"; }
    return { articleId: item.id || `${issueDate}_${index + 1}`, file, index, titleKo: item.titleKo || null, sourceTitle: item.sourceTitle || null, sourceLabel: item.sourceLabel || null, publishedAt: item.publishedAt || null, rawUrl: raw, query: queryStrings(item), officialDomains: map.domains, feedUrls: map.feeds || [], status, reason, confidence: top?.similarity || 0, candidates, approvedUrl: decision?.url || (status === "resolved" ? top?.url : null), sourceUrlRawPreserved: true };
  });
  const counts = Object.fromEntries(["resolved", "candidate", "unresolved", "rejected", "manually-approved"].map((status) => [status, rows.filter((row) => row.status === status).length]));
  const result = { generatedAt: new Date().toISOString(), mode: process.argv.includes("--apply-high-confidence") ? "apply-high-confidence" : "dry-run", totalRelayArticles: rows.length, counts, highConfidenceThreshold: HIGH, rows, manualReviewQueue: rows.filter((row) => ["candidate", "unresolved", "rejected"].includes(row.status)) };
  await fs.mkdir(path.join(ROOT, "reports"), { recursive: true });
  await fs.writeFile(REPORT_JSON, JSON.stringify(result, null, 2) + "\n");
  const md = [`# 원출처 URL 반자동 검수 보고서`, ``, `- 생성 시각: ${result.generatedAt}`, `- Google News 중계 기사: ${rows.length}개`, `- 상태: ${JSON.stringify(counts)}`, `- 자동 적용 기준: 공식 도메인 + 제목 유사도 ${HIGH} 이상 + 발행일 차이 3일 이내 + 사람 승인 없는 추정 금지`, ``, `## 수동 검수 큐`, ``];
  for (const row of result.manualReviewQueue) md.push(`- \`${row.articleId}\` · ${row.sourceLabel || "출처 미상"} · ${row.titleKo || "제목 없음"} · ${row.status} · 후보 ${row.candidates[0]?.url || "없음"} · 검색어: ${row.query[0] || ""}`);
  await fs.writeFile(REPORT_MD, md.join("\n") + "\n");
  if (process.argv.includes("--apply-high-confidence")) {
    const applyRows = rows.filter((row) => ["resolved", "manually-approved"].includes(row.status) && row.approvedUrl && row.status === "resolved");
    for (const [file, records] of Object.groupBy(applyRows, (row) => row.file)) {
      const filePath = path.join(ISSUES, file); const issue = JSON.parse(await fs.readFile(filePath, "utf8")); let changed = false;
      for (const row of records) { const item = issue.items[row.index]; if (!item.sourceUrlRaw) item.sourceUrlRaw = item.sourceUrl; if (item.sourceUrl !== row.approvedUrl) { item.sourceUrl = row.approvedUrl; item.finalUrl = row.approvedUrl; item.sourceResolution = { status: "resolved", confidence: row.confidence, resolvedAt: result.generatedAt }; changed = true; } }
      if (changed) await fs.writeFile(filePath, JSON.stringify(issue, null, 2) + "\n");
    }
  }
  await fs.writeFile(CACHE, JSON.stringify(Object.fromEntries(rows.map((row) => [row.articleId, row])), null, 2) + "\n");
  console.log(`출처 후보 감사: ${rows.length}개 · ${JSON.stringify(counts)} · ${path.relative(ROOT, REPORT_JSON)}`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
