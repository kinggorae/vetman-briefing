import test from "node:test";
import assert from "node:assert/strict";
import { recentNewsEntries, sitePublicationDate } from "../src/lib/publication-dates.js";

test("site publication date prefers the first date on this site", () => {
  assert.equal(
    sitePublicationDate({ firstPublishedAt: "2026-08-14T02:00:00Z", publishedAt: "2026-08-01T02:00:00Z" }, "2026-08-14T03:00:00Z"),
    "2026-08-14T02:00:00.000Z",
  );
});

test("news window excludes old and future publication dates", () => {
  const entries = [
    { id: "current", publishedAt: "2026-08-14T01:00:00Z" },
    { id: "old", publishedAt: "2026-08-11T23:59:59Z" },
    { id: "future", publishedAt: "2026-08-14T04:00:00Z" },
  ];
  assert.deepEqual(
    recentNewsEntries(entries, { now: "2026-08-14T02:00:00Z" }).map((entry) => entry.id),
    ["current"],
  );
});
