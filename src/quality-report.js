import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSourceUrl, sourceKeys } from "./identity.js";
import { normalizeContentTier, publishQualityIssues, qualityIssues } from "./quality.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, "data", "issues");

function argValue(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function increment(map, key) {
  if (!key) return;
  map[key] = (map[key] || 0) + 1;
}

function files() {
  return fs.existsSync(DATA_DIR)
    ? fs.readdirSync(DATA_DIR).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().reverse()
    : [];
}

function main() {
  const issueFiles = files();
  const byFlag = {};
  const byDate = {};
  const byCategory = {};
  const byTier = {};
  const byMarket = {};
  const sourceSeen = new Map();
  const duplicateSources = [];
  let rawItemCount = 0;
  let publicItemCount = 0;
  let suppressedCount = 0;
  let withImageCount = 0;
  let withoutImageCount = 0;

  for (const file of issueFiles) {
    const issue = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
    const date = issue.date || file.slice(0, 10);
    const dateReport = { raw: 0, public: 0, suppressed: 0, flags: {} };
    for (const item of issue.items || []) {
      rawItemCount++;
      dateReport.raw++;
      const flags = qualityIssues(item);
      for (const flag of flags) {
        increment(byFlag, flag);
        increment(dateReport.flags, flag);
      }
      const tier = item.category === "watercooler" ? "brief" : normalizeContentTier(item);
      increment(byCategory, item.category || "other");
      increment(byTier, tier);
      increment(byMarket, item.market || "미지정");
      if (item.imageUrl) withImageCount++;
      else withoutImageCount++;

      if (item.visibility === "suppressed") {
        suppressedCount++;
        dateReport.suppressed++;
        continue;
      }
      if (publishQualityIssues(item).length) continue;
      publicItemCount++;
      dateReport.public++;
      for (const key of sourceKeys(item)) {
        const normalized = normalizeSourceUrl(key);
        if (!normalized) continue;
        if (sourceSeen.has(normalized)) {
          duplicateSources.push({ sourceUrl: normalized, first: sourceSeen.get(normalized), duplicate: `${file}#${item.id || "item"}` });
        } else {
          sourceSeen.set(normalized, `${file}#${item.id || "item"}`);
        }
      }
    }
    byDate[date] = dateReport;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    issueCount: issueFiles.length,
    rawItemCount,
    publicItemCount,
    suppressedCount,
    publicRate: rawItemCount ? Number((publicItemCount / rawItemCount).toFixed(4)) : 0,
    images: { withImage: withImageCount, withoutImage: withoutImageCount },
    byFlag,
    byCategory,
    byTier,
    byMarket,
    byDate,
    duplicateSources,
  };
  const output = argValue("--json", "");
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
  }
  console.log(`품질 리포트: 공개 ${publicItemCount}건 / 원본 ${rawItemCount}건 / 억제 ${suppressedCount}건`);
  console.log(`  이미지 있음 ${withImageCount}건 / 없음 ${withoutImageCount}건`);
  console.log(`  품질 플래그: ${Object.entries(byFlag).map(([key, value]) => `${key}=${value}`).join(", ") || "없음"}`);
  console.log(`  공개 중복 원문: ${duplicateSources.length}건`);
  if (output) console.log(`  JSON: ${output}`);
}

main();
