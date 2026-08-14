function itemKey(item) {
  return String(item?.id || item?.href || item?.url || "").trim();
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function payloadKeys(payload) {
  return Array.isArray(payload?.items) ? payload.items.map(itemKey) : [];
}

function duplicateKeys(keys) {
  const counts = new Map();
  for (const key of keys.filter(Boolean)) counts.set(key, (counts.get(key) || 0) + 1);
  return uniqueSorted([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
}

function payloadIssues(payload, label) {
  const issues = [];
  if (!Array.isArray(payload?.items)) {
    issues.push({ reason: `${label}-items-invalid` });
    return issues;
  }

  const keys = payloadKeys(payload);
  const missing = payload.items.reduce((count, item) => count + (itemKey(item) ? 0 : 1), 0);
  if (missing) issues.push({ reason: `${label}-item-key-missing`, count: missing });

  const duplicates = duplicateKeys(keys);
  if (duplicates.length) issues.push({ reason: `${label}-duplicate-ids`, ids: duplicates.slice(0, 20), count: duplicates.length });

  if (Number.isInteger(payload.count) && payload.count !== payload.items.length) {
    issues.push({ reason: `${label}-count-mismatch`, declared: payload.count, actual: payload.items.length });
  }
  return issues;
}

export function extractSearchKeys(payload = {}) {
  return uniqueSorted(payloadKeys(payload).filter(Boolean));
}

export function inspectRetention(previousPayload = {}, currentPayload = {}, { allowRemovals = [] } = {}) {
  const previousKeys = extractSearchKeys(previousPayload);
  const currentKeys = extractSearchKeys(currentPayload);
  const previousSet = new Set(previousKeys);
  const currentSet = new Set(currentKeys);
  const allowedSet = new Set(allowRemovals.map((value) => String(value || "").trim()).filter(Boolean));
  const removed = previousKeys.filter((key) => !currentSet.has(key));
  const added = currentKeys.filter((key) => !previousSet.has(key));
  const allowedRemoved = removed.filter((key) => allowedSet.has(key));
  const unexpectedRemoved = removed.filter((key) => !allowedSet.has(key));
  const critical = [
    ...payloadIssues(previousPayload, "previous"),
    ...payloadIssues(currentPayload, "current"),
  ];

  if (unexpectedRemoved.length) {
    critical.push({
      reason: "public-article-removed",
      count: unexpectedRemoved.length,
      ids: unexpectedRemoved.slice(0, 50),
    });
  }

  return {
    previousCount: previousKeys.length,
    currentCount: currentKeys.length,
    added,
    removed,
    allowedRemoved,
    unexpectedRemoved,
    critical,
  };
}
