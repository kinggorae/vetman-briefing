import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, isAutomatedNewsCandidate } from "./brief-publishing.js";
import { atomicWrite, readJson } from "../src/lib/source-first.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUE_DIR = path.join(ROOT, "data", "issues");

function issueFiles() {
  return fs.readdirSync(ISSUE_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort();
}

function plan() {
  const rows = [];
  for (const file of issueFiles()) {
    const filePath = path.join(ISSUE_DIR, file);
    const data = readJson(filePath, null);
    if (!data) continue;
    for (const [index, item] of (data.items || []).entries()) {
      if (item.publicationStatus !== "public-brief") continue;
      let evaluation;
      try { evaluation = evaluate(item); } catch (error) {
        rows.push({ file, index, id: item.id || `${data.date}_${index + 1}`, eligible: false, reason: `evaluation-error:${error.message}` });
        continue;
      }
      const eligible = evaluation.status === "ready-public-brief" && isAutomatedNewsCandidate(item, evaluation);
      rows.push({ file, index, id: item.id || `${data.date}_${index + 1}`, eligible, reason: eligible ? "automated-news-gate-passed" : [...evaluation.blockers, evaluation.publication.status].filter(Boolean).join(",") || "automated-news-gate-failed" });
    }
  }
  return rows;
}

function main() {
  const apply = process.argv.includes("--apply");
  const rows = plan();
  const eligible = rows.filter((row) => row.eligible);
  if (apply) {
    const byFile = new Map();
    for (const row of eligible) {
      if (!byFile.has(row.file)) byFile.set(row.file, readJson(path.join(ISSUE_DIR, row.file), null));
      const data = byFile.get(row.file);
      if (data?.items?.[row.index]) data.items[row.index] = { ...data.items[row.index], publicationStatus: "index-news" };
    }
    for (const [file, data] of byFile) atomicWrite(path.join(ISSUE_DIR, file), JSON.stringify(data, null, 2) + "\n");
  }
  console.log(JSON.stringify({ apply, scanned: rows.length, eligible: eligible.length, changed: apply ? eligible.length : 0, files: [...new Set(eligible.map((row) => row.file))], sample: eligible.slice(0, 20).map((row) => row.id) }, null, 2));
}

main();
