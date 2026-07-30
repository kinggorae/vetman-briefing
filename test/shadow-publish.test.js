import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const REPO = process.cwd();
const DRAFT = "v1_88e7bde7826c5eaf";

function latestShadowRun() {
  const dir = path.join(REPO, "reports", "shadow");
  const dates = fs.readdirSync(dir).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort();
  return JSON.parse(fs.readFileSync(path.join(dir, dates.at(-1), "run.json"), "utf8"));
}

test("shadow report is private and never claims automatic publication", () => {
  const report = latestShadowRun();
  assert.equal(report.public, false);
  assert.equal(report.published, 0);
  assert.ok(report.packetCount <= 10);
});

test("publish validation is preview-only and unregistered reviewers fail closed", () => {
  const validation = execFileSync(process.execPath, ["scripts/publish-control.js", "validate", DRAFT], { cwd: REPO, encoding: "utf8" });
  assert.match(validation, /"sitemap": false/);
  const approval = spawnSync(process.execPath, ["scripts/publish-control.js", "approve", DRAFT, "--reviewer", "not-registered", "--checklist=all"], { cwd: REPO, encoding: "utf8" });
  assert.notEqual(approval.status, 0);
  assert.match(`${approval.stdout}\n${approval.stderr}`, /등록된|reviewer/);
});

test("first publish candidates keep all five source drafts unpublished", () => {
  const report = JSON.parse(fs.readFileSync(path.join(REPO, "reports", "first-publish-candidates.json"), "utf8"));
  assert.equal(report.candidates.length, 5);
  assert.equal(report.candidates.filter((row) => row.published).length, 0);
  assert.equal(report.counts["needs-language-fix"], 5);
});
