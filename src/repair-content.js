// 기존 발행본에 남아 있는 확실한 번역 잔여물을 일괄 교정한다.
// 기본은 미리보기만 하고, 실제 파일 변경은 --write를 명시했을 때만 한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { koreanizeItem } from "./koreanize.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, "data", "issues");
const write = process.argv.includes("--write");
const files = fs.readdirSync(DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
let changedItems = 0;
let changedFiles = 0;

for (const name of files) {
  const file = path.join(DIR, name);
  const issue = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = false;
  for (const item of issue.items || []) {
    const before = JSON.stringify(item);
    const fields = koreanizeItem(item);
    if (JSON.stringify(item) !== before) {
      changed = true;
      changedItems++;
      if (changedItems <= 12) console.log(`${name}: ${item.titleKo} (${fields}개 필드)`);
    }
  }
  if (changed) {
    changedFiles++;
    if (write) fs.writeFileSync(file, JSON.stringify(issue, null, 2) + "\n");
  }
}

console.log(`${write ? "교정 완료" : "교정 미리보기"}: ${changedFiles}개 파일 / ${changedItems}개 아이템`);
if (!write && changedItems) console.log("실제 반영: node src/repair-content.js --write");
