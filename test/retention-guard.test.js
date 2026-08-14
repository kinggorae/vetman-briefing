import test from "node:test";
import assert from "node:assert/strict";
import { extractSearchKeys, inspectRetention } from "../src/lib/retention-guard.js";

const payload = (ids, count = ids.length) => ({ count, items: ids.map((id) => ({ id })) });

test("retention guard accepts additions without changing existing public IDs", () => {
  const result = inspectRetention(payload(["a", "b"]), payload(["a", "b", "c"]));
  assert.deepEqual(result.added, ["c"]);
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.critical, []);
});

test("retention guard fails when a previously public article disappears", () => {
  const result = inspectRetention(payload(["a", "b", "c"]), payload(["a", "c"]));
  assert.deepEqual(result.unexpectedRemoved, ["b"]);
  assert.equal(result.critical[0].reason, "public-article-removed");
});

test("retention guard supports an explicit removal allowlist", () => {
  const result = inspectRetention(payload(["a", "b"]), payload(["a"]), { allowRemovals: ["b"] });
  assert.deepEqual(result.allowedRemoved, ["b"]);
  assert.deepEqual(result.unexpectedRemoved, []);
  assert.deepEqual(result.critical, []);
});

test("retention guard detects duplicate or malformed search entries", () => {
  const result = inspectRetention(
    { count: 2, items: [{ id: "a" }, { id: "a" }] },
    { count: 1, items: [{ title: "missing id" }] },
  );
  assert.ok(result.critical.some((item) => item.reason === "previous-duplicate-ids"));
  assert.ok(result.critical.some((item) => item.reason === "current-item-key-missing"));
});

test("retention guard extracts stable key fallbacks", () => {
  assert.deepEqual(extractSearchKeys({ items: [{ href: "/a" }, { url: "https://example.test/b" }, {}] }), ["/a", "https://example.test/b"]);
});
