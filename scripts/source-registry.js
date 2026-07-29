import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { fetchArticleMetadata, normalizeSource, safeSourceUrl } from "../src/lib/source-first.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const MAPPING = path.join(ROOT, "data", "source-publishers.json");
const REGISTRY = path.join(ROOT, "data", "sources", "registry.json");
const REPORTS = path.join(ROOT, "reports");
const RELAY = /^https?:\/\/(?:news\.)?google\.[^/]+\/rss\/articles\//i;
const NON_PUBLISHER_HOSTS = new Set(["doi.org", "dx.doi.org", "news.google.com"]);
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function atomic(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`; fs.writeFileSync(tmp, value); fs.renameSync(tmp, file); }
function sourceRows() {
  const rows = [];
  for (const file of fs.readdirSync(ISSUES).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    const issue = readJson(path.join(ISSUES, file), {});
    for (const [index, item] of (issue.items || []).entries()) rows.push({ item, file, index, date: issue.date });
  }
  return rows;
}
function host(url) { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; } }
function sourceId(label) { return `src-${String(label || "source").normalize("NFKC").toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 56) || crypto.createHash("sha1").update(String(label)).digest("hex").slice(0, 10)}`; }
function safeArticleUrl(url) { try { const value = new URL(url); return value.protocol === "https:" && !/(?:google\.|search|tag|category|login|subscribe|author)/i.test(`${value.hostname}${value.pathname}`); } catch { return false; } }
function similarity(a, b) { const left = new Set(String(a || "").toLowerCase().replace(/[^a-z0-9가-힣]+/gi, " ").split(/\s+/).filter((x) => x.length > 1)); const right = new Set(String(b || "").toLowerCase().replace(/[^a-z0-9가-힣]+/gi, " ").split(/\s+/).filter((x) => x.length > 1)); if (!left.size || !right.size) return 0; return [...left].filter((x) => right.has(x)).length / Math.max(left.size, right.size); }
function buildRegistry() {
  const mapping = readJson(MAPPING, {});
  const rows = sourceRows();
  const labels = new Set([...Object.keys(mapping), ...rows.map(({ item }) => item.sourceLabel).filter(Boolean)]);
  return [...labels].sort().map((label) => {
    const configured = mapping[label] || {};
    const directHosts = [...new Set(rows.filter(({ item }) => item.sourceLabel === label).map(({ item }) => item.sourceUrlRaw || item.sourceUrl).filter((url) => url && !RELAY.test(url)).map(host).filter((value) => value && !NON_PUBLISHER_HOSTS.has(value)))];
    const domains = [...new Set([...(configured.domains || []), ...directHosts])];
    const rssUrls = configured.rssUrls || configured.feeds || [];
    const enabled = configured.enabled ?? configured.active ?? Boolean(domains.length);
    return {
      id: configured.id || sourceId(label), label, officialName: configured.officialName || label,
      domains, officialDomains: domains, rssUrls, atomUrls: configured.atomUrls || [], sitemapUrls: configured.sitemapUrls || [],
      fetchStrategy: configured.fetchStrategy || (rssUrls.length ? "rss" : "manual"),
      archiveUrl: configured.archiveUrl || null, searchUrlTemplate: configured.searchUrlTemplate || null,
      country: configured.country || null, language: configured.language || "en", timezone: configured.timezone || "UTC",
      sourceType: configured.sourceType || "publisher", rateLimitMs: Number(configured.rateLimitMs) || 1000,
      timeoutMs: Number(configured.timeoutMs) || 12000, enabled: Boolean(enabled), priority: Number(configured.priority) || (enabled ? 50 : 0),
      active: Boolean(enabled), lastSuccessAt: configured.lastSuccessAt || null, lastFailureAt: configured.lastFailureAt || null,
      consecutiveFailures: Number(configured.consecutiveFailures) || 0, healthStatus: configured.healthStatus || (enabled ? "unknown" : "disabled"),
      notes: configured.notes || null, evidence: configured.evidence || [Object.prototype.hasOwnProperty.call(mapping, label) ? "data/source-publishers.json" : "existing-direct-source-url"],
    };
  });
}
function stats() {
  const registry = readJson(REGISTRY, { sources: [] });
  const rows = sourceRows();
  const counts = Object.fromEntries([...new Set(rows.map(({ item }) => item.sourceLabel).filter(Boolean))].map((label) => [label, rows.filter(({ item }) => item.sourceLabel === label).length]).sort((a, b) => b[1] - a[1]));
  const report = { generatedAt: new Date().toISOString(), totalArticles: rows.length, relayArticles: rows.filter(({ item }) => RELAY.test(item.sourceUrlRaw || item.sourceUrl || "")).length, registrySources: registry.sources.length, activeSources: registry.sources.filter((source) => source.active).length, sourceCounts: counts, top10: Object.entries(counts).slice(0, 10).map(([label, count]) => ({ label, count, registry: registry.sources.find((source) => source.label === label) || null })) };
  atomic(path.join(REPORTS, "source-stats.json"), JSON.stringify(report, null, 2) + "\n");
  atomic(path.join(REPORTS, "source-stats.md"), `# 원출처 매체 통계\n\n- 기사: ${report.totalArticles}\n- Google News 중계: ${report.relayArticles}\n- 레지스트리: ${report.registrySources}\n- 활성 매체: ${report.activeSources}\n\n## 상위 매체\n\n${report.top10.map((row) => `- ${row.label}: ${row.count}건 · 도메인 ${row.registry?.domains?.join(", ") || "미확정"} · RSS ${row.registry?.rssUrls?.length || 0}개`).join("\n")}\n`);
  console.log(JSON.stringify(report, null, 2));
}
function next() {
  const report = readJson(path.join(REPORTS, "source-resolution.json"), { manualReviewQueue: [] });
  const queue = report.manualReviewQueue || [];
  console.log(queue.slice(0, 50).map((row) => `${row.articleId}\t${row.status}\t${row.sourceLabel || "출처 미상"}\t${row.titleKo || ""}`).join("\n"));
}
function show(id) {
  const report = readJson(path.join(REPORTS, "source-resolution.json"), { rows: [] });
  const row = (report.rows || []).find((candidate) => candidate.articleId === id);
  if (!row) throw new Error(`출처 검수 항목을 찾을 수 없습니다: ${id}`);
  console.log(JSON.stringify(row, null, 2));
}
async function decision(id, url, status, apply) {
  const decisionsPath = path.join(ROOT, "data", "source-resolution-decisions.json");
  const decisions = readJson(decisionsPath, {});
  if (status === "manually-approved") {
    const report = readJson(path.join(REPORTS, "source-resolution.json"), { rows: [] });
    const row = (report.rows || []).find((candidate) => candidate.articleId === id);
    const source = (readJson(REGISTRY, { sources: [] }).sources || []).find((candidate) => candidate.label === row?.sourceLabel);
    if (!row || !safeArticleUrl(url) || !source?.domains?.some((domain) => host(url) === domain || host(url).endsWith(`.${domain}`))) throw new Error("승인 URL은 HTTPS 개별 기사이고 해당 매체의 등록 도메인이어야 합니다.");
    const metadata = await fetchArticleMetadata(normalizeSource(source), url, { useCache: false });
    const canonical = metadata.canonicalUrl && safeSourceUrl(metadata.canonicalUrl) ? metadata.canonicalUrl : null;
    if (!canonical || host(canonical) !== host(url)) throw new Error("원문 canonical을 확인하지 못했거나 승인 URL과 다른 도메인입니다.");
    if (similarity(row.sourceTitle || row.titleKo, metadata.title || "") < 0.75) throw new Error("원문 제목 유사도가 부족합니다. 제목이 일치하는 공식 개별 기사만 승인할 수 있습니다.");
    if (row.publishedAt && metadata.publishedAt) {
      const delta = Math.abs(new Date(row.publishedAt).getTime() - new Date(metadata.publishedAt).getTime());
      if (Number.isFinite(delta) && delta > 4 * 86400000) throw new Error("원문 발행일이 relay 기사와 4일 이상 다릅니다.");
    }
  }
  const plan = { articleId: id, status, ...(url ? { url } : {}), decidedAt: new Date().toISOString(), apply: Boolean(apply) };
  console.log(JSON.stringify(plan, null, 2));
  if (!apply) { console.log("dry-run: --apply를 붙여야 승인 결정이 저장됩니다."); return; }
  decisions[id] = { status, ...(url ? { url } : {}), decidedAt: plan.decidedAt };
  atomic(decisionsPath, JSON.stringify(decisions, null, 2) + "\n");
  if (status === "manually-approved") {
    const report = readJson(path.join(REPORTS, "source-resolution.json"), { rows: [] });
    const row = (report.rows || []).find((candidate) => candidate.articleId === id);
    if (row) {
      const filePath = path.join(ISSUES, row.file); const issue = readJson(filePath, null); const item = issue?.items?.[row.index];
      if (item) { item.sourceUrlRaw ||= item.sourceUrl; item.sourceUrl = url; item.finalUrl = url; item.sourceResolution = { status, reviewedAt: plan.decidedAt, previousUrl: item.sourceUrlRaw }; atomic(filePath, JSON.stringify(issue, null, 2) + "\n"); }
    }
  }
  console.log(`결정 저장: ${id} · ${status}`);
}
function audit() {
  const registry = readJson(REGISTRY, { sources: [] });
  const invalid = registry.sources.filter((source) => !source.label || !Array.isArray(source.domains) || !Array.isArray(source.rssUrls));
  const report = { generatedAt: new Date().toISOString(), total: registry.sources.length, active: registry.sources.filter((source) => source.active).length, withRss: registry.sources.filter((source) => source.rssUrls.length).length, invalid: invalid.map((source) => source.label) };
  atomic(path.join(REPORTS, "source-registry-audit.json"), JSON.stringify(report, null, 2) + "\n");
  atomic(path.join(REPORTS, "source-registry-audit.md"), `# 출처 레지스트리 감사\n\n- 매체: ${report.total}\n- 활성: ${report.active}\n- RSS 설정: ${report.withRss}\n- 오류: ${report.invalid.length ? report.invalid.join(", ") : "없음"}\n`);
  console.log(JSON.stringify(report, null, 2));
}
const [command, ...positional] = process.argv.slice(2);
const apply = process.argv.includes("--apply");
try {
  if (command === "stats") stats();
  else if (command === "next") next();
  else if (command === "show") show(positional[0]);
  else if (command === "approve") await decision(positional[0], positional[1], "manually-approved", apply);
  else if (command === "reject") await decision(positional[0], null, "rejected", apply);
  else if (command === "registry:audit") audit();
  else if (command === "registry:generate") { atomic(REGISTRY, JSON.stringify({ version: 2, generatedAt: new Date().toISOString(), sources: buildRegistry() }, null, 2) + "\n"); console.log(`레지스트리 생성: ${REGISTRY}`); }
  else throw new Error("사용법: stats | next | show ID | approve ID URL [--apply] | reject ID [--apply] | registry:audit | registry:generate");
} catch (error) { console.error(error.message); process.exit(1); }
