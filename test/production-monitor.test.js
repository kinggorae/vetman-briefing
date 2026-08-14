import test from "node:test";
import assert from "node:assert/strict";
import {
  calendarAgeDays,
  compareDeploymentPayload,
  inspectArchivePayload,
  inspectArticleHtml,
  inspectDeploymentPayload,
  inspectHomepageHtml,
  inspectLatestPayload,
  inspectNewsSitemap,
  inspectResponseContract,
  inspectSearchManifest,
  inspectSearchPayload,
  inspectServiceWorker,
  recentIndexableNewsCount,
} from "../src/lib/production-monitor.js";

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

test("production monitor enforces today's 30-item edition after the cutoff", () => {
  const result = inspectLatestPayload(
    { date: "2026-08-13", count: 2, items: [{ id: "one" }, { id: "two" }] },
    { today: "2026-08-14", minItems: 30, requireToday: true },
  );
  assert.deepEqual(result.critical.map((item) => item.reason), ["latest-not-today", "latest-below-minimum"]);
});

test("production monitor checks static homepage edition and crawl paths", () => {
  const items = Array.from({ length: 30 }, (_, index) => ({ id: `item-${index}` }));
  const html = [
    '<main id="main-content"><h1>오늘의 브리핑</h1>',
    '<a href="/archive/">지난 브리핑</a>',
    '<a href="/article/item-0">기사</a>',
    '<script type="application/ld+json">{"potentialAction":{"@type":"SearchAction"}}</script>',
    `<script id="vm-issue" type="application/json">${JSON.stringify({ count: 30, articles: items.slice(0, 4), briefs: items.slice(4) })}</script>`,
    "</main>",
  ].join("");
  const result = inspectHomepageHtml(html, { minEditionItems: 30 });
  assert.deepEqual(result.critical, []);
  assert.equal(result.editionCount, 30);
  assert.equal(result.staticItemCount, 30);
  assert.equal(result.articleLinks, 1);
});

test("production monitor checks search, archive, and service-worker contracts", () => {
  const search = inspectSearchPayload({ count: 2, items: [{ id: "one", url: "/article/one" }, { id: "two", url: "/article/two" }] });
  assert.deepEqual(search.critical, []);
  assert.deepEqual(inspectSearchManifest({ count: 2, chunks: [{ key: "a", href: "/search/a.json", count: 2 }] }, 2).critical, []);
  assert.deepEqual(inspectArchivePayload({ issues: [{ date: "2026-08-14" }], weeklies: [{ week: "2026-W33" }] }).critical, []);

  const serviceWorker = [
    "const C='vmcache-v8';",
    "const SHELL=['/','/latest.json','/archive.json','/search-manifest.json'];",
    "self.addEventListener('fetch',function(){});",
  ].join("\n");
  assert.deepEqual(inspectServiceWorker(serviceWorker), { cache: "vmcache-v8", critical: [] });
});

test("production monitor validates response headers and deployment manifest", () => {
  const contract = inspectResponseContract({ pathname: "/latest.json", status: 200, headers: { "content-type": "application/json", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" }, body: "{}" });
  assert.deepEqual(contract.critical, []);
  assert.deepEqual(inspectDeploymentPayload({ version: 1, builtAt: "2026-08-13T00:00:00.000Z", sourceCommit: "abcdef1", latestDate: "2026-08-13", publicArticleCount: 1, searchCount: 1, sitemapCount: 5, newsSitemapCount: 1 }).critical, []);
});

test("production monitor rejects an invalid news sitemap count", () => {
  const result = inspectDeploymentPayload({ version: 1, builtAt: "2026-08-13T00:00:00.000Z", sourceCommit: "abcdef1", latestDate: "2026-08-13", publicArticleCount: 1, searchCount: 1, sitemapCount: 5, newsSitemapCount: -1 });
  assert.ok(result.critical.some((item) => item.reason === "deployment-newsSitemapCount-invalid"));
});

test("production monitor only counts recent indexable latest items for an empty news sitemap", () => {
  const items = [
    { publicationStatus: "index-analysis", firstPublishedAt: "2026-08-14T01:00:00Z" },
    { publicationStatus: "index-low-risk", firstPublishedAt: "2026-08-10T01:00:00Z" },
    { publicationStatus: "public-brief", firstPublishedAt: "2026-08-14T01:00:00Z" },
  ];
  assert.equal(recentIndexableNewsCount(items, { now: "2026-08-14T02:00:00Z", maxAgeDays: 2 }), 1);
});

test("news sitemap contract validates namespace and live URL count", () => {
  const valid = '<?xml version="1.0"?><urlset xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"><url><loc>https://news.vetmanlab.com/article/one</loc></url></urlset>';
  assert.deepEqual(inspectNewsSitemap(valid, 1), { urlCount: 1, critical: [] });
  assert.equal(inspectNewsSitemap(valid, 2).critical[0].reason, "news-sitemap-count-mismatch");
  assert.equal(inspectNewsSitemap("<urlset></urlset>", 0).critical[0].reason, "news-sitemap-namespace-missing");
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
