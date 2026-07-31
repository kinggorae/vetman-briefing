import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  CHECKLIST_KEYS,
  contentHash,
  isNewWorkflowItem,
  normalizeWorkflowStatus,
  requiredReviewRole,
  reviewPriority,
  sourceHash,
  workflowLabel,
} from "../src/lib/editorial-operations.js";
import { inferClinicalRisk } from "../src/lib/editorial-review.js";
import { articleContractIssues } from "../src/lib/editorial-operations.js";
import { normalizeContentTier } from "../src/lib/quality.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const PEOPLE_PATH = path.join(ROOT, "data", "editorial", "people.json");
const REVIEWS_PATH = path.join(ROOT, "data", "editorial", "reviews.jsonl");
const REPORTS = path.join(ROOT, "reports");
const INDEX_IDS = new Set((readJson(path.join(ROOT, "site", "search.json"), { items: [] }).items || []).map((item) => item.id).filter(Boolean));

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function issueFiles() { return fs.existsSync(ISSUES) ? fs.readdirSync(ISSUES).filter((file) => /^\d{4}-\d{2}-\d{2}(?:\.draft)?\.json$/.test(file)).sort() : []; }
function loadArticles() {
  const rows = [];
  for (const file of issueFiles()) {
    const issue = readJson(path.join(ISSUES, file), null);
    if (!issue || !Array.isArray(issue.items)) continue;
    issue.items.forEach((item, index) => rows.push({ item, file, index, date: issue.date || file.slice(0, 10), published: issue.status === "published" && !file.endsWith(".draft.json") }));
  }
  return rows;
}
function articleId(row) { return row.item.id || `${row.date}_${row.index + 1}`; }
function findArticle(id) { return loadArticles().find((row) => articleId(row) === id); }
function people() { const value = readJson(PEOPLE_PATH, { people: [] }); return Array.isArray(value) ? value : value.people || []; }
function reviews() {
  if (!fs.existsSync(REVIEWS_PATH)) return [];
  return fs.readFileSync(REVIEWS_PATH, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}
function latestReviews() { const map = new Map(); for (const row of reviews()) map.set(row.articleId, row); return map; }
function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, file);
}
function args() {
  const raw = process.argv.slice(2);
  const command = raw.shift() || "stats";
  const positional = raw.filter((x) => !x.startsWith("--"));
  const flags = Object.fromEntries(raw.filter((x) => x.startsWith("--")).map((x) => {
    const [key, ...rest] = x.slice(2).split("=");
    return [key, rest.length ? rest.join("=") : true];
  }));
  return { command, positional, flags };
}
function publicStatus(item, row) { return item.workflowStatus || (row.published ? "legacy-published" : "draft"); }
function snapshot(item) { return { contentHash: contentHash(item), sourceHash: sourceHash(item) }; }
function reviewState(row, latest) {
  const item = row.item;
  const status = publicStatus(item, row);
  const hashes = snapshot(item);
  const last = latest.get(articleId(row));
  return {
    id: articleId(row), date: row.date, file: `data/issues/${row.file}`, title: item.titleKo || "",
    indexable: INDEX_IDS.has(articleId(row)),
    sourceLabel: item.sourceLabel || "", sourceUrl: item.sourceUrl || null, sourceUrlRaw: item.sourceUrlRaw || null,
    contentTier: normalizeContentTier(item), clinicalRisk: item.clinicalRisk || inferClinicalRisk(item),
    workflowStatus: status, workflowLabel: workflowLabel(status), priority: reviewPriority({ ...item, clinicalRisk: item.clinicalRisk || inferClinicalRisk(item), workflowStatus: status }, { legacyIndex: status === "legacy-published" }),
    contractIssues: isNewWorkflowItem(item) ? articleContractIssues(item) : [],
    contentHash: hashes.contentHash, sourceHash: hashes.sourceHash,
    reReviewRequired: Boolean(last && last.contentHash && last.contentHash !== hashes.contentHash),
    latestReview: last || null,
  };
}
function writeReport(name, value, markdown) {
  fs.mkdirSync(REPORTS, { recursive: true });
  atomicWrite(path.join(REPORTS, `${name}.json`), JSON.stringify(value, null, 2) + "\n");
  atomicWrite(path.join(REPORTS, `${name}.md`), markdown);
}
function checklist(flags) {
  if (flags.checklist === "all" || flags.checklist === true) return Object.fromEntries(CHECKLIST_KEYS.map((key) => [key, true]));
  const selected = String(flags.checklist || "").split(",").map((x) => x.trim()).filter(Boolean);
  return Object.fromEntries(CHECKLIST_KEYS.map((key) => [key, selected.includes(key)]));
}
function personFor(id) { return people().find((person) => person.id === id || person.slug === id) || null; }
function reviewBlockers(row, reviewer, list) {
  const item = row.item;
  const role = requiredReviewRole({ ...item, clinicalRisk: item.clinicalRisk || inferClinicalRisk(item) });
  const blockers = [];
  if (!reviewer) blockers.push("등록된 reviewerId가 필요합니다");
  if (reviewer && !["admin", role].includes(reviewer.role)) blockers.push(`${role} 역할 reviewerId가 필요합니다`);
  if (!item.sourceUrl || /^https?:\/\/(?:news\.)?google\./i.test(item.sourceUrl)) blockers.push("확인된 직접 원출처 URL이 필요합니다");
  if (!list.sourceConfirmed) blockers.push("sourceConfirmed 체크가 필요합니다");
  if (!list.titleLeadBodyChecked || !list.numbersChecked || !list.speciesAndStudyChecked || !list.limitationsChecked || !list.clinicalLanguageChecked) blockers.push("전체 편집·임상 체크리스트가 필요합니다");
  if (item.workflowStatus === "correction-required") blockers.push("correction-required 상태는 먼저 수정해야 합니다");
  if (role === "vet" && reviewer && !["vet", "admin"].includes(reviewer.role)) blockers.push("high/임상 행동 권고는 vet 역할이 필요합니다");
  return blockers;
}
function appendReview(entry) {
  fs.mkdirSync(path.dirname(REVIEWS_PATH), { recursive: true });
  fs.appendFileSync(REVIEWS_PATH, `${JSON.stringify(entry)}\n`);
}
function printRows(rows) { console.log(rows.map((row) => `${row.priority}\t${row.id}\t${row.workflowStatus}\t${row.clinicalRisk}\t${row.title}`).join("\n")); }

function stats() {
  const latest = latestReviews();
  const rows = loadArticles().map((row) => reviewState(row, latest));
  const by = (key) => Object.fromEntries([...new Set(rows.map((row) => row[key]))].sort().map((value) => [value || "unclassified", rows.filter((row) => row[key] === value).length]));
  const queue = rows.filter((row) => ["legacy-published", "draft", "automated", "editor-review-required", "vet-review-required", "correction-required"].includes(row.workflowStatus) || row.reReviewRequired);
  const report = { generatedAt: new Date().toISOString(), total: rows.length, status: by("workflowStatus"), clinicalRisk: by("clinicalRisk"), contentTier: by("contentTier"), queue: queue.length, indexable: rows.filter((row) => row.indexable).length, highRiskIndexWaiting: rows.filter((row) => row.indexable && row.clinicalRisk === "high" && row.workflowStatus === "legacy-published").length, mediumRiskIndexWaiting: rows.filter((row) => row.indexable && row.clinicalRisk === "medium" && row.workflowStatus === "legacy-published").length, reReviewRequired: rows.filter((row) => row.reReviewRequired).length };
  writeReport("review-stats", report, `# 편집 검수 통계\n\n- 전체 기사: ${report.total}\n- 검수 큐: ${report.queue}\n- 기존 high 위험 검수 대기: ${report.highRiskIndexWaiting}\n- 기존 medium 위험 검수 대기: ${report.mediumRiskIndexWaiting}\n- 수정 후 재검수: ${report.reReviewRequired}\n\n## 상태\n\n${Object.entries(report.status).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`);
  console.log(JSON.stringify(report, null, 2));
}
function next() {
  const rows = loadArticles().map((row) => reviewState(row, latestReviews())).filter((row) => ["legacy-published", "draft", "automated", "editor-review-required", "vet-review-required", "correction-required"].includes(row.workflowStatus) || row.reReviewRequired).sort((a, b) => b.priority - a.priority || String(b.date).localeCompare(String(a.date))).slice(0, 100);
  writeReport("review-queue", { generatedAt: new Date().toISOString(), count: rows.length, rows }, `# 검수 큐\n\n${rows.map((row) => `- ${row.priority} · ${row.id} · ${row.workflowStatus} · ${row.title}`).join("\n")}\n`);
  printRows(rows.slice(0, 20));
}
function show(id) {
  const row = findArticle(id); if (!row) throw new Error(`기사를 찾을 수 없습니다: ${id}`);
  console.log(JSON.stringify(reviewState(row, latestReviews()), null, 2));
}
function transition(command, id, flags) {
  const row = findArticle(id); if (!row) throw new Error(`기사를 찾을 수 없습니다: ${id}`);
  const reviewerId = flags["reviewer-id"] || flags.reviewerId;
  const reviewer = personFor(reviewerId);
  const list = checklist(flags);
  const item = row.item;
  const oldStatus = publicStatus(item, row);
  const hashes = snapshot(item);
  let newStatus = command === "approve" ? "approved" : command === "request-vet" ? "vet-review-required" : "correction-required";
  if (command === "approve") {
    const blockers = reviewBlockers(row, reviewer, list);
    if (blockers.length) throw new Error(`승인 차단:\n- ${blockers.join("\n- ")}`);
  }
  const plan = { id, file: row.file, previousStatus: oldStatus, newStatus, reviewerId: reviewerId || null, reviewerRole: reviewer?.role || null, checklist: list, contentHash: hashes.contentHash, sourceHash: hashes.sourceHash, notes: flags.notes || flags.reason || null, apply: Boolean(flags.apply) };
  console.log(JSON.stringify(plan, null, 2));
  if (!flags.apply) { console.log("dry-run: --apply를 붙여야 파일과 감사 로그를 변경합니다."); return; }
  if (!reviewer) throw new Error("--reviewer-id와 등록된 사람 프로필이 필요합니다");
  const updated = { ...item, workflowStatus: newStatus, dataSchemaVersion: Number(item.dataSchemaVersion) || 2, reviewPolicyVersion: item.reviewPolicyVersion || "2026-07-30", reviewChecklist: list, reviewNotes: flags.notes || flags.reason || null };
  if (command === "approve") {
    updated.editorialStatus = reviewer.role === "vet" ? "vet-reviewed" : "editor-reviewed";
    updated.reviewerId = reviewer.id;
    updated.reviewerRole = reviewer.role;
    updated.reviewedBy = reviewer.name;
    updated.reviewedAt = new Date().toISOString();
    if (reviewer.role === "vet") { updated.vetReviewerId = reviewer.id; updated.vetReviewer = reviewer.name; updated.vetReviewedAt = updated.reviewedAt; }
    updated.contentHash = hashes.contentHash;
    updated.sourceHash = hashes.sourceHash;
    // public-brief는 "감수자 없이 나간 글이니 색인하지 말라"는 표시다. 사람이
    // 검수해 승인한 순간 그 전제가 사라지므로 도장을 푼다. 다만 brief 티어는
    // 짧은 요약이라 검수 여부와 무관하게 색인 대상이 아니므로 그대로 둔다.
    const tier = normalizeContentTier(updated);
    if (updated.publicationStatus === "public-brief" && (tier === "analysis" || tier === "evidence")) {
      delete updated.publicationStatus;
      console.log("  public-brief 해제 — 검수 완료로 색인 대상이 됩니다");
    }
  }
  if (command === "request-vet") updated.editorialStatus = "editor-review-required";
  if (command === "reject" || command === "correct") { updated.editorialStatus = "correction-required"; updated.correctionNote = flags.reason || flags.notes || "편집 검수에서 수정이 필요합니다."; }
  const issue = readJson(path.join(ISSUES, row.file), null);
  issue.items[row.index] = updated;
  atomicWrite(path.join(ISSUES, row.file), JSON.stringify(issue, null, 2) + "\n");
  appendReview({ articleId: id, reviewerId: reviewer.id, reviewerRole: reviewer.role, reviewedAt: new Date().toISOString(), reviewChecklist: list, reviewNotes: plan.notes, previousStatus: oldStatus, newStatus, contentHash: hashes.contentHash, sourceHash: hashes.sourceHash });
  console.log(`적용 완료: ${row.file}#${row.index + 1}`);
}
function exportQueue() {
  const rows = loadArticles().map((row) => reviewState(row, latestReviews())).sort((a, b) => b.priority - a.priority);
  writeReport("review-export", { generatedAt: new Date().toISOString(), rows }, ["id","date","title","workflowStatus","clinicalRisk","priority","file","sourceUrl"].join(",") + "\n" + rows.map((row) => [row.id,row.date,row.title,row.workflowStatus,row.clinicalRisk,row.priority,row.file,row.sourceUrl || ""].map((v) => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n") + "\n");
  console.log(`검수 큐 내보내기 완료: reports/review-export.json, reports/review-export.md`);
}

const { command, positional, flags } = args();
try {
  if (command === "stats") stats();
  else if (command === "next") next();
  else if (command === "show") show(positional[0]);
  else if (command === "approve") transition("approve", positional[0], flags);
  else if (command === "reject") transition("reject", positional[0], flags);
  else if (command === "request-vet") transition("request-vet", positional[0], flags);
  else if (command === "correct") transition("correct", positional[0], flags);
  else if (command === "export") exportQueue();
  else throw new Error(`알 수 없는 review 명령: ${command}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
