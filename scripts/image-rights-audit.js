import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isExternalImage, normalizeImageOwnership } from "../src/lib/image-rights.js";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUE_DIR = path.join(ROOT, "data", "issues");
const SITE = path.join(ROOT, "site");
const RELAY = /^https?:\/\/(?:news\.)?google\.[^/]+\/rss\/articles\//i;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const files = (await fs.readdir(ISSUE_DIR)).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort();
const search = await fs.readFile(path.join(SITE, "search.json"), "utf8").then(JSON.parse).catch(() => ({ items: [] }));
const indexIds = new Set((search.items || []).map((item) => item.id));
const records = [];
for (const file of files) {
  const issue = JSON.parse(await fs.readFile(path.join(ISSUE_DIR, file), "utf8"));
  for (const [index, item] of (issue.items || []).entries()) {
    const id = item.id || `${issue.date}_${index + 1}`;
    const url = item.imageUrl || null;
    const origin = item.imageOrigin || (url ? "external-source" : null);
    const ownership = normalizeImageOwnership(item.imageOwnership, { hasImage: Boolean(url), origin });
    const external = isExternalImage(url);
    const card = indexIds.has(id) && !url ? `/media/editorial/${id}.webp` : indexIds.has(id) && ownership === "unknown" ? `/media/editorial/${id}.webp` : null;
    records.push({ id, file, index, title: item.titleKo || null, indexable: indexIds.has(id), rawUrl: url, sourceUrl: item.imageSourceUrl || url || null, origin, ownership, effectiveImage: card || url || "/og.png", effectiveOwnership: card ? "owned" : url ? ownership : "site-fallback", imageAlt: item.imageAlt || null, imageCredit: item.imageCredit || null, imageLicense: item.imageLicense || null, imageLicenseUrl: item.imageLicenseUrl || null, imageWidth: Number(item.imageWidth) || null, imageHeight: Number(item.imageHeight) || null, sourceUrlRaw: item.sourceUrlRaw || item.sourceUrl || null, relaySource: RELAY.test(item.sourceUrlRaw || item.sourceUrl || "") });
  }
}
const externalRows = records.filter((row) => row.rawUrl && isExternalImage(row.rawUrl));
const pending = [...externalRows];
const checkWorker = async () => { while (pending.length) { const row = pending.shift(); try {
  const response = await fetch(row.rawUrl, { method: "HEAD", redirect: "follow", headers: { "user-agent": "VetManLab-image-rights-audit/3.0 (+https://news.vetmanlab.com/about)" }, signal: AbortSignal.timeout(2500) });
  row.http = { status: response.status, ok: response.ok, finalUrl: response.url, mimeType: response.headers.get("content-type"), contentLength: response.headers.get("content-length") ? Number(response.headers.get("content-length")) : null };
} catch (error) { row.http = { status: null, ok: false, error: error.name === "TimeoutError" ? "timeout" : error.code || "request-failed" }; } await sleep(30); } };
await Promise.all(Array.from({ length: 6 }, checkWorker));
const counts = (key) => Object.fromEntries([...new Set(records.map((row) => row[key] || "none"))].sort().map((value) => [value, records.filter((row) => (row[key] || "none") === value).length]));
const duplicateMap = new Map(); for (const row of externalRows) duplicateMap.set(row.rawUrl, (duplicateMap.get(row.rawUrl) || 0) + 1);
for (const row of records) row.duplicateCount = row.rawUrl ? duplicateMap.get(row.rawUrl) || 1 : 0;
const result = { generatedAt: new Date().toISOString(), totalArticles: records.length, indexArticles: records.filter((row) => row.indexable).length, indexImages: records.filter((row) => row.indexable && row.effectiveImage !== "/og.png").length, indexExternalRaw: records.filter((row) => row.indexable && row.rawUrl && isExternalImage(row.rawUrl)).length, indexEditorialCards: records.filter((row) => row.indexable && row.effectiveOwnership === "owned" && row.effectiveImage.startsWith("/media/editorial/")).length, unknownRawExternal: records.filter((row) => row.rawUrl && isExternalImage(row.rawUrl) && row.ownership === "unknown").length, unclassifiedEffectiveIndex: records.filter((row) => row.indexable && !row.effectiveOwnership).length, ownershipCounts: counts("ownership"), effectiveOwnershipCounts: counts("effectiveOwnership"), originCounts: counts("origin"), protocolCounts: { http: externalRows.filter((row) => /^http:\/\//i.test(row.rawUrl)).length, https: externalRows.filter((row) => /^https:\/\//i.test(row.rawUrl)).length }, responseCounts: Object.fromEntries(["ok","failed","unknown"].map((key) => [key, externalRows.filter((row) => key === "unknown" ? !row.http?.status : key === "ok" ? row.http?.ok : row.http?.status && !row.http.ok).length])), uniqueExternalUrls: duplicateMap.size, duplicatedExternalUrls: [...duplicateMap.values()].filter((count) => count > 1).length, fallbackOg: records.filter((row) => row.effectiveImage === "/og.png").length, rows: records };
await fs.mkdir(path.join(ROOT, "reports"), { recursive: true });
await fs.writeFile(path.join(ROOT, "reports", "image-rights-audit.json"), JSON.stringify(result, null, 2) + "\n");
const md = [`# 이미지 권리 감사`, ``, `- 전체 기사: ${result.totalArticles}`, `- index 기사: ${result.indexArticles}`, `- index 대표 이미지: ${result.indexImages}/${result.indexArticles}`, `- index 외부 원본: ${result.indexExternalRaw}개 (권리 불명 원본은 복제하지 않고 카드로 대체)`, `- index 자체 편집 카드: ${result.indexEditorialCards}개`, `- 원본 외부 이미지 unknown: ${result.unknownRawExternal}개`, `- index 유효 이미지 권리 미분류: ${result.unclassifiedEffectiveIndex}개`, `- HTTP/HTTPS: ${result.protocolCounts.http}/${result.protocolCounts.https}`, `- 외부 응답: ${JSON.stringify(result.responseCounts)}`, `- 동일 외부 이미지 URL 중복: ${result.duplicatedExternalUrls}개`, `- 공통 og.png 폴백: ${result.fallbackOg}개`, ``, `## 권리 상태`, ``, ...Object.entries(result.ownershipCounts).map(([key, value]) => `- ${key}: ${value}`), ``, `## 조치`, ``, `권리 상태가 확인되지 않은 외부 이미지는 원본 URL·출처 정보를 보존하고, index 기사 화면과 공유 메타에서는 기사별 자체 편집 카드로 대체했습니다. 외부 이미지를 다운로드하거나 자체 호스팅하지 않았습니다.`];
await fs.writeFile(path.join(ROOT, "reports", "image-rights-audit.md"), md.join("\n") + "\n");
console.log(`이미지 권리 감사: ${result.totalArticles}개 · index ${result.indexImages}/${result.indexArticles} · 카드 ${result.indexEditorialCards} · unknown 원본 ${result.unknownRawExternal}`);
