export function buildIngestProgress({
  date = null,
  startedAt = null,
  updatedAt = new Date().toISOString(),
  status = "preparing",
  selected = 0,
  completed = 0,
  generated = 0,
  generationFailed = 0,
  checkpointFile = null,
  error = null,
} = {}) {
  const selectedCount = Math.max(0, Number(selected) || 0);
  const completedCount = Math.max(0, Number(completed) || 0);

  return {
    version: 1,
    date,
    startedAt,
    updatedAt,
    status,
    selected: selectedCount,
    completed: completedCount,
    generated: Math.max(0, Number(generated) || 0),
    generationFailed: Math.max(0, Number(generationFailed) || 0),
    remaining: Math.max(0, selectedCount - completedCount),
    checkpointFile,
    error: error ? String(error) : null,
  };
}

export function renderIngestProgress(progress) {
  const error = progress.error ? `\n- error: ${progress.error}` : "";
  return [
    `# Ingest progress (${progress.date || "unknown"})`,
    "",
    `- status: ${progress.status}`,
    `- started: ${progress.startedAt || "unknown"}`,
    `- updated: ${progress.updatedAt || "unknown"}`,
    `- selected: ${progress.selected}`,
    `- completed: ${progress.completed}`,
    `- remaining: ${progress.remaining}`,
    `- generated: ${progress.generated}`,
    `- generation failed: ${progress.generationFailed}`,
    `- checkpoint: ${progress.checkpointFile || "none"}`,
    error,
    "",
  ].join("\n");
}
