import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncAdminStatus } from "../src/lib/admin-status-sync.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = path.join(ROOT, "site");
const REPORTS = path.join(ROOT, "reports");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function atomicWrite(file, value) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, file);
}

const adminFile = path.join(SITE, "admin-review.json");
const next = syncAdminStatus(
  readJson(adminFile),
  readJson(path.join(REPORTS, "operations-status.json")),
  readJson(path.join(REPORTS, "image-rights-queue.json")),
  readJson(path.join(REPORTS, "newsroom-work-queue.json"), { version: 1, generatedAt: new Date().toISOString(), count: 0, open: 0, rows: [], next: [], counts: { byType: {}, byPriority: { critical: 0, high: 0, normal: 0 } } }),
);
atomicWrite(adminFile, JSON.stringify(next, null, 2) + "\n");
console.log(`관리자 상태 동기화: 운영 현황 ${next.operationsStatus.generatedAt} · 이미지 권리 큐 ${next.imageRightsQueue.generatedAt} · 통합 큐 ${next.workQueue.generatedAt}`);
