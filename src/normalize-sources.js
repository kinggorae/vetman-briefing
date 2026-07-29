// Google News/추적 URL을 가능한 경우 최종 출판사 URL로 바꾸는 일회성 정규화 도구.
// 기본은 dry-run이며 --apply를 명시해야 data/issues를 변경한다.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSourceUrl } from "./identity.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, "data", "issues");
const CACHE_FILE = path.join(ROOT, "data", "source-resolutions.json");
const APPLY = process.argv.includes("--apply");
const isGoogleNews = (url) => /^https?:\/\/(?:news\.)?google\.[^/]+\/rss\/articles\//i.test(String(url || ""));

async function resolveUrl(raw) {
  try {
    const response = await fetch(raw, {
      redirect: "follow",
      headers: { "user-agent": "VetManLab-source-normalizer/1.0", accept: "text/html,*/*" },
      signal: AbortSignal.timeout(10000),
    });
    const finalUrl = normalizeSourceUrl(response.url || "");
    if (finalUrl && !isGoogleNews(finalUrl)) return finalUrl;
    const html = await response.text();
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)/i)?.[1];
    const canonicalUrl = normalizeSourceUrl(canonical || "");
    return canonicalUrl && !isGoogleNews(canonicalUrl) ? canonicalUrl : null;
  } catch {
    return null;
  }
}

async function main() {
  const cache = await fs.readFile(CACHE_FILE, "utf8").then(JSON.parse).catch(() => ({}));
  const files = (await fs.readdir(DATA_DIR)).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file));
  const seen = new Map();
  for (const file of files) {
    const full = path.join(DATA_DIR, file);
    const issue = JSON.parse(await fs.readFile(full, "utf8"));
    for (const item of issue.items || []) {
      const raw = item.sourceUrlRaw || item.sourceUrl;
      if (!raw || !isGoogleNews(raw)) continue;
      if (!seen.has(raw)) seen.set(raw, item.sourceUrl);
    }
  }

  const results = { ...cache };
  let resolved = 0;
  let unchanged = 0;
  let failed = 0;
  const queue = [...seen.keys()];
  async function worker() {
    while (queue.length) {
      const raw = queue.shift();
      if (results[raw]) continue;
      const finalUrl = await resolveUrl(raw);
      results[raw] = finalUrl ? { finalUrl, status: "resolved" } : { finalUrl: null, status: "unresolved" };
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  if (APPLY) {
    for (const file of files) {
      const full = path.join(DATA_DIR, file);
      const issue = JSON.parse(await fs.readFile(full, "utf8"));
      let changed = false;
      for (const item of issue.items || []) {
        const raw = item.sourceUrlRaw || item.sourceUrl;
        const record = results[raw];
        if (!record) continue;
        if (!item.sourceUrlRaw && item.sourceUrl) item.sourceUrlRaw = item.sourceUrl;
        if (record.finalUrl && item.sourceUrl !== record.finalUrl) {
          item.sourceUrl = record.finalUrl;
          item.finalUrl = record.finalUrl;
          changed = true;
        }
      }
      if (changed) await fs.writeFile(full, JSON.stringify(issue, null, 2) + "\n");
    }
    await fs.writeFile(CACHE_FILE, JSON.stringify(results, null, 2) + "\n");
  }

  for (const [raw, current] of seen) {
    const record = results[raw];
    if (record?.finalUrl && record.finalUrl !== current) resolved++;
    else if (record?.status === "unresolved") failed++;
    else unchanged++;
  }
  console.log(`${APPLY ? "적용" : "검토"}: Google News ${seen.size}건 · 최종 URL ${resolved}건 · 미해결 ${failed}건 · 변경 없음 ${unchanged}건`);
  if (!APPLY) console.log("실제 저장은 node src/normalize-sources.js --apply 로 실행합니다.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
