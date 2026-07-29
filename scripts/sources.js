import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SOURCE_HEALTH_PATH, atomicWrite, fetchFeed, hostOf, isOfficialUrl, loadRegistry, normalizeSource, readJson,
} from "../src/lib/source-first.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPORT_MD = path.join(ROOT, "reports", "source-health.md");
const REGISTRY_PATH = path.join(ROOT, "data", "sources", "registry.json");
const USER_AGENT = "VetManLab-SourceFirst/5.0 (+https://news.vetmanlab.com/about)";

function args() {
  const raw = process.argv.slice(2); const command = raw.shift() || "list";
  return { command, positional: raw.filter((x) => !x.startsWith("--")), flags: Object.fromEntries(raw.filter((x) => x.startsWith("--")).map((x) => { const [key, ...rest] = x.slice(2).split("="); return [key, rest.length ? rest.join("=") : true]; })) };
}
function feedsFor(source) { return [...new Set([...(source.rssUrls || []), ...(source.atomUrls || [])])]; }
function parseRobots(text, targetPath) {
  let active = false;
  for (const line of String(text || "").split(/\r?\n/)) {
    const clean = line.split("#")[0].trim();
    if (/^user-agent\s*:\s*\*/i.test(clean)) active = true;
    else if (/^user-agent\s*:/i.test(clean)) active = false;
    else if (active && /^disallow\s*:/i.test(clean)) {
      const value = clean.replace(/^disallow\s*:/i, "").trim();
      if (value && targetPath.startsWith(value)) return false;
    }
  }
  return true;
}
async function robotsAllowed(url, source) {
  try {
    const parsed = new URL(url); const robotsUrl = `${parsed.protocol}//${parsed.host}/robots.txt`;
    const response = await fetch(robotsUrl, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(source.timeoutMs) });
    if (!response.ok) return { checked: false, allowed: true, url: robotsUrl };
    return { checked: true, allowed: parseRobots(await response.text(), parsed.pathname), url: robotsUrl };
  } catch { return { checked: false, allowed: true, url: null }; }
}
function statusFor(result, source) {
  if (result.error || !result.ok) return "failing";
  if (result.stale) return "stale";
  if (!result.officialDomain || result.relayRatio > 0 || result.canonicalCoverage < 0.5) return "degraded";
  return "healthy";
}
async function checkFeed(source, url) {
  const checkedAt = new Date().toISOString(); const robots = await robotsAllowed(url, source);
  if (!robots.allowed) return { sourceId: source.id, sourceLabel: source.label, feedUrl: url, checkedAt, status: "disabled", error: "robots.txt disallows this feed", robots };
  try {
    const feed = await fetchFeed(source, url, { useCache: false, retries: 1 });
    const entries = feed.entries || []; const guids = entries.map((entry) => entry.guid).filter(Boolean);
    const duplicateGuids = guids.length - new Set(guids).size;
    const latest = entries.map((entry) => new Date(entry.publishedAt || 0).getTime()).filter(Number.isFinite).filter((x) => x > 0).sort((a, b) => b - a)[0] || null;
    const ageDays = latest ? Number(((Date.now() - latest) / 86400000).toFixed(2)) : null;
    const canonicalCount = entries.filter((entry) => entry.canonicalUrl && isOfficialUrl(entry.canonicalUrl, source)).length;
    const officialDomain = entries.length === 0 || entries.every((entry) => isOfficialUrl(entry.canonicalUrl || entry.url, source));
    const result = { sourceId: source.id, sourceLabel: source.label, feedUrl: url, finalUrl: feed.finalUrl || url, checkedAt, httpStatus: feed.status, contentType: feed.contentType, xmlParsed: true, itemCount: entries.length, latestPublishedAt: latest ? new Date(latest).toISOString() : null, ageDays, stale: ageDays != null && ageDays > 7, duplicateGuidCount: duplicateGuids, officialDomain, relayRatio: entries.length ? Number((entries.filter((entry) => entry.relay).length / entries.length).toFixed(3)) : 0, canonicalCoverage: entries.length ? Number((canonicalCount / entries.length).toFixed(3)) : 1, robots, ok: true };
    result.status = statusFor(result, source); return result;
  } catch (error) {
    return { sourceId: source.id, sourceLabel: source.label, feedUrl: url, checkedAt, status: "failing", ok: false, error: error.message, robots };
  }
}
async function health(sourceFilter = null) {
  const registry = loadRegistry(); const sources = registry.sources.filter((source) => source.enabled && (!sourceFilter || source.id === sourceFilter || source.label === sourceFilter));
  const rows = [];
  for (const source of sources) for (const url of feedsFor(source)) rows.push(await checkFeed(source, url));
  const sourceRows = registry.sources.map((source) => {
    const checks = rows.filter((row) => row.sourceId === source.id); const states = new Set(checks.map((row) => row.status));
    const status = !source.enabled || !feedsFor(source).length ? "disabled" : states.has("failing") ? "failing" : states.has("degraded") ? "degraded" : states.has("stale") ? "stale" : checks.length ? "healthy" : "degraded";
    return { id: source.id, label: source.label, enabled: source.enabled, status, feedCount: feedsFor(source).length, checkedFeedCount: checks.length, consecutiveFailures: source.consecutiveFailures, lastSuccessAt: source.lastSuccessAt, lastFailureAt: source.lastFailureAt };
  });
  const counts = Object.fromEntries(["healthy", "stale", "degraded", "failing", "disabled"].map((status) => [status, sourceRows.filter((row) => row.status === status).length]));
  const report = { generatedAt: new Date().toISOString(), registryVersion: registry.version, counts, sources: sourceRows, feeds: rows, note: "건강 검사 결과는 레지스트리·production 데이터를 자동 수정하지 않습니다." };
  atomicWrite(SOURCE_HEALTH_PATH, JSON.stringify(report, null, 2) + "\n");
  atomicWrite(REPORT_MD, `# 공식 소스 건강 보고서\n\n- 검사 시각: ${report.generatedAt}\n- 소스 상태: ${JSON.stringify(counts)}\n- 피드 검사: ${rows.length}개\n\n| 매체 | 상태 | 피드 | 실패 누적 | 최근 성공 |\n|---|---|---:|---:|---|\n${sourceRows.map((row) => `| ${row.label} | ${row.status} | ${row.checkedFeedCount}/${row.feedCount} | ${row.consecutiveFailures} | ${row.lastSuccessAt || "-"} |`).join("\n")}\n\n## 피드 상세\n\n${rows.map((row) => `- ${row.status} · ${row.sourceLabel} · ${row.feedUrl} · 항목 ${row.itemCount || 0} · canonical ${row.canonicalCoverage ?? "-"} · relay ${row.relayRatio ?? "-"} · ${row.error || "정상"}`).join("\n")}\n`);
  console.log(JSON.stringify({ generatedAt: report.generatedAt, counts, feeds: rows.length }, null, 2));
  return report;
}
async function discover(domain) {
  if (!domain) throw new Error("공식 도메인이 필요합니다: npm run sources:discover-feeds -- <official-domain>");
  const source = normalizeSource({ label: domain, officialDomains: [domain], timeoutMs: 12000 }); const base = `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  const response = await fetch(base, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(source.timeoutMs) });
  const html = await response.text(); const links = [...html.matchAll(/<link[^>]+(?:type=["']application\/(?:rss|atom)\+xml["'][^>]*|rel=["'][^"']*alternate[^"']*["'][^>]*)[^>]*>/gi)].map((match) => match[0]);
  const feeds = [...new Set(links.map((tag) => tag.match(/href=["']([^"']+)/i)?.[1]).filter(Boolean).map((href) => new URL(href, response.url || base).toString()).filter((url) => isOfficialUrl(url, source)))];
  const robots = await robotsAllowed(response.url || base, source); const result = { domain, status: response.status, finalUrl: response.url || base, discoveredFeeds: feeds, robots, note: "발견 결과는 사람이 레지스트리에 승인해 넣어야 합니다." };
  console.log(JSON.stringify(result, null, 2));
}
function list() { const registry = loadRegistry(); console.log(registry.sources.map((source) => `${source.id}\t${source.enabled ? "enabled" : "disabled"}\t${source.healthStatus}\t${source.label}\t${feedsFor(source).length} feed`).join("\n")); }
function report() { const value = readJson(SOURCE_HEALTH_PATH, { counts: {}, sources: [], feeds: [] }); console.log(JSON.stringify(value, null, 2)); }
function disable(id, flags) {
  const registry = loadRegistry(); const source = registry.sources.find((row) => row.id === id || row.label === id); if (!source) throw new Error(`소스를 찾을 수 없습니다: ${id}`);
  const plan = { id: source.id, label: source.label, previousEnabled: source.enabled, enabled: false, reason: flags.reason || "manual disable", dryRun: !flags.apply };
  console.log(JSON.stringify(plan, null, 2)); if (!flags.apply) return;
  source.enabled = false; source.active = false; source.healthStatus = "disabled"; source.notes = flags.reason || source.notes || "manual disable"; atomicWrite(REGISTRY_PATH, JSON.stringify({ ...registry, generatedAt: new Date().toISOString(), sources: registry.sources }, null, 2) + "\n");
}
const { command, positional, flags } = args();
try {
  if (command === "list") list();
  else if (command === "health") await health();
  else if (command === "check") await health(positional[0]);
  else if (command === "discover-feeds") await discover(positional[0]);
  else if (command === "disable") disable(positional[0], flags);
  else if (command === "report") report();
  else throw new Error("사용법: list | health | check SOURCE_ID | discover-feeds DOMAIN | disable SOURCE_ID [--apply] | report");
} catch (error) { console.error(error.message); process.exit(1); }
