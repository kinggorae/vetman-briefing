import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSourceUrl, sourceKeys, stableItemId } from "../src/identity.js";
import { koreanizeText } from "../src/koreanize.js";
import { qualityIssues } from "../src/quality.js";

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
