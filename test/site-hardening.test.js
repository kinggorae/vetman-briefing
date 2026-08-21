import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { alignDeploymentMetadata } from "../scripts/align-deployment-metadata.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUILD = fs.readFileSync(path.join(ROOT, "src", "build.js"), "utf8");
const DAILY = fs.readFileSync(path.join(ROOT, ".github", "workflows", "daily.yml"), "utf8");

test("generated pages do not request the retired Wanted Sans stylesheet", () => {
  assert.doesNotMatch(BUILD, /wanted-sans|Wanted Sans/i);
  assert.match(BUILD, /pretendardvariable\.css/);
});

test("daily source health is calculated from the current feed diagnosis", () => {
  const diagnosis = DAILY.indexOf("run: npm run sources:diagnose");
  const health = DAILY.indexOf("run: npm run sources:health");
  assert.ok(diagnosis >= 0, "daily workflow must diagnose feeds");
  assert.ok(health >= 0, "daily workflow must check source health");
  assert.ok(diagnosis < health, "feed diagnosis must precede source health");
});

test("daily publication runs browser smoke tests and records the published commit", () => {
  assert.match(DAILY, /run: npm run test:browser -- --reporter=line/);
  assert.match(DAILY, /id: publication/);
  assert.match(DAILY, /DEPLOY_COMMIT:\s+\$\{\{ steps\.publication\.outputs\.sha \}\}/);
  assert.match(DAILY, /node scripts\/align-deployment-metadata\.js "\$DEPLOY_COMMIT"/);
  assert.match(BUILD, /sourceCommit: process\.env\.DEPLOY_COMMIT \|\|/);
});

test("deployment metadata alignment changes only the published commit", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "vetman-deployment-"));
  const file = path.join(directory, "deployment.json");
  fs.writeFileSync(file, JSON.stringify({ version: 1, builtAt: "2026-08-21T00:00:00.000Z", sourceCommit: "old" }));
  const payload = alignDeploymentMetadata("a".repeat(40), file);
  assert.equal(payload.sourceCommit, "a".repeat(40));
  assert.equal(payload.builtAt, "2026-08-21T00:00:00.000Z");
  fs.rmSync(directory, { recursive: true, force: true });
});
