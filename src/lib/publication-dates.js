const DAY_MS = 24 * 60 * 60 * 1000;

export function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// publishedAt is the source article's date in the source-first pipeline.
// firstPublishedAt is the date this site first exposed the article. Search
// engines need the latter for NewsArticle, RSS, and the Google News sitemap.
export function sitePublicationDate(item = {}, issuePublishedAt = null) {
  return isoDate(item.firstPublishedAt) || isoDate(item.publishedAt) || isoDate(issuePublishedAt);
}

export function recentNewsEntries(entries = [], { now = Date.now(), maxAgeDays = 2, maxEntries = 1000 } = {}) {
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) return [];
  const cutoff = nowMs - maxAgeDays * DAY_MS;
  return entries
    .filter((entry) => {
      const timestamp = Date.parse(entry?.publishedAt || "");
      return Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= nowMs;
    })
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
    .slice(0, maxEntries);
}
