import test from "node:test";
import assert from "node:assert/strict";
import { buildImageRightsQueue, validImageDecision } from "../src/lib/image-rights-queue.js";

test("image rights queue prioritizes indexable unknown external images", () => {
  const rows = buildImageRightsQueue({
    articles: [
      { id: "no", titleKo: "비색인", imageUrl: "https://example.com/no.jpg" },
      { id: "yes", titleKo: "색인", imageUrl: "https://example.com/yes.jpg" },
      { id: "owned", imageUrl: "https://example.com/owned.jpg", imageOwnership: "owned" },
    ],
    indexIds: ["yes", "owned"],
  });
  assert.equal(rows[0].id, "yes");
  assert.equal(rows[0].status, "pending");
  assert.equal(rows.some((row) => row.id === "owned"), false);
});

test("licensed image decision requires proof", () => {
  assert.equal(validImageDecision({ status: "approved", ownership: "licensed" }), false);
  assert.equal(validImageDecision({ status: "approved", ownership: "licensed", licenseUrl: "https://example.com/license" }), true);
  assert.equal(validImageDecision({ status: "rejected", reason: "권리 확인 불가" }), true);
});
