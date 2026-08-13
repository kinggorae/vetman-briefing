import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildNewsroomWorkQueue, newsroomWorkQueueMarkdown } from "../src/lib/newsroom-work-queue.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPORTS = path.join(ROOT, "reports");

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, file);
}

const admin = readJson(path.join(ROOT, "site", "admin-review.json"), { rows: [] });
const report = buildNewsroomWorkQueue({
  sourceResolution: readJson(path.join(REPORTS, "source-resolution.json"), { rows: [] }),
  imageRightsQueue: readJson(path.join(REPORTS, "image-rights-queue.json"), { rows: [] }),
  reviewRows: admin.rows || [],
  sourceHealth: readJson(path.join(REPORTS, "source-health.json"), { feeds: [] }),
  newsroom: readJson(path.join(REPORTS, "draft-newsroom.json"), { drafts: [] }),
  productionMonitor: readJson(path.join(REPORTS, "production-monitoring.json"), { critical: [], warnings: [] }),
});
atomicWrite(path.join(REPORTS, "newsroom-work-queue.json"), JSON.stringify(report, null, 2) + "\n");
atomicWrite(path.join(REPORTS, "newsroom-work-queue.md"), newsroomWorkQueueMarkdown(report));
console.log(`뉴스룸 통합 작업 큐: ${report.count}건 · critical ${report.counts.byPriority.critical} · high ${report.counts.byPriority.high}`);
