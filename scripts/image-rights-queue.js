import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildImageRightsQueue, imageRightsQueueMarkdown, validImageDecision } from "../src/lib/image-rights-queue.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const DATA = path.join(ROOT, "data", "image-rights-decisions.json");
const REPORTS = path.join(ROOT, "reports");
function readJson(file, fallback = null) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function atomic(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`; fs.writeFileSync(temp, value); fs.renameSync(temp, file); }
function issueRows() { return fs.readdirSync(ISSUES).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().flatMap((file) => { const issue = readJson(path.join(ISSUES, file), {}); return (issue.items || []).map((item, index) => ({ item, file, index })); }); }
function args() { const raw = process.argv.slice(2); const command = raw.shift() || "queue"; const flags = Object.fromEntries(raw.filter((x) => x.startsWith("--")).map((x) => { const [key, ...value] = x.slice(2).split("="); return [key, value.length ? value.join("=") : true]; })); return { command, flags }; }
function saveDecision(id, flags) {
  const decisions = readJson(DATA, {});
  const decision = flags.status === "rejected"
    ? { status: "rejected", reason: String(flags.reason || "").trim(), decidedAt: new Date().toISOString() }
    : { status: "approved", ownership: flags.ownership, credit: flags.credit || null, license: flags.license || null, licenseUrl: flags["license-url"] || null, sourceUrl: flags["source-url"] || null, decidedAt: new Date().toISOString() };
  if (!validImageDecision(decision)) throw new Error("승인에는 --ownership와 권리 근거가 필요합니다. 반려에는 --reason이 필요합니다.");
  decisions[id] = decision;
  atomic(DATA, JSON.stringify(decisions, null, 2) + "\n");
  console.log(`${id}: ${decision.status} 결정 저장`);
}
const { command, flags } = args();
try {
  if ((command === "approve" || command === "reject") && flags.id) {
    saveDecision(flags.id, { ...flags, status: command === "approve" ? "approved" : "rejected" });
  } else if (command === "queue") {
    const search = readJson(path.join(ROOT, "site", "search.json"), { items: [] });
    const rows = buildImageRightsQueue({ articles: issueRows(), indexIds: (search.items || []).map((item) => item.id), decisions: readJson(DATA, {}) });
    const report = { version: 1, generatedAt: new Date().toISOString(), count: rows.length, rows };
    atomic(path.join(REPORTS, "image-rights-queue.json"), JSON.stringify(report, null, 2) + "\n");
    atomic(path.join(REPORTS, "image-rights-queue.md"), imageRightsQueueMarkdown(rows));
    console.log(`이미지 권리 큐: ${rows.length}건 · index 우선 ${rows.filter((row) => row.indexable && row.status === "pending").length}건`);
  } else throw new Error("사용법: queue 또는 approve|reject --id=<기사ID> [--ownership=licensed --license=...]");
} catch (error) { console.error(error.message); process.exit(1); }
