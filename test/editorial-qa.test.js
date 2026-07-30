import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { languageReport, claimReport, firstReleaseReport } from "../scripts/editorial-qa.js";

const ROOT = process.cwd();

test("8차 언어·주장 검수 리포트는 전체 기존 경고를 분류한다", () => {
  const language = JSON.parse(fs.readFileSync(path.join(ROOT, "reports/language-review.json"), "utf8"));
  const claims = JSON.parse(fs.readFileSync(path.join(ROOT, "reports/claim-review.json"), "utf8"));
  assert.equal(language.warningCount, 20);
  assert.equal(claims.warningCount, 64);
  assert.ok(language.items.every((item) => item.articleId && item.classification && typeof item.requiresHumanReview === "boolean"));
  assert.ok(claims.items.every((item) => item.articleId && item.classification && item.claim));
  assert.equal(claims.critical, 0);
});

test("사람 등록 CLI는 빈 people.json에서 정상 동작하고 placeholder를 거부한다", () => {
  const list = spawnSync(process.execPath, ["scripts/people-cli.js", "list"], { cwd: ROOT, encoding: "utf8" });
  assert.equal(list.status, 0);
  assert.match(list.stdout, /reviewerCount.*0/);
  const invalid = spawnSync(process.execPath, ["scripts/people-cli.js", "add", "--id", "test-user", "--name", "홍길동", "--role", "editor"], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(`${invalid.stdout}\n${invalid.stderr}`, /placeholder|허용하지 않습니다/);
  const vet = spawnSync(process.execPath, ["scripts/people-cli.js", "add", "--id", "vet-user", "--name", "검수자", "--role", "veterinary-reviewer"], { cwd: ROOT, encoding: "utf8" });
  assert.notEqual(vet.status, 0);
  assert.match(`${vet.stdout}\n${vet.stderr}`, /credentials|profileUrl/);
});

test("첫 발행 후보는 reviewer 없이 published가 될 수 없다", () => {
  const report = firstReleaseReport();
  assert.equal(report.counts["needs-language-fix"], 5);
  assert.equal(report.candidates.filter((row) => row.published).length, 0);
});
