import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSourceUrl, sourceKeys, stableItemId } from "../src/identity.js";
import { koreanizeText } from "../src/koreanize.js";
import { publishQualityIssues, qualityIssues } from "../src/quality.js";
import { cleanImageUrl, removeRepeatedImages } from "../src/images.js";
import {
  FEEDS,
  CANDIDATES_MAX,
  ITEMS_PER_ISSUE,
  BRIEFS_PER_ISSUE,
  PAPERS_PER_ISSUE,
} from "../config.js";

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
