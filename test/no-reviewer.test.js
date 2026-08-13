import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isProfessionallyIndexable, publishQualityIssues } from "../src/lib/quality.js";
import { clinicalSafetyIssues, loadEditorialSettings, organizationAuthor } from "../src/lib/editorial-policy.js";
import { canReleaseDaily, evaluate } from "../scripts/brief-publishing.js";

const ROOT = process.cwd();

test("수의사 감수자 없음 운영 모드는 명시적으로 fail-closed다", () => {
  const settings = loadEditorialSettings();
  assert.equal(settings.editorialMode, "organization-only");
  assert.equal(settings.veterinaryReviewerAvailable, false);
  assert.deepEqual(organizationAuthor(settings), { "@type": "Organization", name: "베트맨랩", url: "https://news.vetmanlab.com/about" });
  assert.equal(isProfessionallyIndexable({ publicationStatus: "public-brief", contentTier: "brief", titleKo: "충분한 제목입니다", leadKo: "충분한 설명입니다." }), false);
  assert.equal(isProfessionallyIndexable({ publicationStatus: "index-analysis", contentTier: "analysis", titleKo: "제목", leadKo: "리드", bodyKo: ["첫 문단"], sourceUrl: "https://example.com/a", radar: { clinical: "맥락" } }), false);
});

test("감수자 없는 public brief는 임상 명령 표현을 차단한다", () => {
  const item = { publicationStatus: "public-brief", contentTier: "brief", titleKo: "고양이 질환 안내", leadKo: "반드시 투여해야 합니다. 충분한 설명을 덧붙입니다." };
  assert.ok(clinicalSafetyIssues(item).length > 0);
  assert.ok(publishQualityIssues(item).includes("unsafe-clinical-command"));
});

test("일일 발행은 최소 건수에 도달하기 전 부분 이슈를 만들지 않는다", () => {
  assert.equal(canReleaseDaily(0, 3), false);
  assert.equal(canReleaseDaily(2, 3), true);
  assert.equal(canReleaseDaily(0, 5), true);
});

test("첫 low-risk 후보는 public brief release 전 언어·이미지 검수를 요구한다", () => {
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, "reports", "draft-newsroom.json"), "utf8"));
  const row = report.drafts.find((item) => item.id === "v1_88e7bde7826c5eaf");
  const result = evaluate(row);
  assert.equal(result.status, "needs-language-fix");
  assert.equal(result.publication.sitemap, false);
  assert.equal(result.reviewer, null);
  assert.ok(result.blockers.includes("한국어 titleKo·leadKo·bodyKo 필요"));
});

test("정책 보고서의 기존 치명 오류와 자동 published를 확인한다", () => {
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, "reports", "no-reviewer-policy.json"), "utf8"));
  assert.equal(report.reviewerCount, 0);
  assert.equal(report.automaticPublished, 0);
  assert.equal(report.legacyRiskAudit.criticalCount, 0);
  assert.equal(report.candidateCounts["needs-language-fix"], 5);
});
