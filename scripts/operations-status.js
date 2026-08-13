import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { summarizeOperations, operationsMarkdown } from "../src/lib/operations-status.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const REPORTS = path.join(ROOT, "reports");

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}
function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}
function issueRows() {
  const files = fs.existsSync(ISSUES) ? fs.readdirSync(ISSUES).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort() : [];
  return files.flatMap((file) => {
    const issue = readJson(path.join(ISSUES, file), null);
    return (issue?.items || []).map((item, index) => ({ item, index, file, date: issue.date || file.slice(0, 10), published: issue.status === "published" }));
  });
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, value);
  fs.renameSync(temp, file);
}

const search = readJson(path.join(ROOT, "site", "search.json"), { items: [] });
const report = summarizeOperations({
  articles: issueRows(),
  indexIds: (search.items || []).map((item) => item.id),
  sourceResolution: readJson(path.join(REPORTS, "source-resolution.json"), { rows: [] }),
  sourceDecisions: readJson(path.join(ROOT, "data", "source-resolution-decisions.json"), {}),
  imageDecisions: readJson(path.join(ROOT, "data", "image-rights-decisions.json"), {}),
  reviews: readJsonl(path.join(ROOT, "data", "editorial", "reviews.jsonl")),
  seoPerformance: readJson(path.join(ROOT, "data", "seo", "performance.json"), { rows: [] }),
  sourceHealth: readJson(path.join(REPORTS, "source-health.json"), { feeds: [] }),
  corrections: readJsonl(path.join(ROOT, "data", "editorial", "corrections.jsonl")),
});
write(path.join(REPORTS, "operations-status.json"), JSON.stringify(report, null, 2) + "\n");
write(path.join(REPORTS, "operations-status.md"), operationsMarkdown(report));
console.log(JSON.stringify(report, null, 2));
