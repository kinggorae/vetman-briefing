import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSourceUrl, sourceKeys } from "./identity.js";
import { publishQualityIssues } from "./quality.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, "data", "issues");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function loadFiles() {
  return fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().reverse()
    : [];
}

function markSuppressed(item, reasons, at) {
  item.visibility = "suppressed";
  item.suppressedReason = [...new Set(reasons)];
  item.suppressedAt = at;
}

function main() {
  const apply = process.argv.includes("--apply");
  const reportPath = argValue("--report", path.join("/tmp", "vetman-publication-repair.json"));
  const files = loadFiles();
  if (!files.length) throw new Error("data/issues에 발행 이슈가 없습니다.");

  const seen = new Map();
  const changes = [];
  const flagCounts = new Map();
  const duplicateKeys = new Map();
  const appliedAt = new Date().toISOString();

  // 최신 파일부터 읽는다. 정상 항목을 먼저 보존하고, 더 오래된 중복·불량 항목만 숨긴다.
  for (const file of files) {
    const fullPath = path.join(DATA_DIR, file);
    const issue = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    let changed = false;
    for (const [index, item] of (issue.items || []).entries()) {
      if (item.visibility === "suppressed") continue;

      const keys = sourceKeys(item);
      const blockers = publishQualityIssues(item);
      const duplicateWith = keys.map((key) => seen.get(key)).filter(Boolean);
      const reasons = [...blockers];
      if (duplicateWith.length) reasons.push("duplicate-source");

      for (const flag of blockers) flagCounts.set(flag, (flagCounts.get(flag) || 0) + 1);
      if (duplicateWith.length) {
        for (const key of keys) {
          if (seen.has(key)) duplicateKeys.set(key, { current: `${file}#${index + 1}`, kept: seen.get(key) });
        }
      }

      if (reasons.length) {
        changes.push({
          file,
          index: index + 1,
          id: item.id || null,
          title: item.titleKo || "",
          reasons: [...new Set(reasons)],
          keptDuplicate: duplicateWith[0] || null,
        });
        if (apply) {
          markSuppressed(item, reasons, appliedAt);
          changed = true;
        }
        // 품질이 나쁜 최신본은 source key를 점유하지 않는다. 같은 원문의
        // 이전 정상본이 남아 있으면 그것을 공개본으로 보존할 수 있다.
        continue;
      }

      for (const key of keys) seen.set(key, `${file}#${index + 1}`);
    }
    if (apply && changed) fs.writeFileSync(fullPath, JSON.stringify(issue, null, 2));
  }

  const report = {
    generatedAt: appliedAt,
    mode: apply ? "apply" : "dry-run",
    files,
    changedCount: changes.length,
    byReason: Object.fromEntries([...flagCounts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    duplicateSourceCount: duplicateKeys.size,
    changes,
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const duplicateCount = changes.filter((change) => change.reasons.includes("duplicate-source")).length;
  const qualityCount = changes.filter((change) => change.reasons.some((reason) => reason !== "duplicate-source")).length;
  console.log(`${apply ? "발행 데이터 정리 완료" : "발행 데이터 정리 미리보기"}: ${changes.length}건`);
  console.log(`  중복 원문 억제: ${duplicateCount}건`);
  console.log(`  품질 차단 억제: ${qualityCount}건`);
  console.log(`  리포트: ${reportPath}`);
  if (!apply && changes.length) console.log("  적용하려면: node src/repair-publication.js --apply");
}

main();
