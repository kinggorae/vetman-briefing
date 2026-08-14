import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { inspectRetention } from "../src/lib/retention-guard.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CURRENT_FILE = path.join(ROOT, "site", "search.json");
const REPORT = path.join(ROOT, "reports", "retention-guard.json");
const baseRef = String(process.env.RETENTION_BASE_REF || "HEAD^").trim();
const allowRemovals = String(process.env.RETENTION_ALLOW_REMOVALS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function gitObjectExists(spec) {
  try {
    execFileSync("git", ["cat-file", "-e", spec], { cwd: ROOT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function readBaseSearch() {
  if (!gitObjectExists(`${baseRef}^{commit}`)) {
    throw new Error(`retention base ref를 찾을 수 없습니다: ${baseRef}`);
  }
  if (!gitObjectExists(`${baseRef}:site/search.json`)) return null;
  return JSON.parse(execFileSync("git", ["show", `${baseRef}:site/search.json`], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  }));
}

function writeReport(result) {
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, `${JSON.stringify(result, null, 2)}\n`);
}

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  baseRef,
  allowRemovals,
  status: "failed",
  previous: null,
  current: null,
  added: [],
  removed: [],
  allowedRemoved: [],
  unexpectedRemoved: [],
  critical: [],
};

try {
  const current = readJson(CURRENT_FILE);
  result.current = { count: current?.items?.length ?? null, declaredCount: current?.count ?? null };
  const previous = readBaseSearch();

  if (!previous) {
    result.status = "skipped";
    result.reason = "base-search-missing-first-publication";
    writeReport(result);
    console.log("retention guard: skipped · base commit has no site/search.json");
  } else {
    result.previous = { count: previous?.items?.length ?? null, declaredCount: previous?.count ?? null };
    const inspection = inspectRetention(previous, current, { allowRemovals });
    Object.assign(result, inspection);
    result.status = result.critical.length ? "failed" : "passed";
    console.log(`retention guard: previous ${inspection.previousCount} · current ${inspection.currentCount} · added ${inspection.added.length} · removed ${inspection.removed.length} · critical ${inspection.critical.length}`);
    if (inspection.allowedRemoved.length) console.log(`retention guard: explicitly allowed removals ${inspection.allowedRemoved.length}`);
    if (inspection.critical.length) console.error(JSON.stringify(inspection.critical, null, 2));
    writeReport(result);
    if (inspection.critical.length) process.exitCode = 1;
  }
} catch (error) {
  result.critical.push({ reason: "retention-guard-error", message: error.message });
  writeReport(result);
  console.error(`retention guard: ${error.message}`);
  process.exitCode = 1;
}
