import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { articleContractIssues, requiredReviewRole, workflowReviewIssues } from "../src/lib/editorial-operations.js";
import { inferClinicalRisk } from "../src/lib/editorial-review.js";
import { readJson, atomicWrite } from "../src/lib/source-first.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const REPORT_JSON = path.join(ROOT, "reports", "daily-edition.json");
const REPORT_MD = path.join(ROOT, "reports", "daily-edition.md");
const LOG = path.join(ROOT, "data", "editorial", "schedule.jsonl");

function args() {
  const raw = process.argv.slice(2); const command = raw.shift() || "plan";
  const positional = raw.filter((x) => !x.startsWith("--"));
  const flags = Object.fromEntries(raw.filter((x) => x.startsWith("--")).map((x) => { const [key, ...rest] = x.slice(2).split("="); return [key, rest.length ? rest.join("=") : true]; }));
  return { command, positional, flags };
}
function rows() {
  const result = [];
  if (!fs.existsSync(ISSUES)) return result;
  for (const file of fs.readdirSync(ISSUES).filter((name) => /^\d{4}-\d{2}-\d{2}(?:\.draft)?\.json$/.test(name))) {
    const issue = readJson(path.join(ISSUES, file), {});
    for (const [index, item] of (issue.items || []).entries()) result.push({ file, index, item, date: issue.date, id: item.id || `${issue.date}_${index + 1}` });
  }
  return result;
}
function score(item) {
  const risk = item.clinicalRisk || inferClinicalRisk(item);
  const tier = item.contentTier || "brief";
  return (risk === "high" ? 40 : risk === "medium" ? 25 : 10) + (tier === "evidence" ? 15 : tier === "analysis" ? 10 : 0) + (item.sourceStatus === "verified" ? 10 : 0) + (item.firstPublishedAt ? 0 : 5);
}
function eligible(row) {
  const item = row.item; const risk = item.clinicalRisk || inferClinicalRisk(item); const status = item.workflowStatus || "draft";
  if (! ["approved", "published"].includes(status)) return false;
  if (workflowReviewIssues({ ...item, clinicalRisk: risk }).length) return false;
  if (risk === "high" && !item.vetReviewedAt) return false;
  if (risk === "medium" && !item.reviewedAt && !item.vetReviewedAt) return false;
  return articleContractIssues({ ...item, publishedAt: item.publishedAt || "scheduled" }).filter((issue) => !["publishedAt-missing", "workflowStatus-missing"].includes(issue)).length === 0;
}
function plan(date) {
  const candidates = rows().filter(eligible).sort((a, b) => score(b.item) - score(a.item) || String(b.date).localeCompare(String(a.date)));
  const max = 8; const selected = candidates.slice(0, max); const groups = { analysis: [], evidence: [], brief: [], other: [] };
  for (const row of selected) (groups[row.item.contentTier] || groups.other).push({ id: row.id, title: row.item.titleKo, category: row.item.category || "other", score: score(row.item), risk: row.item.clinicalRisk || inferClinicalRisk(row), scheduledAt: row.item.scheduledAt || null });
  const report = { generatedAt: new Date().toISOString(), date: date || new Date().toISOString().slice(0, 10), limits: { indexAnalysisPerDay: max, briefSeparate: true }, selected: selected.map((row) => ({ id: row.id, title: row.item.titleKo, category: row.item.category || "other", contentTier: row.item.contentTier || "brief", clinicalRisk: row.item.clinicalRisk || inferClinicalRisk(row.item), score: score(row.item) })), groups, excluded: rows().filter((row) => !eligible(row)).length, note: "편성 제안이며 자동 발행하지 않습니다. 발행 전 승인·임상 검수 상태를 다시 확인하세요." };
  atomicWrite(REPORT_JSON, JSON.stringify(report, null, 2) + "\n");
  atomicWrite(REPORT_MD, `# 일일 브리핑 편성 제안\n\n- 기준일: ${report.date}\n- 후보: ${report.selected.length}건\n- 자동 제외: ${report.excluded}건\n\n${report.selected.map((row, i) => `${i + 1}. ${row.title} · ${row.contentTier} · ${row.clinicalRisk} · ${row.category} · 점수 ${row.score}`).join("\n") || "승인된 편성 후보가 없습니다."}\n\n> 이 보고서는 자동 발행을 수행하지 않습니다.\n`);
  console.log(JSON.stringify({ date: report.date, selected: report.selected.length, excluded: report.excluded, groups }, null, 2));
}
function find(id) { const row = rows().find((candidate) => candidate.id === id); if (!row) throw new Error(`기사를 찾을 수 없습니다: ${id}`); return row; }
function log(event) { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, `${JSON.stringify({ ...event, eventId: crypto.randomUUID(), at: new Date().toISOString() })}\n`); }
function setSchedule(id, scheduledAt, flags) {
  const row = find(id); const when = new Date(scheduledAt); if (Number.isNaN(when.getTime())) throw new Error("유효한 scheduledAt ISO 시각이 필요합니다."); if (!eligible(row)) throw new Error("approved 상태와 위험도별 검수 조건을 통과한 기사만 예약할 수 있습니다.");
  const plan = { id, scheduledAt: when.toISOString(), previousScheduledAt: row.item.scheduledAt || null, apply: Boolean(flags.apply) };
  console.log(JSON.stringify(plan, null, 2)); if (!flags.apply) { console.log("dry-run: --apply 없이는 예약을 저장하지 않습니다."); return; }
  const issue = readJson(path.join(ISSUES, row.file), null); issue.items[row.index] = { ...row.item, scheduledAt: when.toISOString() }; atomicWrite(path.join(ISSUES, row.file), JSON.stringify(issue, null, 2) + "\n"); log({ action: "schedule", articleId: id, previousScheduledAt: row.item.scheduledAt || null, scheduledAt: when.toISOString() });
}
function cancel(id, flags) {
  const row = find(id); const plan = { id, previousScheduledAt: row.item.scheduledAt || null, apply: Boolean(flags.apply) }; console.log(JSON.stringify(plan, null, 2)); if (!flags.apply) { console.log("dry-run: --apply 없이는 예약을 취소하지 않습니다."); return; }
  const issue = readJson(path.join(ISSUES, row.file), null); issue.items[row.index] = { ...row.item, scheduledAt: null }; atomicWrite(path.join(ISSUES, row.file), JSON.stringify(issue, null, 2) + "\n"); log({ action: "cancel", articleId: id, previousScheduledAt: row.item.scheduledAt || null });
}
const { command, positional, flags } = args();
try { if (command === "plan") plan(positional[0]); else if (command === "set") setSchedule(positional[0], positional[1], flags); else if (command === "cancel") cancel(positional[0], flags); else throw new Error("사용법: plan [YYYY-MM-DD] | set ARTICLE_ID ISO_TIME [--apply] | cancel ARTICLE_ID [--apply]"); } catch (error) { console.error(error.message); process.exit(1); }
