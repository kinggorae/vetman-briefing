import test from "node:test";
import assert from "node:assert/strict";
import { buildIngestProgress, renderIngestProgress } from "../src/lib/ingest-progress.js";

test("ingest progress reports remaining work and checkpoint metadata", () => {
  const progress = buildIngestProgress({
    date: "2026-08-13",
    startedAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T00:10:00.000Z",
    status: "generating",
    selected: 36,
    completed: 11,
    generated: 8,
    generationFailed: 3,
    checkpointFile: "data/drafts/source-first-2026-08-13.json",
  });

  assert.equal(progress.remaining, 25);
  assert.equal(progress.generationFailed, 3);
  assert.match(renderIngestProgress(progress), /source-first-2026-08-13\.json/);
});

test("ingest progress clamps invalid counters to safe values", () => {
  const progress = buildIngestProgress({ selected: -1, completed: -4, generated: "bad" });

  assert.equal(progress.selected, 0);
  assert.equal(progress.completed, 0);
  assert.equal(progress.generated, 0);
  assert.equal(progress.remaining, 0);
});
