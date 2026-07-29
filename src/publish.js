// 검수 완료된 draft를 발행 상태로 전환: node src/publish.js 2026-07-19
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { articleContractIssues } from "./lib/editorial-operations.js";
import { publishQualityIssues } from "./quality.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const week = process.argv[2];

if (!week) {
  console.error("사용법: node src/publish.js <날짜>  (예: node src/publish.js 2026-07-19)");
  process.exit(1);
}

const draftPath = path.join(ROOT, "data", "issues", `${week}.draft.json`);
const finalPath = path.join(ROOT, "data", "issues", `${week}.json`);

if (!fs.existsSync(draftPath)) {
  console.error(`draft가 없습니다: ${draftPath}`);
  process.exit(1);
}

const issue = JSON.parse(fs.readFileSync(draftPath, "utf8"));
const blockers = [];
for (const [index, item] of (issue.items || []).entries()) {
  const contract = articleContractIssues(item).filter((issueName) => !["workflowStatus-missing", "publishedAt-missing"].includes(issueName));
  const quality = publishQualityIssues(item);
  if (item.workflowStatus !== "approved") blockers.push(`${index + 1}: workflowStatus=${item.workflowStatus || "missing"} (approved 필요)`);
  if (contract.length) blockers.push(`${index + 1}: 계약 위반 ${contract.join(", ")}`);
  if (quality.length) blockers.push(`${index + 1}: 품질 게이트 ${quality.join(", ")}`);
  if (item.scheduledAt && !Number.isNaN(new Date(item.scheduledAt).getTime()) && new Date(item.scheduledAt).getTime() > Date.now()) blockers.push(`${index + 1}: scheduledAt이 미래입니다 (${item.scheduledAt})`);
}
if (blockers.length) {
  console.error("발행이 차단되었습니다. review CLI로 승인한 뒤 다시 시도하세요.");
  console.error(blockers.join("\n"));
  process.exit(1);
}
issue.status = "published";
const publishedNow = new Date().toISOString();
issue.publishedAt = issue.publishedAt || publishedNow;
issue.items = (issue.items || []).map((item) => ({
  ...item,
  workflowStatus: "published",
  firstPublishedAt: item.firstPublishedAt || item.publishedAt || publishedNow,
  publishedAt: item.publishedAt || publishedNow,
}));

const tempPath = `${finalPath}.tmp-${process.pid}`;
fs.writeFileSync(tempPath, JSON.stringify(issue, null, 2) + "\n");
fs.renameSync(tempPath, finalPath);
fs.unlinkSync(draftPath);
console.log(`발행 완료: ${finalPath}`);
console.log("npm run build 로 사이트를 다시 빌드하세요.");
