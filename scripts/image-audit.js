import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSourceUrl } from "../src/identity.js";
import { cleanImageUrl, imageKey } from "../src/images.js";
import { isProfessionallyIndexable, qualityIssues } from "../src/lib/quality.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, "data", "issues");
const SITE_DIR = path.join(ROOT, "site");
const JSON_FILE = path.join(ROOT, "reports", "image-audit.json");
const MD_FILE = path.join(ROOT, "reports", "image-audit.md");
const SITE_ORIGIN = "https://news.vetmanlab.com";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadItems() {
  const files = (await fs.readdir(DATA_DIR)).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort().reverse();
  const items = [];
  for (const file of files) {
    const issue = JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8"));
    for (const [index, item] of (issue.items || []).entries()) items.push({ file, index, item });
  }
  return items;
}

function imageRefs(item) {
  return [item.imageUrl, ...(Array.isArray(item.imageUrls) ? item.imageUrls : []), item.imageSquareUrl, item.imageLandscapeUrl, item.imageWideUrl].filter(Boolean);
}

function dimensions(item) {
  const width = Number(item.imageWidth) || null;
  const height = Number(item.imageHeight) || null;
  return { width, height, ratio: width && height ? Number((width / height).toFixed(3)) : null };
}

async function inspectUrl(url) {
  try {
    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "user-agent": "VetManLab-image-audit/1.0 (+https://news.vetmanlab.com/about)" },
      signal: AbortSignal.timeout(7000),
    });
    return {
      status: response.status,
      ok: response.ok,
      finalUrl: response.url,
      contentType: response.headers.get("content-type"),
      bytes: Number(response.headers.get("content-length")) || null,
      failure: response.ok ? null : `http-${response.status}`,
    };
  } catch (error) {
    return { status: null, ok: false, finalUrl: null, contentType: null, bytes: null, failure: error.name === "TimeoutError" ? "timeout" : error.code || "request-failed" };
  }
}

function htmlFiles(dir) {
  if (!fsSync.existsSync(dir)) return [];
  const result = [];
  for (const entry of fsSync.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...htmlFiles(full));
    else if (entry.name.endsWith(".html")) result.push(full);
  }
  return result;
}

async function main() {
  const items = await loadItems();
  const generatedIndexIds = fsSync.existsSync(path.join(SITE_DIR, "search.json"))
    ? new Set(JSON.parse(fsSync.readFileSync(path.join(SITE_DIR, "search.json"), "utf8")).items.map((item) => item.id).filter(Boolean))
    : new Set();
  const seen = new Set();
  const annotated = items.map((record) => {
    const source = normalizeSourceUrl(record.item.finalUrl || record.item.sourceUrl || record.item.sourceUrlRaw || "");
    const duplicate = Boolean(source && seen.has(source));
    if (source) seen.add(source);
    const qualityIndexable = isProfessionallyIndexable(record.item, { duplicate });
    const generatedKey = record.item.id || `${record.file.replace(/\.json$/, "")}_${record.index + 1}`;
    const indexable = generatedIndexIds.size ? generatedIndexIds.has(generatedKey) : qualityIndexable;
    const refs = imageRefs(record.item);
    return { ...record, indexable, duplicate, refs, issues: qualityIssues(record.item) };
  });
  const refs = new Map();
  for (const record of annotated) for (const raw of record.refs) {
    const normalized = cleanImageUrl(raw);
    const key = imageKey(normalized || raw) || raw;
    if (!refs.has(key)) refs.set(key, { key, raw, normalized, items: [] });
    refs.get(key).items.push({ file: record.file, index: record.index, id: record.item.id || null, title: record.item.titleKo || null, indexable: record.indexable });
  }
  const queue = [...refs.values()];
  const worker = async () => {
    while (queue.length) {
      const ref = queue.shift();
      ref.response = ref.normalized ? await inspectUrl(ref.normalized) : { failure: "invalid-url", ok: false };
      await sleep(180);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));

  const indexItems = annotated.filter((record) => record.indexable);
  const imageItems = annotated.filter((record) => record.refs.length > 0);
  const external = [...refs.values()].filter((ref) => /^https?:\/\//i.test(ref.raw));
  const http = external.filter((ref) => /^http:\/\//i.test(ref.raw));
  const https = external.filter((ref) => /^https:\/\//i.test(ref.raw));
  const failed = external.filter((ref) => !ref.response?.ok);
  const missingAlt = annotated.filter((record) => record.refs.length && !record.item.imageAlt);
  const missingCaption = annotated.filter((record) => record.refs.length && !record.item.imageCaption);
  const missingCredit = annotated.filter((record) => record.refs.length && !record.item.imageCredit);
  const missingLicense = annotated.filter((record) => record.refs.length && !record.item.imageLicense);
  const dupes = [...refs.values()].filter((ref) => ref.items.length > 1);
  const siteHtml = htmlFiles(SITE_DIR);
  const articleHtml = siteHtml.filter((file) => file.includes(`${path.sep}article${path.sep}`));
  const ogFallbackUses = articleHtml.filter((file) => {
    const html = fsSync.readFileSync(file, "utf8");
    return /<meta[^>]+property=["']og:image["'][^>]+content=["'][^"']*\/og\.png/i.test(html);
  }).length;
  const ogFallbackIndexUses = articleHtml.filter((file) => {
    const html = fsSync.readFileSync(file, "utf8");
    return !/<meta[^>]+name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(html) && /<meta[^>]+property=["']og:image["'][^>]+content=["'][^"']*\/og\.png/i.test(html);
  }).length;
  const generatedCards = fsSync.existsSync(path.join(ROOT, "assets", "media", "editorial"))
    ? fsSync.readdirSync(path.join(ROOT, "assets", "media", "editorial")).filter((file) => file.endsWith(".webp")).length
    : 0;

  const report = {
    generatedAt: new Date().toISOString(),
    totals: { articles: annotated.length, index: indexItems.length, noindex: annotated.length - indexItems.length, indexImageMissingRaw: indexItems.filter((record) => !record.refs.length).length, rawImageItems: imageItems.length },
    imageReferences: { total: [...refs.values()].reduce((sum, ref) => sum + ref.items.length, 0), unique: refs.size, external: external.length, http: http.length, https: https.length, local: refs.size - external.length, failed: failed.length },
    metadata: { missingAlt: missingAlt.length, missingCaption: missingCaption.length, missingCredit: missingCredit.length, missingLicense: missingLicense.length, dimensionsKnown: annotated.filter((record) => record.refs.length && dimensions(record.item).width && dimensions(record.item).height).length },
    duplicates: dupes.map((ref) => ({ url: ref.raw, count: ref.items.length, items: ref.items })),
    generatedEditorialCards: generatedCards,
    ogFallbackUses,
    ogFallbackIndexUses,
    urls: [...refs.values()],
    indexImageMissing: indexItems.filter((record) => !record.refs.length).map((record) => ({ file: record.file, index: record.index, id: record.item.id || null, title: record.item.titleKo || null, sourceLabel: record.item.sourceLabel || null, sourceUrl: record.item.sourceUrl || null, issues: record.issues })),
  };
  await fs.mkdir(path.dirname(JSON_FILE), { recursive: true });
  await fs.writeFile(JSON_FILE, JSON.stringify(report, null, 2) + "\n");
  const md = `# 이미지 정밀 감사\n\n생성 시각: ${report.generatedAt}\n\n## 요약\n\n|항목|수량|\n|---|---:|\n|전체 기사|${report.totals.articles}|\n|index 기사|${report.totals.index}|\n|noindex 기사|${report.totals.noindex}|\n|index 기사 중 원본 이미지 없음|${report.totals.indexImageMissingRaw}|\n|원본 이미지가 있는 기사|${report.totals.rawImageItems}|\n|고유 이미지 URL|${report.imageReferences.unique}|\n|외부 이미지|${report.imageReferences.external}|\n|HTTP 원본|${report.imageReferences.http}|\n|HTTPS 원본|${report.imageReferences.https}|\n|응답 실패 또는 HEAD 불가|${report.imageReferences.failed}|\n|생성 편집 카드|${report.generatedEditorialCards}|\n|기사 OG 공통 폴백 사용|${report.ogFallbackUses}|\n\n## 메타데이터 누락\n\n- alt 누락: ${report.metadata.missingAlt}건\n- caption 누락: ${report.metadata.missingCaption}건\n- credit 누락: ${report.metadata.missingCredit}건\n- license 누락: ${report.metadata.missingLicense}건\n- 원본 width/height 확인: ${report.metadata.dimensionsKnown}건\n\n## 해석\n\n기존 외부 이미지는 권리 확인 없이 다운로드·재배포하지 않았습니다. HTTP 이미지는 사용 시 HTTPS 정규화 대상이며, 응답 실패는 원본 데이터에서 삭제하지 않고 warning으로 남겼습니다. index 기사에서 원본 이미지가 없는 항목은 자체 제작 편집 카드로 보완하고, noindex brief에는 카드를 강제하지 않습니다. 동일 이미지 ${report.duplicates.length}개 그룹은 중복 출처 여부를 사람이 확인해야 합니다.\n\n상세 URL·응답·index 누락 목록은 \`reports/image-audit.json\`에 있습니다.\n`;
  await fs.writeFile(MD_FILE, md);
  console.log(`이미지 감사 완료: ${report.totals.articles}개 기사 · index 이미지 누락 ${report.totals.indexImageMissingRaw}개 · 고유 이미지 ${report.imageReferences.unique}개 · 실패 ${report.imageReferences.failed}개`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
