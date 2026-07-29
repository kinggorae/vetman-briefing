import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSourceUrl, sourceKeys, stableItemId } from "../src/identity.js";
import { koreanizeText } from "../src/koreanize.js";
import {
  bodyCharCount,
  isProfessionallyIndexable,
  normalizeContentTier,
  publishQualityIssues,
  qualityIssues,
} from "../src/quality.js";
import { cleanImageUrl, removeRepeatedImages } from "../src/images.js";
import { cardAssetPath, cardRelativePath, generatedImageMeta } from "../src/editorial-cards.js";
import { imageCanRender, normalizeImageOwnership } from "../src/lib/image-rights.js";
import { clinicalReviewIssues, inferClinicalRisk, normalizeEditorialStatus } from "../src/lib/editorial-review.js";
import { CHECKLIST_KEYS, articleContractIssues, contentHash, normalizedChecklist, requiredReviewRole, sourceHash } from "../src/lib/editorial-operations.js";
import { evidenceMetadata, numericEvidenceIssues } from "../src/lib/evidence.js";
import {
  FEEDS,
  CANDIDATES_MAX,
  ITEMS_PER_ISSUE,
  BRIEFS_PER_ISSUE,
  PAPERS_PER_ISSUE,
} from "../config.js";
import { dedupeFeedEntries, isOfficialUrl, parseFeed, sourceStatusFor } from "../src/lib/source-first.js";

test("source URLs normalize tracking parameters and fragments", () => {
  const clean = "https://example.com/story";
  assert.equal(normalizeSourceUrl("HTTPS://Example.com/story/?utm_source=x&fbclid=y#comments"), clean);
  assert.deepEqual(sourceKeys({ url: clean, finalUrl: `${clean}/` }), [clean]);
});

test("stable item IDs are unchanged when tracking changes", () => {
  assert.equal(
    stableItemId({ sourceUrl: "https://example.com/story?utm_campaign=one" }),
    stableItemId({ sourceUrl: "https://example.com/story?utm_campaign=two" })
  );
});

test("Koreanization removes known MiniMax translation artifacts", () => {
  assert.equal(koreanizeText("Microbiome와 Taurine의 efficacy"), "미생물군집과 타우린의 유효성");
});

test("quality gate catches foreign scripts and untranslated terms", () => {
  const flags = qualityIssues({ titleKo: "개 refractory 질환", leadKo: "중국어 한자 混入", bodyKo: ["짧은 본문"] });
  assert.ok(flags.includes("foreign-script"));
  assert.ok(flags.includes("untranslated-term"));
});

test("quality gate keeps thin or garbled briefs out of the compact feed", () => {
  const flags = qualityIssues({
    tier: "brief",
    titleKo: "비진정 참여자",
    leadKo: "한 문장으로 끝나는 단신입니다.",
    bodyKo: [],
  });
  assert.ok(flags.includes("brief-too-short"));

  const garbledItem = {
    tier: "brief",
    titleKo: "온라인 말 이 교육 프로그램 출시",
    leadKo: "수의사 교육 관련 소식으로 자세한 내용과 배경을 함께 전합니다. 현장에 참고할 만한 정보입니다.",
    bodyKo: [],
  };
  const garbled = qualityIssues(garbledItem);
  assert.ok(garbled.includes("garbled-text"));
  assert.ok(publishQualityIssues(garbledItem).includes("garbled-text"));
  assert.ok(!publishQualityIssues({ titleKo: "짧은 문단 경고", leadKo: "내용", bodyKo: ["한 문단"] }).includes("paragraphs-too-few"));
});

test("image cleanup rejects generic assets and removes repeated representatives", () => {
  assert.equal(cleanImageUrl("https://lh3.googleusercontent.com/example=s0"), null);
  assert.equal(cleanImageUrl("https://example.com/main-visual-green-website.webp"), null);

  const items = [
    { imageUrl: "https://example.com/article-a.jpg" },
    { imageUrl: "https://example.com/article-a.jpg" },
    { imageUrl: "https://example.com/article-b.jpg" },
  ];
  assert.equal(removeRepeatedImages(items), 2);
  assert.equal(items[0].imageUrl, null);
  assert.equal(items[1].imageUrl, null);
  assert.equal(items[2].imageUrl, "https://example.com/article-b.jpg");
});

test("global collection covers multiple markets without duplicate feed URLs", () => {
  const gnews = FEEDS.filter((feed) => feed.type === "gnews");
  const markets = new Set(gnews.map((feed) => feed.market).filter(Boolean));
  assert.ok(FEEDS.length >= 100);
  assert.ok(markets.size >= 14);
  assert.equal(new Set(FEEDS.map((feed) => feed.url)).size, FEEDS.length);
  assert.ok(CANDIDATES_MAX >= 500);
  assert.ok(ITEMS_PER_ISSUE >= 40);
  assert.ok(BRIEFS_PER_ISSUE >= 60);
  assert.ok(PAPERS_PER_ISSUE >= 16);
});

test("professional index gate requires three paragraphs, 420 chars, radar, and source", () => {
  const base = {
    contentTier: "analysis",
    titleKo: "고양이 만성 신장질환 관리의 임상 포인트",
    leadKo: "고양이 만성 신장질환 환자에서 진료 계획을 점검할 때 참고할 수 있는 핵심 내용을 정리했습니다.",
    bodyKo: [
      "첫 번째 문단은 고양이 만성 신장질환의 배경과 진료 맥락을 설명합니다. 환자의 상태와 검사 결과를 함께 해석해야 합니다. 병력 청취와 신체검사에서 확인한 변화가 진단의 우선순위를 정하는 데 중요한 단서가 되므로 보호자에게 관찰 시점과 경과를 구체적으로 묻는 과정도 필요합니다.",
      "두 번째 문단은 원문에서 보고된 방법과 결과를 설명합니다. 연구의 한계와 적용 범위를 구분해서 읽어야 합니다. 표본의 특성, 비교군의 유무, 추적 기간과 결과 측정 방법을 확인하고, 통계적으로 유의한 결과가 실제 진료에서 얼마나 의미가 있는지도 별도로 판단해야 합니다.",
      "세 번째 문단은 한국 동물병원에서 확인할 점을 정리합니다. 개별 환자에게 적용하기 전 최신 지침과 원문을 확인해야 합니다. 국내에서 이용할 수 있는 검사와 치료 선택지가 다를 수 있으므로 환자의 위험도와 보호자의 이해 수준을 함께 고려하고, 설명한 내용과 추적 계획을 진료 기록에 남기는 것이 안전합니다. 불확실한 근거는 별도로 표시하고 환자별 판단이 필요하다는 점도 설명해야 합니다. 진료팀 내부에서도 같은 기준으로 결과를 검토하고 필요한 경우 재평가 일정을 조정해야 합니다.",
    ],
    radar: { clinical: "검사 결과와 임상 증상을 함께 검토합니다.", owner: null, evidence: null },
    sourceUrl: "https://example.com/article",
  };
  assert.ok(bodyCharCount(base) >= 420);
  assert.equal(isProfessionallyIndexable(base), true);
  assert.ok(!publishQualityIssues(base).includes("paragraphs-too-few"));
  assert.equal(isProfessionallyIndexable({ ...base, bodyKo: [base.bodyKo[0]] }), false);
  assert.ok(qualityIssues({ ...base, sourceUrl: "" }).includes("source-missing"));
});

test("legacy tier inference never upgrades thin content to analysis", () => {
  assert.equal(normalizeContentTier({ tier: "brief", bodyKo: ["짧은 소식입니다."] }), "brief");
  assert.equal(normalizeContentTier({ tier: "deep", bodyKo: ["짧은 문단"], radar: { clinical: "메모" } }), "brief");
  assert.equal(normalizeContentTier({ tier: "deep", bodyKo: ["긴 본문"], doi: "10.1234/example" }), "evidence");
});

test("index gate keeps dateModified absent unless updatedAt is present", () => {
  const item = {
    contentTier: "analysis",
    titleKo: "개의 만성 기침 진료 점검",
    leadKo: "개의 만성 기침을 평가할 때 필요한 기본적인 진료 점검 항목을 정리했습니다.",
    bodyKo: [
      "첫 문단은 만성 기침의 배경과 감별 진단을 설명합니다. 병력과 신체검사를 함께 확인해야 합니다. 기침의 기간과 빈도, 운동 시 악화 여부, 호흡 곤란 동반 여부를 세심하게 확인하고 응급 징후가 있는 경우 안정화와 추가 평가의 순서를 먼저 정해야 합니다.",
      "둘째 문단은 검사 결과를 해석할 때 주의할 점을 설명합니다. 단일 검사만으로 결론을 내리지 않습니다. 영상검사와 혈액검사 결과를 환자의 임상 증상 및 노출력과 함께 비교해야 하며, 검사 시점이나 검사 장비의 차이가 결과에 미칠 수 있는 영향도 고려해야 합니다.",
      "셋째 문단은 한국 동물병원에서 보호자에게 설명할 내용을 정리합니다. 최신 문헌을 확인해 개별 환자에 적용해야 합니다. 치료 반응을 확인할 재진 시점과 즉시 내원해야 하는 경고 증상을 보호자에게 명확히 안내하고, 불확실한 부분은 단정하지 않도록 기록과 설명을 일치시키는 것이 중요합니다. 검사 결과가 달라질 수 있는 조건과 추가 상담이 필요한 상황도 함께 안내해야 합니다. 담당 의료진이 판단 근거와 다음 단계를 같은 언어로 설명하면 보호자의 이해와 추적 관찰에도 도움이 됩니다. 환자의 상태가 변하면 기존 계획을 다시 평가해야 한다는 점도 미리 알려야 합니다.",
    ],
    radar: { clinical: "기침 기간과 호흡 상태를 함께 확인합니다." },
    sourceUrl: "https://example.com/cough",
  };
  assert.equal(isProfessionallyIndexable(item), true);
  assert.equal(isProfessionallyIndexable({ ...item, updatedAt: "2026-07-29T00:00:00Z" }), true);
});

test("editorial cards have stable hosted paths and non-clinical accessible metadata", () => {
  const a = generatedImageMeta("v1_0123456789abcdef", "고양이 진료 연구 요약");
  const b = generatedImageMeta("v1_0123456789abcdef", "고양이 진료 연구 요약");
  assert.deepEqual(a, b);
  assert.equal(cardRelativePath("v1_0123456789abcdef", "webp"), "/media/editorial/v1_0123456789abcdef.webp");
  assert.ok(cardAssetPath("/tmp/assets", "v1_0123456789abcdef", "svg").endsWith("/media/editorial/v1_0123456789abcdef.svg"));
  assert.match(a.imageAlt, /편집용 정보/);
  assert.match(a.imageCaption, /실제 환자|검사 이미지 아님/);
});

test("quality view fields carried by legacy articles remain part of the index gate", () => {
  const item = {
    contentTier: "analysis",
    titleKo: "개의 열치료 임상 활용",
    leadKo: "임상에서 열치료를 적용할 때 주의할 점과 활용 범위를 정리했습니다.",
    bodyKo: ["첫 문단입니다. 임상 맥락과 환자 상태를 함께 설명합니다. 충분한 배경을 제공합니다.", "둘째 문단입니다. 원문 결과와 한계를 구분해 설명합니다. 적용 범위를 확인합니다.", "셋째 문단입니다. 한국 동물병원에서 보호자에게 설명할 점을 정리합니다. 최신 근거를 확인합니다."],
    keyPointsKo: ["사용 시 주의할 점을 확인합니다."],
    angleKo: "ractical한 안내 글로 확장합니다.",
    radar: { clinical: "환자 상태를 함께 확인합니다." },
    sourceUrl: "https://example.com/heat",
  };
  assert.ok(qualityIssues(item).includes("banned-term"));
  assert.equal(isProfessionallyIndexable(item), false);
});

test("unknown external image rights never become an allowed hosted image", () => {
  assert.equal(normalizeImageOwnership(undefined, { hasImage: true, origin: "external-source" }), "unknown");
  assert.equal(imageCanRender({ url: "https://publisher.example/photo.jpg", ownership: "unknown" }), false);
  assert.equal(imageCanRender({ url: "https://publisher.example/photo.jpg", ownership: "source-embed" }), true);
  assert.equal(imageCanRender({ url: "http://publisher.example/photo.jpg", ownership: "licensed" }), false);
});

test("clinical review policy is conservative and does not retroactively block legacy articles", () => {
  assert.equal(normalizeEditorialStatus("not-a-status"), "automated");
  assert.equal(inferClinicalRisk({ titleKo: "약물 용량과 응급 대응", bodyKo: [] }), "high");
  assert.deepEqual(clinicalReviewIssues({ titleKo: "약물 용량", bodyKo: [], publishedAt: "2026-07-29T00:00:00Z" }, { issueDate: "2026-07-29" }), []);
  assert.ok(clinicalReviewIssues({ titleKo: "약물 용량", bodyKo: [], publishedAt: "2026-07-30T00:00:00Z" }, { issueDate: "2026-07-30" }).includes("high-risk-not-vet-reviewed"));
});

test("editorial workflow requires explicit schema, roles, checklist, and stable hashes", () => {
  const item = { id: "new-1", titleKo: "약물 용량 연구", leadKo: "연구 결과를 설명합니다.", bodyKo: ["첫 문단", "둘째 문단", "셋째 문단"], sourceLabel: "공식 매체", sourceUrl: "https://example.com/article", publishedAt: "2026-07-30", contentTier: "evidence", clinicalRisk: "high", workflowStatus: "draft" };
  assert.equal(requiredReviewRole(item), "vet");
  assert.deepEqual(Object.keys(normalizedChecklist({})), CHECKLIST_KEYS);
  assert.ok(articleContractIssues(item).includes("workflowStatus-missing") === false);
  assert.equal(contentHash(item), contentHash({ ...item }));
  assert.notEqual(contentHash(item), contentHash({ ...item, leadKo: "수정된 리드입니다." }));
  assert.equal(sourceHash(item), sourceHash({ ...item }));
});

test("evidence metadata is explicit and numeric conflicts are warnings only", () => {
  const item = { studyType: "case-report", sampleSize: 3, leadKo: "표본 수는 3마리입니다.", bodyKo: ["본문에서는 4마리로 보고했습니다."] };
  assert.deepEqual(evidenceMetadata(item), { studyType: "case-report", sampleSize: 3 });
  assert.ok(numericEvidenceIssues(item).includes("numeric-lead-body-mismatch"));
});

test("source-first feed parsing keeps official canonical explicit and rejects relay final URLs", () => {
  const source = { id: "src-example", label: "Example", officialDomains: ["example.com"] };
  const parsed = parseFeed(`<?xml version="1.0"?><rss version="2.0"><channel><item><title>Veterinary study</title><link>https://example.com/news/study</link><guid>abc</guid><pubDate>Wed, 30 Jul 2026 00:00:00 GMT</pubDate></item></channel></rss>`, "https://example.com/feed.xml", source);
  assert.equal(parsed.entries.length, 1);
  assert.equal(parsed.entries[0].canonicalUrl, null);
  assert.equal(sourceStatusFor(parsed.entries[0], source), "unresolved");
  assert.equal(isOfficialUrl(parsed.entries[0].url, source), true);
  const relay = { ...parsed.entries[0], url: "https://news.google.com/rss/articles/relay", canonicalUrl: "https://news.google.com/rss/articles/relay" };
  assert.equal(sourceStatusFor(relay, source), "unresolved");
});

test("relay URLs preserved as raw evidence cannot pass the index gate", () => {
  const item = {
    titleKo: "수의학 연구 결과를 임상에 적용할 때 확인할 점입니다.",
    leadKo: "원문 연구의 의미와 한계를 검토하고 임상 적용 전 최신 근거를 확인해야 합니다.",
    bodyKo: ["첫 번째 검수 문단은 연구 대상과 설계를 설명합니다.", "두 번째 검수 문단은 결과와 불확실성을 설명합니다.", "세 번째 검수 문단은 국내 적용 시 주의점을 설명합니다."],
    contentTier: "analysis", radar: { clinical: "임상적 추가 가치가 있습니다." }, sourceUrlRaw: "https://news.google.com/rss/articles/relay",
  };
  assert.ok(qualityIssues(item).includes("source-relay"));
  assert.equal(isProfessionallyIndexable(item), false);
});

test("source-first deduplication distinguishes unique, duplicate, and update candidates", () => {
  const existing = [{ id: "old-1", sourceUrl: "https://example.com/old", sourceTitle: "Existing veterinary study" }];
  const rows = dedupeFeedEntries([
    { guid: "same", url: "https://example.com/old", title: "New title" },
    { guid: "new", url: "https://example.com/new", title: "Existing veterinary study" },
    { guid: "fresh", url: "https://example.com/fresh", title: "Different animal hospital update" },
  ], existing);
  assert.equal(rows[0].duplicateStatus, "exact-duplicate");
  assert.equal(rows[1].duplicateStatus, "update-of-existing");
  assert.equal(rows[2].duplicateStatus, "unique");
});
