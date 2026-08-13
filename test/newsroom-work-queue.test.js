import test from "node:test";
import assert from "node:assert/strict";
import { buildNewsroomWorkQueue, filterNewsroomWorkQueue, mergePublicCorrectionRequests } from "../src/lib/newsroom-work-queue.js";

test("newsroom queue puts production and correction blockers first", () => {
  const report = buildNewsroomWorkQueue({
    productionMonitor: { critical: [{ pathname: "/deployment.json", reason: "http-404" }], warnings: [] },
    reviewRows: [{ id: "article-1", title: "정정 기사", indexable: false, clinicalRisk: "medium", reviewerNeeded: true, workflowStatus: "correction-required", clinicalReviewIssues: ["correction-required"] }],
  });
  assert.equal(report.rows[0].type, "production-sync");
  assert.equal(report.rows[1].type, "correction");
  assert.ok(report.rows[1].commands.some((command) => command.includes("review:correct")));
});

test("indexable source and image tasks outrank noindex tasks", () => {
  const report = buildNewsroomWorkQueue({
    reviewRows: [
      { id: "idx", title: "색인 기사", indexable: true, clinicalRisk: "medium", reviewerNeeded: true },
      { id: "noidx", title: "제외 기사", indexable: false, clinicalRisk: "low", reviewerNeeded: false },
    ],
    sourceResolution: { rows: [
      { articleId: "idx", status: "unresolved", sourceLabel: "공식 매체", rawUrl: "https://news.google.com/rss/articles/x" },
      { articleId: "noidx", status: "unresolved", sourceLabel: "공식 매체", rawUrl: "https://news.google.com/rss/articles/y" },
    ] },
    imageRightsQueue: { rows: [
      { id: "idx", indexable: true, status: "pending", issues: ["image-ownership-unknown"] },
      { id: "noidx", indexable: false, status: "pending", issues: ["image-ownership-unknown"] },
    ] },
  });
  const source = report.rows.filter((row) => row.type === "source-review");
  const image = report.rows.filter((row) => row.type === "image-rights");
  assert.equal(source[0].articleId, "idx");
  assert.equal(image[0].articleId, "idx");
  assert.ok(source[0].priority > source[1].priority);
  assert.ok(image[0].priority > image[1].priority);
});

test("queue keeps human actions explicit and never marks work complete", () => {
  const report = buildNewsroomWorkQueue({
    newsroom: { drafts: [{ id: "draft-1", title: "새 초안", clinicalRisk: "low", published: false, commands: { show: "npm run review:show -- draft-1" } }] },
    sourceHealth: { feeds: [{ sourceId: "feed-1", sourceLabel: "매체", status: "failing", feedUrl: "https://example.com/feed" }] },
  });
  assert.equal(report.noindex, true);
  assert.equal(report.rows.every((row) => row.status === "open"), true);
  assert.ok(report.rows.some((row) => row.type === "draft-review" && row.commands[0].includes("review:show")));
  assert.ok(report.rows.some((row) => row.type === "feed-health" && row.commands.includes("npm run sources:diagnose")));
});

test("queue summary is deterministic by type and priority", () => {
  const report = buildNewsroomWorkQueue({
    imageRightsQueue: { rows: [{ id: "a", indexable: true, status: "pending" }] },
  });
  assert.equal(report.count, 1);
  assert.deepEqual(report.counts.byType, { "image-rights": 1 });
  assert.deepEqual(report.counts.byPriority, { critical: 0, high: 1, normal: 0 });
});

test("live public correction requests are merged without reopening resolved items", () => {
  const base = buildNewsroomWorkQueue({ generatedAt: "2026-08-13T00:00:00.000Z" });
  const merged = mergePublicCorrectionRequests(base, [
    { id: "open-1", type: "fact", status: "open", articleUrl: "/article/v1_open", message: "원문과 수치가 다릅니다." },
    { id: "review-1", type: "translation", status: "in-review", message: "번역 확인이 필요합니다." },
    { id: "done-1", type: "deletion", status: "resolved", message: "이미 처리했습니다." },
  ], "2026-08-13T01:00:00.000Z");
  assert.equal(merged.count, 2);
  assert.equal(merged.rows.filter((row) => row.type === "correction").length, 2);
  assert.equal(merged.rows[0].id, "public-correction:open-1");
  assert.equal(merged.generatedAt, "2026-08-13T01:00:00.000Z");
});

test("work queue filters preserve priority buckets and searchable identifiers", () => {
  const report = buildNewsroomWorkQueue({
    productionMonitor: { critical: [{ pathname: "/deployment.json", reason: "http-404" }], warnings: [] },
    sourceHealth: { feeds: [{ sourceId: "feed-1", sourceLabel: "공식 피드", status: "failing", feedUrl: "https://example.com/feed" }] },
    imageRightsQueue: { rows: [{ id: "index-image", indexable: true, status: "pending" }] },
  });
  const critical = filterNewsroomWorkQueue(report, { priority: "critical" });
  assert.ok(critical.rows.length > 0);
  assert.equal(critical.rows.every((row) => row.priority >= 130), true);
  assert.equal(filterNewsroomWorkQueue(report, { type: "image-rights" }).count, 1);
  assert.equal(filterNewsroomWorkQueue(report, { query: "deployment.json" }).rows[0].id, "production:sync");
  assert.equal(filterNewsroomWorkQueue(report, { query: "없는 작업" }).count, 0);
});
