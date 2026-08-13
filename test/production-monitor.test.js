import test from "node:test";
import assert from "node:assert/strict";
import { calendarAgeDays, compareDeploymentPayload, inspectArticleHtml, inspectDeploymentPayload, inspectLatestPayload, inspectResponseContract } from "../src/lib/production-monitor.js";

test("production monitor calculates calendar age in days", () => {
  assert.equal(calendarAgeDays("2026-08-10", "2026-08-13"), 3);
  assert.equal(calendarAgeDays("2026-08-13", "2026-08-13"), 0);
  assert.equal(calendarAgeDays("2026-02-30", "2026-08-13"), null);
});

test("production monitor flags a silently stale latest edition", () => {
  const result = inspectLatestPayload(
    { date: "2026-08-08", items: [{ id: "one" }] },
    { today: "2026-08-13", maxAgeDays: 3 },
  );
  assert.equal(result.ageDays, 5);
  assert.equal(result.critical[0].reason, "latest-stale");
});

test("production monitor accepts a current non-empty edition", () => {
  const result = inspectLatestPayload(
    { date: "2026-08-13", items: [{ id: "one" }] },
    { today: "2026-08-13", maxAgeDays: 3 },
  );
  assert.deepEqual(result.critical, []);
  assert.deepEqual(result.warnings, []);
});

test("production monitor rejects a latest payload without item data", () => {
  const result = inspectLatestPayload({ date: "2026-08-13" }, { today: "2026-08-13" });
  assert.equal(result.itemCount, null);
  assert.equal(result.critical[0].reason, "latest-items-invalid");
});

test("production monitor validates response headers and deployment manifest", () => {
  const contract = inspectResponseContract({ pathname: "/latest.json", status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" }, body: "{}" });
  assert.deepEqual(contract.critical, []);
  assert.deepEqual(inspectDeploymentPayload({ version: 1, builtAt: "2026-08-13T00:00:00.000Z", sourceCommit: "abcdef1", latestDate: "2026-08-13", publicArticleCount: 1, searchCount: 1, sitemapCount: 5 }).critical, []);
});

test("deployment verifier detects a live site that is behind the expected build", () => {
  const expected = { version: 1, sourceCommit: "abcdef1", latestDate: "2026-08-13", publicArticleCount: 10, searchCount: 10, sitemapCount: 20 };
  const actual = { ...expected, sourceCommit: "1234567", latestDate: "2026-08-08" };
  const result = compareDeploymentPayload(actual, expected);
  assert.deepEqual(result.critical.map((item) => item.reason), ["deployment-sourceCommit-mismatch", "deployment-latestDate-mismatch"]);
});

test("production monitor checks representative article trust signals", () => {
  const html = '<link rel="canonical" href="https://news.vetmanlab.com/article/one"><meta name="robots" content="index, follow"><h1>기사</h1><script type="application/ld+json">{"@type":"NewsArticle"}</script>';
  const result = inspectArticleHtml(html, "https://news.vetmanlab.com/article/one");
  assert.deepEqual(result.critical, []);
  assert.deepEqual(result.jsonLdTypes, ["NewsArticle"]);
});
