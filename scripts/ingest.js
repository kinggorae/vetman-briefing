import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { MODEL } from "../config.js";
import { inferClinicalRisk } from "../src/lib/editorial-review.js";
import { articleContractIssues, SCHEMA_VERSION } from "../src/lib/editorial-operations.js";
import { publishQualityIssues } from "../src/quality.js";
import { stableItemId, sourceKeys } from "../src/identity.js";
import {
  atomicWrite, contentHash as sourceContentHash, dedupeFeedEntries, fetchArticleMetadata, fetchFeed, isOfficialUrl, isRelayUrl,
  loadRegistry, metadataHash, normalizeSource, readJson, safeSourceUrl, sourceStatusFor,
} from "../src/lib/source-first.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const DRAFT_DIR = path.join(ROOT, "data", "drafts");
const REPORT_JSON = path.join(ROOT, "reports", "ingest-report.json");
const REPORT_MD = path.join(ROOT, "reports", "ingest-report.md");
const RELAY = /^https?:\/\/(?:news\.)?google\.[^/]+\/rss\/articles\//i;
const VET_TERMS = /veterin|animal health|animal hospital|pet health|dog|cat|canine|feline|equine|veterinary|zoon|rabies|parasit|antimicrobial|clinical|journal|medicine|병원|동물|수의|반려|질환|감염|백신|논문|임상/i;

function args() {
  const raw = process.argv.slice(2); const command = raw.shift() || "dry";
  return { command, positional: raw.filter((x) => !x.startsWith("--")), flags: Object.fromEntries(raw.filter((x) => x.startsWith("--")).map((x) => { const [key, ...rest] = x.slice(2).split("="); return [key, rest.length ? rest.join("=") : true]; })) };
}
function today() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()); }
function allExisting() {
  const rows = [];
  if (!fs.existsSync(ISSUES)) return rows;
  for (const file of fs.readdirSync(ISSUES).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))) {
    const issue = readJson(path.join(ISSUES, file), {});
    for (const item of issue.items || []) rows.push(item);
  }
  return rows;
}
function sourcesFor(id) {
  const registry = loadRegistry();
  const sources = registry.sources.filter((source) => source.enabled && (!id || source.id === id || source.label === id));
  if (id && !sources.length) throw new Error(`활성 공식 소스를 찾을 수 없습니다: ${id}`);
  return sources;
}
function feedUrls(source) { return [...new Set([...(source.rssUrls || []), ...(source.atomUrls || [])])]; }
function relevance(entry) { return VET_TERMS.test(`${entry.title} ${entry.description}`) ? "relevant" : "excluded"; }
function sourceStatus(entry, source) { return sourceStatusFor(entry, source); }
async function generateDraft(draft, entry, flags) {
  if (!flags.generate) return draft;
  if (!(process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY)) return { ...draft, generation: { ...draft.generation, generationWarnings: ["llm-key-not-configured"] } };
  try {
    const { generateItem } = await import("../src/generate.js");
    const generated = await generateItem({ ...entry, sourceType: "rss", finalUrl: draft.sourceUrl, url: draft.sourceUrlRaw, fullText: entry.description, body: entry.description, sourceLabel: draft.sourceLabel, publishedAt: draft.sourcePublishedAt });
    const outputHash = sourceContentHash(JSON.stringify({ titleKo: generated.titleKo, leadKo: generated.leadKo, bodyKo: generated.bodyKo, keyPointsKo: generated.keyPointsKo }));
    return { ...draft, ...generated, id: draft.id, sourceUrl: draft.sourceUrl, sourceUrlRaw: draft.sourceUrlRaw, sourceStatus: draft.sourceStatus, sourceEvidence: draft.sourceEvidence, workflowStatus: "draft", editorialStatus: "editor-review-required", generation: { model: MODEL, promptVersion: "source-first-v1", generatedAt: new Date().toISOString(), inputSourceIds: [draft.sourceId], inputHash: draft.generation.inputHash, outputHash, generationWarnings: [] }, contentHash: outputHash, metadataHash: draft.metadataHash, clinicalRisk: inferClinicalRisk(generated) };
  } catch (error) {
    return { ...draft, generation: { ...draft.generation, model: MODEL, promptVersion: "source-first-v1", generationWarnings: [`generation-failed:${error.message.slice(0, 120)}`] } };
  }
}
function draftFor(entry, source, flags) {
  const status = sourceStatus(entry, source); const officialUrl = status === "verified" && safeSourceUrl(entry.canonicalUrl || entry.url) && isOfficialUrl(entry.canonicalUrl || entry.url, source) ? entry.canonicalUrl || entry.url : null;
  const input = { sourceTitle: entry.title, description: entry.description, canonicalUrl: entry.canonicalUrl, publishedAt: entry.publishedAt, guid: entry.guid, sourceId: source.id };
  const inputHash = metadataHash(input);
  const draft = {
    id: stableItemId({ sourceUrl: officialUrl || entry.url, sourceTitle: entry.title, title: entry.title }, `source-${entry.guid}`),
    dataSchemaVersion: SCHEMA_VERSION, draftKind: "source-candidate", workflowStatus: "draft", editorialStatus: "editor-review-required",
    sourceStatus: status, discoverySource: "official-rss", sourceId: source.id, sourceLabel: source.label,
    sourceUrlRaw: entry.url, sourceUrl: officialUrl, sourceTitle: entry.title, sourcePublishedAt: entry.publishedAt,
    publishedAt: null, firstPublishedAt: null, updatedAt: null, fetchedAt: new Date().toISOString(), canonicalUrl: entry.canonicalUrl || null,
    guid: entry.guid, description: entry.description || null, sourceContentHash: sourceContentHash(`${entry.title}\n${entry.description}`), metadataHash: inputHash,
    contentHash: null, titleKo: null, leadKo: null, bodyKo: [], keyPointsKo: [],
    contentTier: "brief", clinicalRisk: inferClinicalRisk({ titleKo: entry.title, leadKo: entry.description, bodyKo: [] }),
    generation: { model: null, promptVersion: null, generatedAt: null, inputSourceIds: [source.id], inputHash, outputHash: null, generationWarnings: ["llm-generation-not-requested"] },
    duplicateStatus: entry.duplicateStatus, duplicateOf: entry.duplicateOf || null,
    sourceEvidence: { title: entry.title, sourceLabel: source.label, publishedAt: entry.publishedAt, canonicalUrl: entry.canonicalUrl || null, description: entry.description || null, pageMetadata: entry.pageMetadata || null, fetchedAt: new Date().toISOString(), responseHeaders: null, hash: inputHash },
    relevance: relevance(entry), generationRequested: Boolean(flags.generate),
  };
  return draft;
}
function sourceRows(sources, flags) {
  return Promise.all(sources.flatMap((source) => feedUrls(source).map(async (url) => {
    try {
      const result = await fetchFeed(source, url, { useCache: !flags.refresh, retries: 1 });
      return { source, url, result, error: null };
    } catch (error) { return { source, url, result: null, error: error.message }; }
  })));
}
async function confirmCanonicals(entries, sources, flags) {
  const checked = [];
  const lastRequest = new Map();
  for (const entry of entries) {
    const source = sources.find((candidate) => candidate.id === entry.sourceId);
    if (!source || entry.canonicalUrl || !isOfficialUrl(entry.url, source) || isRelayUrl(entry.url)) { checked.push(entry); continue; }
    const rateLimitMs = Math.max(0, Number(source.rateLimitMs) || 1000);
    const wait = rateLimitMs - (Date.now() - (lastRequest.get(source.id) || 0));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest.set(source.id, Date.now());
    try {
      const metadata = await fetchArticleMetadata(source, entry.url, { useCache: !flags.refresh });
      checked.push({ ...entry, canonicalUrl: metadata.canonicalUrl || null, pageMetadata: { title: metadata.title, publishedAt: metadata.publishedAt, finalUrl: metadata.finalUrl, checkedAt: metadata.checkedAt, hash: metadata.hash } });
    } catch (error) {
      checked.push({ ...entry, pageMetadata: { error: error.message.slice(0, 160) } });
    }
  }
  return checked;
}
async function collect(id, flags) {
  const sources = sourcesFor(id); const fetched = await sourceRows(sources, flags); const existing = allExisting();
  const entries = fetched.flatMap((row) => (row.result?.entries || []).map((entry) => ({ ...entry, sourceId: row.source.id, sourceLabel: row.source.label })));
  const deduped = dedupeFeedEntries(entries, existing); let draftEntries = deduped.filter((entry) => relevance(entry) === "relevant" && entry.duplicateStatus === "unique").slice(0, Math.max(1, Number(flags.max) || 50)); draftEntries = await confirmCanonicals(draftEntries, sources, flags); const drafts = [];
  for (const entry of draftEntries) drafts.push(await generateDraft(draftFor(entry, sources.find((source) => source.id === entry.sourceId) || normalizeSource({ label: entry.sourceLabel }), flags), entry, flags));
  const report = {
    generatedAt: new Date().toISOString(), mode: flags.dry ? "dry-run" : "write-draft", sources: sources.map((source) => ({ id: source.id, label: source.label, feeds: feedUrls(source) })),
    feeds: fetched.map((row) => ({ sourceId: row.source.id, sourceLabel: row.source.label, url: row.url, itemCount: row.result?.entries?.length || 0, fromCache: row.result?.fromCache || false, error: row.error })),
    counts: { sources: sources.length, feeds: fetched.length, feedFailures: fetched.filter((row) => row.error).length, fetchedEntries: entries.length, unique: deduped.filter((entry) => entry.duplicateStatus === "unique").length, exactDuplicate: deduped.filter((entry) => entry.duplicateStatus === "exact-duplicate").length, updateOfExisting: deduped.filter((entry) => entry.duplicateStatus === "update-of-existing").length, excludedIrrelevant: deduped.filter((entry) => relevance(entry) === "excluded").length, drafts: drafts.length, canonicalChecked: draftEntries.filter((entry) => entry.pageMetadata).length, verifiedCanonical: drafts.filter((draft) => draft.sourceStatus === "verified").length, unresolved: drafts.filter((draft) => draft.sourceStatus === "unresolved").length, relaySourceUrl: drafts.filter((draft) => RELAY.test(draft.sourceUrl || "")).length },
    drafts: drafts.map((draft) => ({ id: draft.id, title: draft.sourceTitle, sourceId: draft.sourceId, sourceStatus: draft.sourceStatus, duplicateStatus: draft.duplicateStatus, sourceUrl: draft.sourceUrl, sourceUrlRaw: draft.sourceUrlRaw, publishedAt: draft.sourcePublishedAt, clinicalRisk: draft.clinicalRisk, editorialStatus: draft.editorialStatus, provenance: draft.generation })),
    note: "수집 결과는 자동 published로 전환되지 않으며, 공식 canonical·중복·임상 검수 후에만 다음 단계로 이동할 수 있습니다.",
  };
  return { report, drafts };
}
function writeReport(report) {
  atomicWrite(REPORT_JSON, JSON.stringify(report, null, 2) + "\n");
  atomicWrite(REPORT_MD, `# Source-first 수집 보고서\n\n- 실행 시각: ${report.generatedAt}\n- 모드: ${report.mode}\n- 소스/피드: ${report.counts.sources}/${report.counts.feeds}\n- 수집 항목: ${report.counts.fetchedEntries}\n- 고유 후보: ${report.counts.unique}\n- exact duplicate: ${report.counts.exactDuplicate}\n- 기존 기사 업데이트 후보: ${report.counts.updateOfExisting}\n- 관련성 제외: ${report.counts.excludedIrrelevant}\n- draft 후보: ${report.counts.drafts}\n- canonical 확인 시도: ${report.counts.canonicalChecked}\n- 공식 canonical 확보: ${report.counts.verifiedCanonical}\n- unresolved source: ${report.counts.unresolved}\n- relay sourceUrl: ${report.counts.relaySourceUrl}\n\n## draft 후보\n\n${report.drafts.map((row) => `- ${row.id} · ${row.sourceId} · ${row.sourceStatus} · ${row.duplicateStatus} · ${row.title}`).join("\n") || "없음"}\n`);
}
function writeDraftFile(drafts, date = today()) {
  if (!drafts.length) return null;
  const file = path.join(DRAFT_DIR, `source-first-${date}.json`); const existing = readJson(file, { date, status: "draft", items: [] }); const byId = new Map((existing.items || []).map((item) => [item.id, item])); for (const draft of drafts) byId.set(draft.id, draft);
  atomicWrite(file, JSON.stringify({ ...existing, date, status: "draft", generatedAt: new Date().toISOString(), items: [...byId.values()] }, null, 2) + "\n"); return file;
}
async function promote(id, flags) {
  const files = fs.existsSync(DRAFT_DIR) ? fs.readdirSync(DRAFT_DIR).filter((file) => file.endsWith(".json")) : []; const rows = files.flatMap((file) => { const data = readJson(path.join(DRAFT_DIR, file), {}); return (data.items || []).map((item, index) => ({ file, data, index, item })); }); const row = rows.find((candidate) => candidate.item.id === id); if (!row) throw new Error(`source-first draft를 찾을 수 없습니다: ${id}`);
  const blockers = []; if (row.item.sourceStatus !== "verified") blockers.push("sourceStatus=verified 필요"); if (!row.item.sourceUrl || !safeSourceUrl(row.item.sourceUrl)) blockers.push("공식 canonical sourceUrl 필요"); if (row.item.duplicateStatus !== "unique") blockers.push(`중복 상태 ${row.item.duplicateStatus}`); if (!row.item.titleKo || !row.item.bodyKo?.length) blockers.push("AI/편집 초안 본문이 필요"); blockers.push(...articleContractIssues(row.item).filter((issue) => !["publishedAt-missing", "workflowStatus-missing"].includes(issue))); blockers.push(...publishQualityIssues(row.item));
  const plan = { id, sourceFile: `data/drafts/${row.file}`, sourceStatus: row.item.sourceStatus, sourceUrl: row.item.sourceUrl, blockers: [...new Set(blockers)], apply: Boolean(flags.apply) }; console.log(JSON.stringify(plan, null, 2)); if (!flags.apply) { console.log("dry-run: --apply 없이는 issue draft를 만들지 않습니다."); return; } if (blockers.length) throw new Error(`promote 차단:\n- ${[...new Set(blockers)].join("\n- ")}`);
  const date = flags.date || today(); const target = path.join(ISSUES, `${date}.draft.json`); const issue = readJson(target, { date, status: "draft", generatedAt: new Date().toISOString(), items: [] }); if (!issue.items.some((item) => item.id === row.item.id)) issue.items.push({ ...row.item, publishedAt: null, workflowStatus: "draft", editorialStatus: "editor-review-required" }); atomicWrite(target, JSON.stringify(issue, null, 2) + "\n"); console.log(`issue draft에 추가: ${target}`);
}
const { command, positional, flags } = args();
try {
  const id = positional[0];
  if (command === "promote") await promote(id, flags);
  else if (command === "report") { const report = readJson(REPORT_JSON, { counts: {}, drafts: [], note: "아직 수집 보고서가 없습니다." }); console.log(JSON.stringify(report, null, 2)); }
  else { const { report, drafts } = await collect(command === "source" ? id : null, { ...flags, dry: command === "dry" }); if (command === "dry") { writeReport(report); console.log(JSON.stringify(report.counts, null, 2)); } else { const file = writeDraftFile(drafts); report.draftFile = file ? path.relative(ROOT, file) : null; writeReport(report); console.log(JSON.stringify({ ...report.counts, draftFile: report.draftFile }, null, 2)); } }
} catch (error) { console.error(error.message); process.exit(1); }
