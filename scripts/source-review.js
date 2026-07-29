// 사람의 승인 없이 sourceUrl을 바꾸지 않는 검수 CLI.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPORT = path.join(ROOT, "reports", "source-resolution.json");
const DECISIONS = path.join(ROOT, "data", "source-resolution-decisions.json");
const args = process.argv.slice(2);
const report = await fs.readFile(REPORT, "utf8").then(JSON.parse).catch(() => null);
if (!report) { console.error("먼저 npm run source:resolve -- --dry-run 을 실행하세요."); process.exit(1); }
const decisions = await fs.readFile(DECISIONS, "utf8").then(JSON.parse).catch(() => ({}));
const approveAt = args.indexOf("--approve"); const rejectAt = args.indexOf("--reject");
if (approveAt >= 0 || rejectAt >= 0) {
  const id = args[approveAt >= 0 ? approveAt + 1 : rejectAt + 1]; const url = approveAt >= 0 ? args[approveAt + 2] : null;
  if (!id || (approveAt >= 0 && !/^https:\/\//i.test(url || ""))) { console.error("사용법: --approve ARTICLE_ID https://공식-기사-URL 또는 --reject ARTICLE_ID"); process.exit(1); }
  decisions[id] = { status: approveAt >= 0 ? "manually-approved" : "rejected", ...(url ? { url } : {}), decidedAt: new Date().toISOString() };
  await fs.writeFile(DECISIONS, JSON.stringify(decisions, null, 2) + "\n");
  console.log(`${id}: ${decisions[id].status} 결정 저장`); process.exit(0);
}
const queue = report.rows.filter((row) => ["candidate", "unresolved", "rejected"].includes(row.status));
console.log(`수동 검수 큐 ${queue.length}개 / 전체 ${report.totalRelayArticles}개`);
for (const row of queue) console.log(`${row.articleId}\t${row.status}\t${row.sourceLabel || "출처 미상"}\t${row.titleKo || ""}\t${row.candidates?.[0]?.url || "후보 없음"}`);
