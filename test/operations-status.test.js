import test from "node:test";
import assert from "node:assert/strict";
import { operationsMarkdown, summarizeOperations } from "../src/lib/operations-status.js";

test("operations status keeps human queues separate from public index counts", () => {
  const report = summarizeOperations({
    articles: [
      { id: "a", item: { id: "a", sourceUrl: "https://news.google.com/rss/articles/x", sourceUrlRaw: "https://news.google.com/rss/articles/x", titleKo: "임상 연구", bodyKo: ["환자 연구"], clinicalRisk: "high", workflowStatus: "legacy-published", imageUrl: "https://example.com/a.jpg" }, published: true },
      { id: "b", item: { id: "b", sourceUrl: "https://example.com/b", titleKo: "병원 운영", bodyKo: ["운영"], clinicalRisk: "low", workflowStatus: "legacy-published" }, published: true },
    ],
    indexIds: ["a"],
    sourceResolution: { totalRelayArticles: 1, counts: { unresolved: 1 }, rows: [{ articleId: "a", status: "unresolved" }] },
    reviews: [],
    seoPerformance: { rows: [{ provider: "gsc" }] },
  });
  assert.equal(report.publication.index, 1);
  assert.equal(report.source.unresolved, 1);
  assert.equal(report.editorial.indexHighRiskWaiting, 1);
  assert.equal(report.images.indexUnknownExternal, 1);
  assert.equal(report.gates.automaticPublished, 0);
  assert.match(operationsMarkdown(report), /사람이 확인해야 하는 항목/);
});

test("approved source and image decisions leave their queues", () => {
  const report = summarizeOperations({
    articles: [{ id: "a", item: { id: "a", sourceUrl: "https://news.google.com/rss/articles/x", sourceUrlRaw: "https://news.google.com/rss/articles/x", titleKo: "운영", bodyKo: ["내용"], clinicalRisk: "low", workflowStatus: "legacy-published", imageUrl: "https://example.com/a.jpg" }, published: true }],
    indexIds: ["a"],
    sourceResolution: { totalRelayArticles: 1, rows: [{ articleId: "a", status: "unresolved" }] },
    sourceDecisions: { a: { status: "manually-approved", url: "https://example.com/original" } },
    imageDecisions: { a: { status: "approved" } },
  });
  assert.equal(report.source.manuallyApproved, 1);
  assert.equal(report.source.unresolved, 0);
  assert.equal(report.images.pending, 0);
});

test("automated news index items do not create a reviewer queue", () => {
  const report = summarizeOperations({
    articles: [{ id: "news", item: { id: "news", sourceUrl: "https://example.com/news", titleKo: "출처 기반 뉴스", bodyKo: ["뉴스 본문"], clinicalRisk: "medium", publicationStatus: "index-news", workflowStatus: "published" }, published: true }],
    indexIds: ["news"],
  });
  assert.equal(report.editorial.indexMediumRiskWaiting, 0);
  assert.equal(report.gates.automaticPublished, 1);
  assert.equal(report.gates.canIncreaseIndex, true);
});
