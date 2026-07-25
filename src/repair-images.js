// 기존 발행 데이터의 대표 이미지 일괄 정리.
// 사용: node src/repair-images.js [--dry-run]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { removeRepeatedImages } from "./images.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES_DIR = path.join(ROOT, "data", "issues");
const dryRun = process.argv.includes("--dry-run");
let filesChanged = 0;
let changedItems = 0;
let removedImages = 0;

for (const file of fs.readdirSync(ISSUES_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort()) {
  const filePath = path.join(ISSUES_DIR, file);
  const issue = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const before = issue.items.map((item) => item.imageUrl || null);
  const removed = removeRepeatedImages(issue.items);
  const changed = issue.items.filter((item, i) => (item.imageUrl || null) !== before[i]).length;
  if (!changed) continue;
  filesChanged++;
  changedItems += changed;
  removedImages += removed;
  console.log(`${dryRun ? "예정" : "수정"} ${file}: ${changed}건 · 공통 이미지 제거 ${removed}건`);
  if (!dryRun) fs.writeFileSync(filePath, JSON.stringify(issue, null, 2) + "\n");
}

console.log(`이미지 일괄 정리 ${dryRun ? "예상" : "완료"}: 파일 ${filesChanged}개 · 항목 ${changedItems}건 · 공통 이미지 제거 ${removedImages}건`);
