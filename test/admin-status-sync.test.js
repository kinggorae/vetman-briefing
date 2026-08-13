import test from "node:test";
import assert from "node:assert/strict";
import { syncAdminStatus } from "../src/lib/admin-status-sync.js";

test("admin status sync replaces both operational snapshots without dropping the report", () => {
  const admin = { generatedAt: "build-time", rows: [{ id: "a" }], operationsStatus: { generatedAt: "old" } };
  const operations = { generatedAt: "new-ops", publication: { index: 1 } };
  const images = { generatedAt: "new-images", rows: [{ id: "a" }] };
  const work = { generatedAt: "new-work", count: 2, rows: [{ id: "task" }] };
  const next = syncAdminStatus(admin, operations, images, work, "sync-time");
  assert.equal(next.generatedAt, "build-time");
  assert.deepEqual(next.rows, [{ id: "a" }]);
  assert.equal(next.operationsStatus.generatedAt, "new-ops");
  assert.equal(next.imageRightsQueue.generatedAt, "new-images");
  assert.equal(next.workQueue.generatedAt, "new-work");
  assert.equal(next.statusSyncedAt, "sync-time");
});

test("admin status sync fails closed when a source snapshot is missing", () => {
  assert.throws(() => syncAdminStatus({ generatedAt: "build" }, {}, { generatedAt: "images" }, { generatedAt: "work" }), /operations-status/);
});
