import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isProfessionallyIndexable, publishQualityIssues } from "../src/lib/quality.js";
import { clinicalSafetyIssues, loadEditorialSettings, organizationAuthor } from "../src/lib/editorial-policy.js";
import { canReleaseDaily, DAILY_TARGET_ITEMS, evaluate, retainSeenAfterTargetMiss } from "../scripts/brief-publishing.js";
import { DAILY_CANDIDATE_POOL, DAILY_DEEP_TARGET_ITEMS, DAILY_HOME_ITEMS, DAILY_RSS_ITEMS } from "../config.js";

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

test("일일 발행은 60건 목표에 도달하기 전 부분 이슈를 만들지 않는다", () => {
  assert.equal(DAILY_TARGET_ITEMS, 60);
  assert.equal(DAILY_DEEP_TARGET_ITEMS, 32);
  assert.equal(DAILY_CANDIDATE_POOL, 90);
  assert.equal(DAILY_HOME_ITEMS, 60);
  assert.equal(DAILY_RSS_ITEMS, 100);
  assert.equal(canReleaseDaily(0, 59), false);
  assert.equal(canReleaseDaily(5, 54), false);
  assert.equal(canReleaseDaily(5, 55), true);
  assert.equal(canReleaseDaily(0, 60), true);
});

test("일간 수집 레지스트리는 Wiley 전문 저널과 PubMed를 공급원으로 유지한다", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sources", "registry.json"), "utf8"));
  const labels = new Set((registry.sources || []).map((source) => source.label));
  for (const label of ["Veterinary Dermatology", "Veterinary Clinical Pathology", "Veterinary and Comparative Oncology", "Veterinary ophthalmology"]) {
    assert.ok(labels.has(label), `${label} source missing`);
  }
  const pubmed = registry.sources.find((source) => source.label === "PubMed");
  assert.equal(pubmed?.enabled, true);
  assert.equal(pubmed?.sourceType, "journal");
  assert.deepEqual(pubmed?.officialDomains, ["pubmed.ncbi.nlm.nih.gov"]);
});

test("일일 목표 미달이면 발행 후보만 seen 큐로 되돌린다", () => {
  const keep = "https://example.com/keep";
  const retry = "https://example.com/retry";
  const retained = retainSeenAfterTargetMiss(
    [keep, retry, `${retry}?utm_source=feed`],
    [{ row: { sourceUrl: retry, sourceUrlRaw: `${retry}?utm_source=feed` } }],
  );
  assert.deepEqual(retained, [keep]);
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
