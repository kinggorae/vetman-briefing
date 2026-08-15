import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { isProfessionallyIndexable, publishQualityIssues } from "../src/lib/quality.js";
import { clinicalSafetyIssues, loadEditorialSettings, organizationAuthor } from "../src/lib/editorial-policy.js";
import { canReleaseDaily, DAILY_MINIMUM_ITEMS, DAILY_TARGET_ITEMS, evaluate, retainSeenAfterTargetMiss } from "../scripts/brief-publishing.js";
import { BRIEF_MIN_CHARS, DAILY_CANDIDATE_POOL, DAILY_DEEP_TARGET_ITEMS, DAILY_HOME_ITEMS, DAILY_MINIMUM_ITEMS as CONFIG_DAILY_MINIMUM_ITEMS, DAILY_RSS_ITEMS } from "../config.js";

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

test("일일 발행은 40건까지 채우되 최소 30건이면 부분 발행한다", () => {
  assert.equal(DAILY_TARGET_ITEMS, 40);
  assert.equal(DAILY_MINIMUM_ITEMS, 30);
  assert.equal(CONFIG_DAILY_MINIMUM_ITEMS, 30);
  assert.equal(DAILY_DEEP_TARGET_ITEMS, 15);
  assert.equal(DAILY_CANDIDATE_POOL, 260);
  assert.equal(DAILY_HOME_ITEMS, 40);
  assert.equal(DAILY_RSS_ITEMS, 100);
  assert.equal(BRIEF_MIN_CHARS, 250);
  assert.equal(canReleaseDaily(0, 29), false);
  assert.equal(canReleaseDaily(0, 30), true);
  assert.equal(canReleaseDaily(5, 24), false);
  assert.equal(canReleaseDaily(5, 25), true);
  assert.equal(canReleaseDaily(0, 40), true);
});

test("일간 수집 레지스트리는 Wiley 전문 저널과 PubMed를 공급원으로 유지한다", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sources", "registry.json"), "utf8"));
  const labels = new Set((registry.sources || []).map((source) => source.label));
  for (const label of ["Veterinary Dermatology", "Veterinary Clinical Pathology", "Veterinary and Comparative Oncology", "Veterinary ophthalmology", "Veterinary Sciences", "Animals", "Texas A&M VMBS News", "Washington State Veterinary News", "University of Florida Veterinary News", "University of Missouri Veterinary News"]) {
    assert.ok(labels.has(label), `${label} source missing`);
  }
  for (const label of ["Veterinary Sciences", "Animals", "Texas A&M VMBS News", "Washington State Veterinary News", "University of Florida Veterinary News", "University of Missouri Veterinary News"]) {
    const source = registry.sources.find((candidate) => candidate.label === label);
    assert.equal(source?.enabled, true, `${label} must be active`);
    assert.ok(source?.rssUrls?.length, `${label} RSS missing`);
  }
  const pubmed = registry.sources.find((source) => source.label === "PubMed");
  assert.equal(pubmed?.enabled, true);
  assert.equal(pubmed?.sourceType, "journal");
  assert.deepEqual(pubmed?.officialDomains, ["pubmed.ncbi.nlm.nih.gov"]);
});

test("일간 수집 레지스트리는 독립 공식 학술·대학 피드의 최소 공급량을 보장한다", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "sources", "registry.json"), "utf8"));
  const active = (registry.sources || []).filter((source) => source.enabled);
  const rss = active.filter((source) => source.rssUrls?.length || source.atomUrls?.length);
  assert.ok(active.length >= 51, `active source count ${active.length} < 51`);
  assert.ok(rss.length >= 38, `RSS source count ${rss.length} < 38`);
  for (const label of [
    "Journal of Veterinary Internal Medicine",
    "Cornell College of Veterinary Medicine News",
    "Minnesota Veterinary & Biomedical Sciences Research",
    "Illinois College of Veterinary Medicine News",
    "Tennessee College of Veterinary Medicine News",
    "Virginia Tech Veterinary College News",
    "npj Veterinary Sciences",
    "Journal of Research in Veterinary Medicine",
    "American Journal of Traditional Chinese Veterinary Medicine",
  ]) {
    const source = active.find((candidate) => candidate.label === label);
    assert.ok(source?.rssUrls?.length, `${label} RSS missing`);
    assert.ok(source.officialDomains?.length, `${label} official domain missing`);
  }
  const jrvm = active.find((candidate) => candidate.label === "Journal of Research in Veterinary Medicine");
  assert.equal(jrvm.rssUrls.length, 2, "JRVM latest/early publication feeds missing");
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

test("이전 DOI 초안은 공식 feed item URL로 source 검증을 회복한다", () => {
  const result = evaluate({
    id: "doi-source-fallback",
    sourceId: "src-veterinary-medicine-and-science",
    sourceLabel: "Veterinary medicine and science",
    sourceStatus: "unresolved",
    sourceUrl: null,
    sourceUrlRaw: "https://onlinelibrary.wiley.com/doi/10.1002/vms3.71117?af=R",
    sourceTitle: "Veterinary study",
    titleKo: "수의학 연구 결과를 정리했습니다",
    leadKo: "공식 원문에서 연구 설계와 결과를 요약한 짧은 브리핑입니다.",
    bodyKo: ["첫 번째 문단은 연구 대상을 설명하고 원문 출처를 표시합니다.", "두 번째 문단은 관찰된 결과와 해석의 한계를 설명합니다.", "세 번째 문단은 임상 적용 전에 추가 확인할 점을 설명합니다."],
    clinicalRisk: "medium",
    duplicateStatus: "unique",
    contentTier: "brief",
    generation: { generationWarnings: [] },
  });
  assert.equal(result.source.status, "verified");
  assert.notEqual(result.status, "needs-source-fix");
});

test("정책 보고서의 기존 치명 오류와 자동 published를 확인한다", () => {
  const report = JSON.parse(fs.readFileSync(path.join(ROOT, "reports", "no-reviewer-policy.json"), "utf8"));
  assert.equal(report.reviewerCount, 0);
  assert.equal(report.automaticPublished, 0);
  assert.equal(report.legacyRiskAudit.criticalCount, 0);
  assert.equal(report.candidateCounts["needs-language-fix"], 5);
});
