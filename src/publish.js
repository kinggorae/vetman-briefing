// 검수 완료된 draft를 발행 상태로 전환: node src/publish.js 2026-07-19
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
issue.status = "published";
issue.publishedAt = new Date().toISOString();

fs.writeFileSync(finalPath, JSON.stringify(issue, null, 2));
fs.unlinkSync(draftPath);
console.log(`발행 완료: ${finalPath}`);
console.log("npm run build 로 사이트를 다시 빌드하세요.");
