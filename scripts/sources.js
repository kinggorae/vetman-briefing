import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOURCE_HEALTH_PATH, atomicWrite, fetchFeed, hostOf, isOfficialUrl, loadRegistry, normalizeSource, readJson,
} from "../src/lib/source-first.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPORT_JSON = path.join(ROOT, "reports", "feed-diagnostics.json");
const REPORT_MD = path.join(ROOT, "reports", "feed-diagnostics.md");
const HISTORY_PATH = path.join(ROOT, "reports", "feed-history.json");
const HEALTH_MD = path.join(ROOT, "reports", "source-health.md");
const REGISTRY_PATH = path.join(ROOT, "data", "sources", "registry.json");
const USER_AGENT = "VetManLab-SourceFirst/6.0 (+https://news.vetmanlab.com/about)";
const STATES = ["healthy", "quiet", "stale", "degraded", "failing", "retired", "disabled"];

function args() { const raw = process.argv.slice(2); const command = raw.shift() || "list"; return { command, positional: raw.filter((x) => !x.startsWith("--")), flags: Object.fromEntries(raw.filter((x) => x.startsWith("--")).map((x) => { const [key, ...rest] = x.slice(2).split("="); return [key, rest.length ? rest.join("=") : true]; })) }; }
function feedsFor(source) { return [...new Set([...(source.rssUrls || []), ...(source.atomUrls || [])])]; }
function officialFeedUrl(url, source) { try { return isOfficialUrl(url, source) && !/^https?:\/\/(?:www\.)?feedburner\.com/i.test(url); } catch { return false; } }
function parseRobots(text, targetPath) { let active = false; for (const line of String(text || "").split(/\r?\n/)) { const clean = line.split("#")[0].trim(); if (/^user-agent\s*:\s*\*/i.test(clean)) active = true; else if (/^user-agent\s*:/i.test(clean)) active = false; else if (active && /^disallow\s*:/i.test(clean)) { const value = clean.replace(/^disallow\s*:/i, "").trim(); if (value && targetPath.startsWith(value)) return false; } } return true; }
async function robotsAllowed(url, source) { try { const parsed = new URL(url); const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`; const response = await fetch(robotsUrl, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(source.timeoutMs) }); return { checked: true, allowed: response.ok ? parseRobots(await response.text(), parsed.pathname) : true, url: robotsUrl }; } catch { return { checked: false, allowed: true, url: null }; } }
function dateTimes(entries) { return entries.map((e) => Date.parse(e.publishedAt || "")).filter(Number.isFinite).sort((a, b) => a - b); }
function averageGapDays(entries) { const dates = dateTimes(entries); if (dates.length < 2) return null; const gaps = dates.slice(1).map((v, i) => (v - dates[i]) / 86400000).filter((v) => v >= 0); return gaps.length ? Number((gaps.reduce((a, b) => a + b, 0) / gaps.length).toFixed(2)) : null; }
function statusFor(row, source) {
  if (source.healthStatus === "retired" || source.retired) return "retired";
  if (!source.enabled) return "disabled";
  if (!row.ok || row.httpStatus >= 400 || row.xmlParsed === false) return "failing";
  if (row.ageDays != null && row.ageDays > 30 && (row.averageIntervalDays == null || row.averageIntervalDays <= 14)) return "stale";
  if (row.ageDays != null && row.ageDays > 7 && (row.averageIntervalDays == null || row.averageIntervalDays > 14 || row.itemCount <= 2)) return "quiet";
  if (!row.officialDomain || row.relayRatio > 0 || row.canonicalCoverage < 0.5 || row.duplicateGuidCount > 0 || !/^application\/(?:rss|atom)\+xml|xml|rdf/i.test(row.contentType || "")) return "degraded";
  if (row.itemCount === 0) return "degraded";
  return "healthy";
}
function alternativeLinks(html, baseUrl, source) {
  const links = [];
  for (const match of String(html || "").matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    const isFeedType = /type=["'][^"']*application\/(?:rss|atom)\+xml/i.test(tag);
    const isSitemap = /rel=["'][^"']*sitemap/i.test(tag) && /(?:sitemap|\.xml(?:$|[?#])|feed|rss|atom)/i.test(tag);
    if (!isFeedType && !isSitemap) continue;
    const href = tag.match(/href=["']([^"']+)/i)?.[1]; if (!href) continue;
    try { const url = new URL(href, baseUrl).toString(); if (!/\/comments\/feed|\/wp-json\/oembed/i.test(url) && officialFeedUrl(url, source)) links.push({ url, reason: "official alternate/sitemap link" }); } catch {}
  }
  return [...new Map(links.map((x) => [x.url, x])).values()];
}
// errors: 호출부가 배열을 넘기면 실패 사유를 담아준다. 예전에는 fetch 실패를
// 통째로 삼켜서 봇 차단(403)과 "피드 링크 없음"이 결과상 똑같이 후보 0개로
// 보였고, 왜 못 찾았는지 알 방법이 없었다.
async function discoverAlternatives(source, feedUrl, errors = []) {
  const roots = new Set();
  try { const u = new URL(feedUrl); roots.add(`${u.protocol}//${u.host}/`); } catch (error) { errors.push({ root: feedUrl, reason: `URL 파싱 실패: ${error.message}` }); }
  for (const domain of source.officialDomains || []) roots.add(`https://${domain}/`);
  const found = [];
  for (const root of roots) {
    try {
      const response = await fetch(root, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" }, redirect: "follow", signal: AbortSignal.timeout(source.timeoutMs) });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok) { errors.push({ root, reason: `HTTP ${response.status}` }); continue; }
      if (!/html|xml/i.test(contentType)) { errors.push({ root, reason: `content-type ${contentType.split(";")[0] || "불명"}` }); continue; }
      const body = (await response.text()).slice(0, 400000);
      found.push(...alternativeLinks(body, response.url || root, source));
    } catch (error) {
      errors.push({ root, reason: String(error?.message || error).slice(0, 120) });
    }
  }
  return [...new Map(found.map((x) => [x.url, x])).values()];
}
async function diagnoseFeed(source, url) {
  const checkedAt = new Date().toISOString(); const robots = await robotsAllowed(url, source);
  if (!robots.allowed) return { sourceId: source.id, sourceLabel: source.label, feedUrl: url, checkedAt, status: "disabled", ok: false, error: "robots.txt disallows this feed", robots, alternatives: [] };
  try {
    const feed = await fetchFeed(source, url, { useCache: true, retries: 2 }); const entries = feed.entries || []; const guids = entries.map((e) => e.guid).filter(Boolean); const latestMs = dateTimes(entries).at(-1) || null; const ageDays = latestMs == null ? null : Number(((Date.now() - latestMs) / 86400000).toFixed(2)); const canonicalCount = entries.filter((e) => e.canonicalUrl && isOfficialUrl(e.canonicalUrl, source)).length; const row = { sourceId: source.id, sourceLabel: source.label, feedUrl: url, finalUrl: feed.finalUrl || url, redirected: Boolean(feed.redirected), checkedAt, httpStatus: feed.status, contentType: feed.contentType || null, xmlParsed: true, rssAtom: feed.root?.rss ? "rss" : feed.root?.feed ? "atom" : feed.root?.["rdf:RDF"] ? "rdf" : "unknown", responseBytes: feed.responseBytes || null, itemCount: entries.length, latestPublishedAt: latestMs ? new Date(latestMs).toISOString() : null, ageDays, averageIntervalDays: averageGapDays(entries), officialDomain: entries.length === 0 || entries.every((e) => isOfficialUrl(e.canonicalUrl || e.url, source)), relayRatio: entries.length ? Number((entries.filter((e) => e.relay).length / entries.length).toFixed(3)) : 0, canonicalCoverage: entries.length ? Number((canonicalCount / entries.length).toFixed(3)) : 1, duplicateGuidCount: guids.length - new Set(guids).size, etag: feed.etag || null, lastModified: feed.lastModified || null, notModified: Boolean(feed.notModified), fromCache: Boolean(feed.fromCache), lastError: feed.lastError || feed.error || null, consecutiveFailures: feed.error ? Number(source.consecutiveFailures || 0) + 1 : 0, robots, ok: true }; row.status = statusFor(row, source); row.alternatives = row.status === "failing" || row.status === "degraded" ? await discoverAlternatives(source, url) : []; return row;
  } catch (error) { return { sourceId: source.id, sourceLabel: source.label, feedUrl: url, checkedAt, status: "failing", ok: false, xmlParsed: false, error: error.message, recentError: error.message, consecutiveFailures: Number(source.consecutiveFailures || 0) + 1, robots, alternatives: await discoverAlternatives(source, url) }; }
}
function sourceStatus(rows, source) { if (source.healthStatus === "retired" || source.retired) return "retired"; if (!source.enabled || !feedsFor(source).length) return "disabled"; const states = new Set(rows.map((r) => r.status)); if (states.has("failing")) return "failing"; if (states.has("degraded")) return "degraded"; if (states.has("stale")) return "stale"; if (states.has("quiet")) return "quiet"; return rows.length ? "healthy" : "degraded"; }
function historyKey(row) { return `${row.sourceId}|${row.feedUrl}`; }
function updateHistory(rows, persist = false) {
  const previous = readJson(HISTORY_PATH, { version: 1, runs: [] });
  const priorRuns = Array.isArray(previous.runs) ? previous.runs : [];
  const byKey = new Map();
  for (const run of priorRuns.slice(-20)) for (const row of run.feeds || []) byKey.set(historyKey(row), row);
  const successful = (row) => Boolean(row.ok && row.xmlParsed && [200, 304].includes(Number(row.httpStatus)) && !row.error && !row.lastError);
  const enriched = rows.map((row) => {
    const old = byKey.get(historyKey(row));
    const priorCount = old?.successful ? Number(old.consecutiveSuccesses || 0) : 0;
    const count = successful(row) ? priorCount + 1 : 0;
    return { ...row, successful: successful(row), consecutiveSuccesses: Math.min(count, 20), historyKey: historyKey(row) };
  });
  const run = { checkedAt: new Date().toISOString(), feeds: enriched.map((row) => ({ sourceId: row.sourceId, feedUrl: row.feedUrl, status: row.status, successful: row.successful, consecutiveSuccesses: row.consecutiveSuccesses, httpStatus: row.httpStatus || null, latencyMs: row.elapsedMs || null, itemCount: row.itemCount || 0, newestItemAt: row.latestPublishedAt || null, error: row.error || row.lastError || null, canonicalRate: row.canonicalCoverage ?? null, relayRate: row.relayRatio ?? null })) };
  const next = { version: 1, generatedAt: run.checkedAt, runs: [...priorRuns, run].slice(-30) };
  if (persist) atomicWrite(HISTORY_PATH, JSON.stringify(next, null, 2) + "\n");
  return enriched;
}
async function diagnose(sourceFilter = null) {
  const registry = loadRegistry(); const sources = registry.sources.filter((s) => s.enabled && feedsFor(s).length && (!sourceFilter || s.id === sourceFilter || s.label === sourceFilter)); const rows = [];
  for (const source of sources) for (const url of feedsFor(source)) rows.push(await diagnoseFeed(source, url));
  let sourceRows = registry.sources.map((source) => { const checks = rows.filter((r) => r.sourceId === source.id); return { id: source.id, label: source.label, enabled: source.enabled, status: sourceStatus(checks, source), feedCount: feedsFor(source).length, checkedFeedCount: checks.length, consecutiveFailures: source.consecutiveFailures, lastSuccessAt: source.lastSuccessAt || null, lastFailureAt: source.lastFailureAt || null }; });
  // RECORD_FEED_HISTORY=1인 운영 예약 실행(daily.yml)만 feed-history를
  // 누적한다 — 그 잡이 reports/를 커밋해야 이력이 실제로 남기 때문이다.
  // shadow-newsroom도 이 플래그를 켜지만 contents: read라 커밋하지 못하고,
  // 그 실행의 기록은 artifact 안에서만 존재한다. 로컬·PR 감사는 기존
  // 이력을 읽어 상태를 계산하되 성공 횟수를 조작하지 않는다.
  const historicalRows = updateHistory(rows, process.env.RECORD_FEED_HISTORY === "1");
  const historyMap = new Map(historicalRows.map((row) => [historyKey(row), row]));
  rows.splice(0, rows.length, ...rows.map((row) => ({ ...row, consecutiveSuccesses: historyMap.get(historyKey(row))?.consecutiveSuccesses || 0, status: row.status === "healthy" && (historyMap.get(historyKey(row))?.consecutiveSuccesses || 0) < 3 ? "degraded" : row.status })));
  sourceRows = registry.sources.map((source) => { const checks = rows.filter((r) => r.sourceId === source.id); return { id: source.id, label: source.label, enabled: source.enabled, status: sourceStatus(checks, source), feedCount: feedsFor(source).length, checkedFeedCount: checks.length, consecutiveFailures: source.consecutiveFailures, lastSuccessAt: source.lastSuccessAt || null, lastFailureAt: source.lastFailureAt || null }; });
  const counts = Object.fromEntries(STATES.map((s) => [s, sourceRows.filter((r) => r.status === s).length])); const alternatives = rows.flatMap((r) => (r.alternatives || []).map((a) => ({ ...a, sourceId: r.sourceId, sourceLabel: r.sourceLabel, currentFeedUrl: r.feedUrl })));
  const report = { generatedAt: new Date().toISOString(), registryVersion: registry.version, counts, sources: sourceRows, feeds: rows, alternativeCandidates: [...new Map(alternatives.map((a) => [`${a.sourceId}|${a.url}`, a])).values()], note: "대체 피드는 공식 도메인에서 발견한 후보만 기록하며 자동 레지스트리 반영하지 않습니다." };
  atomicWrite(REPORT_JSON, JSON.stringify(report, null, 2) + "\n"); atomicWrite(REPORT_MD, `# 공식 피드 진단 보고서\n\n- 검사 시각: ${report.generatedAt}\n- 매체 상태: ${JSON.stringify(counts)}\n- 피드: ${rows.length}개\n\n| 매체 | 상태 | 최신 게시 | 평균 간격(일) | canonical | ETag | Last-Modified |\n|---|---|---|---:|---:|---|---|\n${rows.map((r) => `| ${r.sourceLabel} | ${r.status} | ${r.latestPublishedAt || "-"} | ${r.averageIntervalDays ?? "-"} | ${r.canonicalCoverage ?? "-"} | ${r.etag || "-"} | ${r.lastModified || "-"} |`).join("\n")}\n\n## 대체 공식 피드 후보\n\n${report.alternativeCandidates.map((r) => `- ${r.sourceLabel} · ${r.url} · ${r.reason}`).join("\n") || "없음"}\n`); return report;
}
async function health() { const diagnostic = readJson(REPORT_JSON, null); const report = diagnostic?.feeds ? diagnostic : await diagnose(); const sourceHealth = { generatedAt: report.generatedAt, registryVersion: report.registryVersion, counts: report.counts, sources: report.sources, feeds: report.feeds, note: "건강 검사 결과는 레지스트리·production 데이터를 자동 수정하지 않습니다." }; atomicWrite(SOURCE_HEALTH_PATH, JSON.stringify(sourceHealth, null, 2) + "\n"); atomicWrite(HEALTH_MD, `# 공식 소스 건강 보고서\n\n- 검사 시각: ${report.generatedAt}\n- 소스 상태: ${JSON.stringify(report.counts)}\n- 피드 검사: ${(report.feeds || []).length}개\n\n| 매체 | 상태 | 피드 | 실패 누적 | 최근 성공 |\n|---|---|---:|---:|---|\n${report.sources.map((row) => `| ${row.label} | ${row.status} | ${row.checkedFeedCount}/${row.feedCount} | ${row.consecutiveFailures} | ${row.lastSuccessAt || "-"} |`).join("\\n")}\n\n## 피드 상세\n\n${report.feeds.map((row) => `- ${row.status} · ${row.sourceLabel} · ${row.feedUrl} · HTTP ${row.httpStatus || "-"} · 항목 ${row.itemCount || 0} · canonical ${row.canonicalCoverage ?? "-"} · relay ${row.relayRatio ?? "-"} · ETag ${row.etag || "-"} · Last-Modified ${row.lastModified || "-"} · ${row.error || row.lastError || "정상"}`).join("\\n")}\n`); console.log(JSON.stringify({ generatedAt: report.generatedAt, counts: report.counts, feeds: report.feeds.length }, null, 2)); return sourceHealth; }
async function discover(domain) {
  if (!domain) throw new Error("공식 도메인이 필요합니다");
  const source = normalizeSource({ label: domain, officialDomains: [domain], timeoutMs: 12000 });
  const errors = [];
  const candidates = await discoverAlternatives(source, `https://${domain.replace(/^https?:\/\//, "")}/`, errors);
  // 후보 0개일 때 errors를 봐야 "피드가 없는 것"과 "차단당한 것"을 구분할 수 있다
  console.log(JSON.stringify({ domain, candidates, errors, note: "발견 결과는 사람이 레지스트리에 승인해 넣어야 합니다." }, null, 2));
}
function list() { const registry = loadRegistry(); console.log(registry.sources.map((s) => `${s.id}\t${s.enabled ? "enabled" : "disabled"}\t${s.healthStatus}\t${s.label}\t${feedsFor(s).length} feed`).join("\n")); }
function report() { console.log(JSON.stringify(readJson(REPORT_JSON, readJson(SOURCE_HEALTH_PATH, { counts: {}, sources: [], feeds: [] })), null, 2)); }
function disable(id, flags) { const registry = loadRegistry(); const source = registry.sources.find((r) => r.id === id || r.label === id); if (!source) throw new Error(`소스를 찾을 수 없습니다: ${id}`); const plan = { id: source.id, label: source.label, previousEnabled: source.enabled, enabled: false, reason: flags.reason || "manual disable", dryRun: !flags.apply }; console.log(JSON.stringify(plan, null, 2)); if (!flags.apply) return; source.enabled = false; source.active = false; source.healthStatus = "disabled"; source.notes = flags.reason || source.notes || "manual disable"; atomicWrite(REGISTRY_PATH, JSON.stringify({ ...registry, generatedAt: new Date().toISOString(), sources: registry.sources }, null, 2) + "\n"); }
async function repair(flags) { const report = readJson(REPORT_JSON, null) || await diagnose(); const repairs = readJson(path.join(ROOT, "data", "sources", "feed-repairs.json"), { approved: [] }); const approved = new Map((repairs.approved || []).map((x) => [`${x.sourceId}|${x.from}`, x])); const candidates = report.alternativeCandidates || []; const plan = { dryRun: !flags["apply-approved"], candidates: candidates.map((x) => ({ ...x, approved: approved.has(`${x.sourceId}|${x.currentFeedUrl}`) })) }; console.log(JSON.stringify(plan, null, 2)); if (!flags["apply-approved"]) return; const registry = loadRegistry(); let changed = 0; for (const source of registry.sources) { const item = [...approved.values()].find((x) => x.sourceId === source.id); if (!item || !officialFeedUrl(item.url, source)) continue; source.rssUrls = [...new Set([...(source.rssUrls || []).filter((u) => u !== item.from), item.url])]; source.healthStatus = "unknown"; changed++; } if (changed) atomicWrite(REGISTRY_PATH, JSON.stringify({ ...registry, generatedAt: new Date().toISOString(), sources: registry.sources }, null, 2) + "\n"); console.log(JSON.stringify({ applied: changed }, null, 2)); }
const { command, positional, flags } = args();
try { if (command === "list") list(); else if (command === "health") await health(); else if (command === "diagnose") { const r = await diagnose(positional[0]); console.log(JSON.stringify({ counts: r.counts, feeds: r.feeds.length, alternatives: r.alternativeCandidates.length }, null, 2)); } else if (command === "repair") await repair(flags); else if (command === "check") { const r = await diagnose(positional[0]); console.log(JSON.stringify(r, null, 2)); } else if (command === "discover-feeds") await discover(positional[0]); else if (command === "disable") disable(positional[0], flags); else if (command === "report") report(); else throw new Error("사용법: list | health | diagnose | repair [--apply-approved] | check SOURCE_ID | discover-feeds DOMAIN | disable SOURCE_ID [--apply] | report"); } catch (error) { console.error(error.message); process.exit(1); }
