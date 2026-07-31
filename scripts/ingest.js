import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { MODEL } from "../config.js";
import { inferClinicalRisk } from "../src/lib/editorial-review.js";
import { articleContractIssues, SCHEMA_VERSION } from "../src/lib/editorial-operations.js";
import { publishQualityIssues } from "../src/quality.js";
import { bodyCharCount } from "../src/lib/quality.js";
import { enrichItems } from "../src/enrich.js";
import { fetchArticleMeta } from "../src/article.js";
import { stableItemId, sourceKeys, addSourceKeys } from "../src/identity.js";
import {
  atomicWrite, contentHash as sourceContentHash, dedupeFeedEntries, fetchArticleMetadata, fetchFeed, isOfficialUrl, isRelayUrl,
  loadRegistry, metadataHash, normalizeSource, readJson, safeSourceUrl, sourceStatusFor,
} from "../src/lib/source-first.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const DRAFT_DIR = path.join(ROOT, "data", "drafts");
// run.js와 같은 파일을 공유한다. 초안 단계에도 기억이 있어야 어제 뽑은 원문을
// 오늘 다시 집지 않는다. 이게 없으면 후보 목록 앞에서 매일 같은 30건을 자른다.
const SEEN_PATH = path.join(ROOT, "data", "seen.json");
const REPORT_JSON = path.join(ROOT, "reports", "ingest-report.json");
const REPORT_MD = path.join(ROOT, "reports", "ingest-report.md");
const RELAY = /^https?:\/\/(?:news\.)?google\.[^/]+\/rss\/articles\//i;
// src/lib/quality.js가 analysis 티어에 요구하는 본문 최소 길이와 같아야 한다.
const ANALYSIS_MIN_CHARS = 420;
const VET_TERMS = /veterin|animal health|animal hospital|pet health|dog|cat|canine|feline|equine|veterinary|zoon|rabies|parasit|antimicrobial|clinical|journal|medicine|병원|동물|수의|반려|질환|감염|백신|논문|임상/i;
// 관련도를 통과/탈락이 아니라 매칭 개수로 재기 위한 전역 판.
const VET_TERMS_GLOBAL = new RegExp(VET_TERMS.source, "gi");

function args() {
  const raw = process.argv.slice(2); const command = raw.shift() || "dry";
  return { command, positional: raw.filter((x) => !x.startsWith("--")), flags: Object.fromEntries(raw.filter((x) => x.startsWith("--")).map((x) => { const [key, ...rest] = x.slice(2).split("="); return [key, rest.length ? rest.join("=") : true]; })) };
}
function today() { return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date()); }
// 후보 점수. 선정은 LLM 생성 전에 일어나므로 피드 메타데이터만 쓴다.
// 예전에는 피드 순서대로 앞에서 잘라, 항목이 많은 소스와 아카이브를 통째로
// 내주는 피드가 하루치를 차지했다(2월·4월 글이 그렇게 발행됐다).
// 점수로 뽑으면 출처와 무관하게 좋은 후보가 이긴다.
function scoreEntry(entry, source) {
  // 최신성. 아카이브 글이 순서상 앞이라는 이유로 뽑히던 문제를 직접 겨냥한다.
  const ms = Date.parse(entry.publishedAt || "");
  const ageDays = Number.isFinite(ms) ? (Date.now() - ms) / 86400000 : null;
  const recency = ageDays == null ? 0.15 : Math.max(0, 1 - Math.max(0, ageDays) / 30);

  // 생성 재료. description이 짧으면 본문이 짧게 나와 body-too-short로 탈락한다
  // (실측 중앙값 403자, 최소 29자, 30건 중 14건이 이 사유로 걸렸다).
  const substance = Math.min(1, (entry.description || "").length / 600);

  // 수의 관련도. 통과/탈락 이분법 대신 매칭된 고유 용어 수로 깊이를 본다.
  const matched = new Set((`${entry.title} ${entry.description}`.match(VET_TERMS_GLOBAL) || []).map((x) => x.toLowerCase()));
  const relevance = Math.min(1, matched.size / 4);

  // canonical이 이미 잡힌 항목은 sourceStatus=verified가 될 가능성이 높다.
  const canonical = entry.canonicalUrl ? 1 : 0;

  // 레지스트리 priority(기본 50). 지금은 전 소스가 같지만, 매체별로 조정하면
  // 여기로 바로 반영된다.
  const trust = Math.min(1, (Number(source?.priority) || 50) / 100);

  return 0.40 * recency + 0.25 * substance + 0.20 * relevance + 0.10 * canonical + 0.05 * trust;
}
function rankedPick(entries, limit, perSource, sources) {
  const byId = new Map((sources || []).map((source) => [source.id, source]));
  const scored = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, byId.get(entry.sourceId)) }))
    .sort((a, b) => b.score - a.score);
  const cap = perSource > 0 ? perSource : Infinity;
  const counts = new Map();
  const picked = [];
  for (const { entry, score } of scored) {
    if (picked.length >= limit) break;
    const key = entry.sourceId || entry.sourceLabel || "unknown";
    const taken = counts.get(key) || 0;
    if (taken >= cap) continue;
    counts.set(key, taken + 1);
    picked.push({ ...entry, selectionScore: Number(score.toFixed(4)) });
  }
  return picked;
}
function loadSeen() {
  const set = new Set();
  for (const url of readJson(SEEN_PATH, { urls: [] }).urls || []) addSourceKeys(set, url);
  return set;
}
function saveSeen(seen) {
  // run.js와 동일한 보존 폭. 권역별 피드가 하루 수백 건을 공급해 좁게 잡으면
  // 며칠 전 기사가 다른 국가판을 통해 다시 들어온다.
  atomicWrite(SEEN_PATH, JSON.stringify({ urls: [...seen].slice(-20000) }, null, 2) + "\n");
}
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
    // 원문 본문이 있으면 그것을 쓰고, 없을 때만 RSS 요약문으로 물러선다.
    const content = entry.fullText || entry.description;
    const generated = await generateItem({ ...entry, sourceType: "rss", finalUrl: draft.sourceUrl, url: draft.sourceUrlRaw, fullText: content, body: content, sourceLabel: draft.sourceLabel, publishedAt: draft.sourcePublishedAt });
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
    relevance: relevance(entry), selectionScore: entry.selectionScore ?? null, generationRequested: Boolean(flags.generate),
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
// 생성기에 RSS 요약문만 넘기고 있었다(길이 중앙값 403자). 400자짜리 영문
// 티저로 500~800자 한국어 심층 기사를 요구하니 본문이 짧게 나오고, 짧으면
// brief 티어로 떨어져 색인 대상에서 빠졌다(미색인 350건 중 195건이 brief).
// run.js와 같이 원문 본문을 가져와 넘긴다. 소스별 rateLimit을 지킨다.
async function attachFullText(entries, sources, flags) {
  if (flags["no-fulltext"]) return entries;
  const lastRequest = new Map();
  const out = [];
  for (const entry of entries) {
    const url = entry.canonicalUrl || entry.url;
    if (!url || isRelayUrl(url)) { out.push(entry); continue; }
    const source = sources.find((candidate) => candidate.id === entry.sourceId);
    const rateLimitMs = Math.max(0, Number(source?.rateLimitMs) || 1000);
    const wait = rateLimitMs - (Date.now() - (lastRequest.get(entry.sourceId) || 0));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequest.set(entry.sourceId, Date.now());
    const meta = await fetchArticleMeta(url);
    // imageUrl도 함께 오지만 붙이지 않는다. 권리 확인 정보 없이 이미지를 달면
    // brief-publishing의 "대표 이미지 권리 확인 필요" 차단에 걸려 발행이 막힌다.
    out.push({ ...entry, fullText: meta.fullText || null });
  }
  return out;
}
async function collect(id, flags) {
  const sources = sourcesFor(id); const fetched = await sourceRows(sources, flags); const existing = allExisting();
  const entries = fetched.flatMap((row) => (row.result?.entries || []).map((entry) => ({ ...entry, sourceId: row.source.id, sourceLabel: row.source.label })));
  const deduped = dedupeFeedEntries(entries, existing);
  // 발행 여부와 무관하게 "한 번 초안으로 뽑은 원문"을 기억한다. 발행에 실패한
  // 후보를 매일 다시 생성하면 LLM 시간을 같은 기사에 계속 쓰게 된다.
  const seen = flags["ignore-seen"] ? new Set() : loadSeen();
  const relevant = deduped.filter((entry) => relevance(entry) === "relevant" && entry.duplicateStatus === "unique");
  const fresh = relevant.filter((entry) => !sourceKeys(entry).some((key) => seen.has(key)));
  let draftEntries = rankedPick(fresh, Math.max(1, Number(flags.max) || 50), Number(flags["per-source"]) || 0, sources);
  draftEntries = await confirmCanonicals(draftEntries, sources, flags);
  if (flags.generate) draftEntries = await attachFullText(draftEntries, sources, flags);
  const drafts = [];
  for (const entry of draftEntries) drafts.push(await generateDraft(draftFor(entry, sources.find((source) => source.id === entry.sourceId) || normalizeSource({ label: entry.sourceLabel }), flags), entry, flags));
  const generated = drafts.filter((draft) => draft.titleKo && draft.bodyKo?.length);
  // generate.js는 source-first 경로에서 본문 길이와 무관하게 analysis로 찍는다.
  // analysis는 본문 420자를 요구하므로(src/lib/quality.js) 짧은 글이 통째로
  // body-too-short로 탈락했다. 짧은 글은 사이트가 이미 쓰는 brief 티어로 낸다.
  for (const draft of generated) if (bodyCharCount(draft) < ANALYSIS_MIN_CHARS) draft.contentTier = "brief";
  // radar는 발행 게이트의 필수 항목인데 source-first 수집에는 채우는 단계가
  // 없었다(run.js만 enrich했다). 생성을 요청한 실행에서만 함께 채운다.
  if (flags.generate && generated.length) await enrichItems(generated);
  if (!flags.dry && drafts.length) {
    for (const draft of drafts) addSourceKeys(seen, draft.sourceUrl || draft.sourceUrlRaw || "");
    saveSeen(seen);
  }
  const report = {
    generatedAt: new Date().toISOString(), mode: flags.dry ? "dry-run" : "write-draft", sources: sources.map((source) => ({ id: source.id, label: source.label, feeds: feedUrls(source) })),
    feeds: fetched.map((row) => ({ sourceId: row.source.id, sourceLabel: row.source.label, url: row.url, itemCount: row.result?.entries?.length || 0, fromCache: row.result?.fromCache || false, error: row.error })),
    counts: { sources: sources.length, feeds: fetched.length, feedFailures: fetched.filter((row) => row.error).length, fetchedEntries: entries.length, unique: deduped.filter((entry) => entry.duplicateStatus === "unique").length, exactDuplicate: deduped.filter((entry) => entry.duplicateStatus === "exact-duplicate").length, updateOfExisting: deduped.filter((entry) => entry.duplicateStatus === "update-of-existing").length, excludedIrrelevant: deduped.filter((entry) => relevance(entry) === "excluded").length, relevantUnique: relevant.length, seenSkipped: relevant.length - fresh.length, freshAvailable: fresh.length, drafts: drafts.length, canonicalChecked: draftEntries.filter((entry) => entry.pageMetadata).length, verifiedCanonical: drafts.filter((draft) => draft.sourceStatus === "verified").length, unresolved: drafts.filter((draft) => draft.sourceStatus === "unresolved").length, relaySourceUrl: drafts.filter((draft) => RELAY.test(draft.sourceUrl || "")).length, draftSources: new Set(drafts.map((draft) => draft.sourceId)).size },
    sourceMix: Object.fromEntries(Object.entries(drafts.reduce((acc, draft) => { const key = draft.sourceLabel || draft.sourceId || "?"; acc[key] = (acc[key] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1])),
    selection: (() => { const s = drafts.map((d) => d.selectionScore).filter((x) => typeof x === "number").sort((a, b) => b - a); const ages = drafts.map((d) => Date.parse(d.sourcePublishedAt || "")).filter(Number.isFinite).map((ms) => Math.round((Date.now() - ms) / 86400000)).sort((a, b) => a - b); return { scoreTop: s[0] ?? null, scoreMedian: s.length ? s[Math.floor(s.length / 2)] : null, scoreMin: s.at(-1) ?? null, ageDaysMedian: ages.length ? ages[Math.floor(ages.length / 2)] : null, ageDaysMax: ages.at(-1) ?? null, within7Days: ages.filter((x) => x <= 7).length }; })(),
    drafts: drafts.map((draft) => ({ ...draft, title: draft.sourceTitle, publishedAt: draft.sourcePublishedAt, provenance: draft.generation })),
    updateCandidates: deduped.filter((entry) => entry.duplicateStatus === "update-of-existing").map((entry) => ({ id: entry.guid, title: entry.title, sourceId: entry.sourceId, sourceLabel: entry.sourceLabel, sourceStatus: sourceStatus(entry, sources.find((s) => s.id === entry.sourceId) || normalizeSource({ label: entry.sourceLabel })), sourceUrl: entry.canonicalUrl || entry.url, sourceUrlRaw: entry.url, publishedAt: entry.publishedAt, duplicateStatus: entry.duplicateStatus, sourceContentHash: sourceContentHash(`${entry.title}\n${entry.description}`) })),
    note: "수집 결과는 자동 published로 전환되지 않으며, 공식 canonical·중복·임상 검수 후에만 다음 단계로 이동할 수 있습니다.",
  };
  return { report, drafts };
}
function writeReport(report) {
  atomicWrite(REPORT_JSON, JSON.stringify(report, null, 2) + "\n");
  atomicWrite(REPORT_MD, `# Source-first 수집 보고서\n\n- 실행 시각: ${report.generatedAt}\n- 모드: ${report.mode}\n- 소스/피드: ${report.counts.sources}/${report.counts.feeds}\n- 수집 항목: ${report.counts.fetchedEntries}\n- 고유 후보: ${report.counts.unique}\n- exact duplicate: ${report.counts.exactDuplicate}\n- 기존 기사 업데이트 후보: ${report.counts.updateOfExisting}\n- 관련성 제외: ${report.counts.excludedIrrelevant}\n- 기수집(seen) 제외: ${report.counts.seenSkipped}\n- 신규 가용 후보: ${report.counts.freshAvailable}\n- draft 후보: ${report.counts.drafts}\n- canonical 확인 시도: ${report.counts.canonicalChecked}\n- 공식 canonical 확보: ${report.counts.verifiedCanonical}\n- unresolved source: ${report.counts.unresolved}\n- relay sourceUrl: ${report.counts.relaySourceUrl}\n\n## draft 후보\n\n${report.drafts.map((row) => `- ${row.id} · ${row.sourceId} · ${row.sourceStatus} · ${row.duplicateStatus} · ${row.title}`).join("\n") || "없음"}\n`);
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
