import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { readJson, atomicWrite } from "../src/lib/source-first.js";
import { contentHash } from "../src/lib/editorial-operations.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ORIGIN = "https://news.vetmanlab.com";
const ISSUE_DIR = path.join(ROOT, "data", "issues");
const LANGUAGE_AUDIT = path.join(ROOT, "reports", "language-audit.json");
const CLAIM_AUDIT = path.join(ROOT, "reports", "claims-audit.json");
const TERMINOLOGY = path.join(ROOT, "data", "editorial", "terminology.json");
const KNOWN = ["병원ugeom", "강아지 주인의 위한", "무뎌지", "원-health", "조객 참여", "백식", "백석", "각제", "수아지"];
const SAFE_REPLACEMENTS = new Map([
  ["병원ugeom", { suggestion: "병원 경험", classification: "typo", confidence: 0.99, changesMeaning: false, requiresHumanReview: false, resolution: "auto-applied" }],
  ["조객 참여", { suggestion: "조류 관찰자 참여", classification: "terminology", confidence: 0.97, changesMeaning: false, requiresHumanReview: false, resolution: "auto-applied" }],
  ["라신County", { suggestion: "라신 카운티", classification: "spacing", confidence: 0.99, changesMeaning: false, requiresHumanReview: false, resolution: "auto-applied" }],
]);
const COMMON_ACRONYMS = new Set(["AI", "API", "CBC", "CGM", "CT", "DNA", "DOI", "ETCO2", "FDA", "FIV", "GP", "H5N1", "HCT", "IDEXX", "ILE", "IU", "KPI", "mL", "MRI", "NSAID", "PIMS", "PLE", "RSS", "SII", "STT", "TTA", "WHO", "X-ray"]);
const PRE_CORRECTION_LANGUAGE_ROWS = [
  { date: "2026-07-22", title: "라신County 박쥐에서 광견병 양성 확인...주의 필요", warnings: ["korean-internal-ascii"] },
  { date: "2026-07-22", title: "연기 피해를 입은 비둘기, 소장관에게 도움 요청", warnings: ["korean-internal-ascii"] },
  { id: "v1_5ef792dba5c1c590", date: "2026-07-29", title: "수의 임상 인력 채용·유지 전략", warnings: ["korean-internal-ascii", "known-error:병원ugeom"] },
  { id: "v1_aa6becfdbbcbbfdd", date: "2026-07-29", title: "사우스오스트레일리아, 조객 참여 조류인플루엔자 대응 훈련 프로그램 추진", warnings: ["known-error:조객 참여"] },
];

function issueRows() {
  const rows = [];
  for (const file of fs.readdirSync(ISSUE_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))) {
    const data = readJson(path.join(ISSUE_DIR, file), {});
    for (const [index, item] of (data.items || []).entries()) rows.push({ ...item, _date: data.date || file.slice(0, 10), _index: index });
  }
  return rows;
}
function textFields(article) {
  return ["titleKo", "leadKo", ...(article.bodyKo || []).map((_, i) => `bodyKo[${i}]`), ...(article.keyPointsKo || []).map((_, i) => `keyPointsKo[${i}]`)];
}
function textValue(article, field) {
  const m = field.match(/^(bodyKo|keyPointsKo)\[(\d+)\]$/);
  return m ? article[m[1]]?.[Number(m[2])] || "" : article[field] || "";
}
function stableId(article) { return article.id || `${article._date}_${article._index + 1}`; }
function slug(article) {
  const title = String(article.titleKo || "").replace(/[^가-힣a-zA-Z0-9\s]/g, "").trim().replace(/\s+/g, "-").slice(0, 40).replace(/-+$/, "");
  return `${stableId(article)}${title ? `-${title}` : ""}`;
}
function articleUrl(article) { return `${ORIGIN}/article/${encodeURI(slug(article))}`; }
function findArticle(row, rows) {
  const titles = [row.title, String(row.title || "").replaceAll("라신County", "라신 카운티").replaceAll("소장관", "소방관")];
  return rows.find((item) => item.id && row.id && item.id === row.id) || rows.find((item) => item._date === row.date && titles.includes(item.titleKo)) || null;
}
function shortSource(article) { return article?.sourceTitle || article?.sourceLabel || null; }
function textEvidence(article, warning) {
  if (!article) return { field: null, originalText: null, sourceText: null };
  const fields = textFields(article);
  const field = fields.find((name) => KNOWN.some((term) => textValue(article, name).includes(term))) || fields.find((name) => /[가-힣][A-Za-z][A-Za-z0-9·.-]*[가-힣]/.test(textValue(article, name))) || "titleKo";
  return { field, originalText: textValue(article, field), sourceText: shortSource(article) };
}
function classifyLanguage(row, article) {
  const warning = row.warnings?.[0] || "ambiguous";
  const known = warning.startsWith("known-error:") ? warning.slice("known-error:".length) : null;
  if (known && SAFE_REPLACEMENTS.has(known)) return { ...SAFE_REPLACEMENTS.get(known), warning, originalText: known, sourceText: shortSource(article) };
  const evidence = textEvidence(article, warning);
  const original = known || evidence.originalText || "";
  const token = original.match(/[가-힣]([A-Za-z][A-Za-z0-9·.-]*)[가-힣]/)?.[1] || "";
  const validAcronym = COMMON_ACRONYMS.has(token) || /^[A-Z][A-Z0-9-]{1,8}$/.test(token);
  if (warning === "korean-internal-ascii" && validAcronym) return { warning, classification: "false-positive", confidence: 0.98, changesMeaning: false, requiresHumanReview: false, resolution: "allowlisted-acronym", suggestion: null, originalText: original, sourceText: shortSource(article), field: evidence.field };
  if (warning === "korean-internal-ascii" && /[A-Za-z]{2,}/.test(token)) return { warning, classification: "untranslated-fragment", confidence: 0.86, changesMeaning: true, requiresHumanReview: true, resolution: "review-queue", suggestion: null, originalText: original, sourceText: shortSource(article), field: evidence.field };
  if (warning === "claim-superlative-review") return { warning, classification: "title-body-mismatch", confidence: 0.8, changesMeaning: true, requiresHumanReview: true, resolution: "review-queue", suggestion: null, originalText: original, sourceText: shortSource(article), field: evidence.field };
  return { warning, classification: "ambiguous", confidence: 0.6, changesMeaning: true, requiresHumanReview: true, resolution: "review-queue", suggestion: null, originalText: original, sourceText: shortSource(article), field: evidence.field };
}
function languageReport() {
  const audit = readJson(LANGUAGE_AUDIT, { rows: [] });
  const rows = issueRows();
  const currentKeys = new Set((audit.rows || []).map((x) => x.id || `${x.date}:${x.title}`));
  const baselineCovered = (row) => currentKeys.has(row.id || `${row.date}:${row.title}`) || (() => { const article = findArticle(row, rows); return Boolean(article && currentKeys.has(article.id || `${article._date}:${article.titleKo}`)); })();
  const auditRows = [...(audit.rows || []), ...PRE_CORRECTION_LANGUAGE_ROWS.filter((x) => !baselineCovered(x))];
  const items = [];
  for (const row of auditRows) {
    const article = findArticle(row, rows);
    const classifiedRows = (row.warnings || []).map((warning) => classifyLanguage({ ...row, warnings: [warning] }, article));
    const classified = classifiedRows.find((item) => item.resolution === "auto-applied") || classifiedRows.find((item) => item.requiresHumanReview) || classifiedRows[0] || classifyLanguage(row, article);
    const item = {
        articleId: stableId(article || { _date: row.date, _index: 0 }),
        url: article ? articleUrl(article) : null,
        field: classified.field || textEvidence(article, row.warnings?.[0]).field,
        originalText: classified.originalText || null,
        sourceText: classified.sourceText || article?.sourceTitle || null,
        suggestedText: classified.suggestion || null,
        classification: classified.classification,
        confidence: classified.confidence,
        changesMeaning: classified.changesMeaning,
        requiresHumanReview: classified.requiresHumanReview,
        resolution: classifiedRows.some((item) => item.resolution === "auto-applied") ? "auto-applied" : classified.resolution,
        warnings: row.warnings || [],
        sourceUrl: article?.sourceUrl || article?.sourceUrlRaw || null,
        indexable: Boolean(article?.indexable || article?.workflowStatus === "published" || article?.workflowStatus === "legacy-published"),
      };
    items.push(item);
  }
  const knownHits = [];
  for (const article of rows) {
    const text = JSON.stringify(article);
    for (const term of KNOWN) if (text.includes(term)) knownHits.push({ articleId: stableId(article), url: articleUrl(article), term, indexable: Boolean(article.workflowStatus === "published" || article.workflowStatus === "legacy-published"), action: SAFE_REPLACEMENTS.has(term) ? "auto-applied" : "review-queue" });
  }
  const appliedCorrections = [
    ["병원ugeom", "병원 경험", rows.find((x) => x.id === "v1_5ef792dba5c1c590")],
    ["조객 참여", "조류 관찰자 참여", rows.find((x) => x.id === "v1_aa6becfdbbcbbfdd")],
    ["라신County", "라신 카운티", rows.find((x) => x.titleKo?.includes("라신 카운티"))],
    ["소장관", "소방관", rows.find((x) => x.titleKo?.includes("소방관"))],
  ].filter(([, , article]) => article).map(([from, to, article]) => ({ articleId: stableId(article), url: articleUrl(article), from, to, meaningChanged: false, dateModifiedChanged: false }));
  const data = { version: 1, generatedAt: new Date().toISOString(), baselineWarningCount: new Set(auditRows.map((x) => x.id || `${x.date}:${x.title}`)).size, warningCount: items.length, autoApplied: items.filter((x) => x.resolution === "auto-applied").length, humanReview: items.filter((x) => x.requiresHumanReview).length, items, appliedCorrections, knownErrorReaudit: { terms: KNOWN, hits: knownHits, unresolved: knownHits.filter((x) => x.action === "review-queue").length }, note: "원문 전체를 저장하지 않고 sourceTitle/sourceUrl과 짧은 텍스트 근거만 보존합니다. 자동 수정은 의미가 보존되는 명백한 표기에 한정합니다." };
  const md = `# 언어 검수 분류\n\n- 기준 경고 기사: ${data.baselineWarningCount}\n- 분류 항목: ${data.warningCount}\n- 자동 적용: ${data.autoApplied}\n- 사람 검수 필요: ${data.humanReview}\n\n| 기사 | 필드 | 분류 | 신뢰도 | 의미 변경 | 처리 |\n|---|---|---|---:|---|---|\n${items.map((x) => `| ${x.articleId} | ${x.field || "-"} | ${x.classification} | ${x.confidence} | ${x.changesMeaning ? "예" : "아니오"} | ${x.resolution} |`).join("\n")}\n\n## 알려진 오류 재검사\n\n${knownHits.length ? knownHits.map((x) => `- ${x.articleId} · ${x.term} · ${x.action}`).join("\n") : "현재 데이터에서 알려진 오류 문자열은 발견되지 않았습니다."}\n`;
  atomicWrite(path.join(ROOT, "reports", "language-review.json"), JSON.stringify(data, null, 2) + "\n");
  atomicWrite(path.join(ROOT, "reports", "language-review.md"), md);
  return data;
}
function numberTokens(value) { return [...String(value || "").matchAll(/\b\d+(?:[,.]\d+)?\s*(?:mg|μg|mcg|mL|ml|IU|%|개월|주|일|마리|명|세|kg|mmHg|mm|cm)?\b/gi)].map((m) => m[0].replace(/\s+/g, " ").trim()); }
function claimClass(row, article) {
  const warningText = (row.warnings || []).join(",");
  const text = [article?.titleKo, article?.leadKo, ...(article?.bodyKo || []), ...(article?.keyPointsKo || [])].filter(Boolean).join(" ");
  const units = [...new Set(numberTokens(text).map((x) => x.replace(/[\d,.\s-]/g, "").toLowerCase()).filter(Boolean))];
  if (/unit|mg|μg|mcg|mL|IU|mmHg/i.test(warningText) || units.length > 1 && /mg|mL|IU|kg|mmHg/i.test(units.join(" "))) return { classification: "unit-mismatch", confidence: 0.68, requiresHumanReview: true, disposition: "do-not-auto-correct" };
  if (!article?.sourceUrl && !article?.sourceUrlRaw) return { classification: "unverifiable", confidence: 0.99, requiresHumanReview: true, disposition: "review-queue" };
  if (/numeric/i.test(warningText)) return { classification: "missing-context", confidence: 0.95, requiresHumanReview: true, disposition: "compare-with-source" };
  return { classification: "unverifiable", confidence: 0.8, requiresHumanReview: true, disposition: "review-queue" };
}
function claimReport() {
  const audit = readJson(CLAIM_AUDIT, { rows: [] });
  const rows = issueRows();
  const items = (audit.rows || []).map((row) => {
    const article = findArticle(row, rows); const cls = claimClass(row, article); const claim = row.claim || {};
    return { articleId: stableId(article || { _date: row.date, _index: 0 }), url: article ? articleUrl(article) : null, title: row.title || article?.titleKo || null, indexable: Boolean(article?.workflowStatus === "published" || article?.workflowStatus === "legacy-published"), warnings: row.warnings || [], classification: cls.classification, confidence: cls.confidence, requiresHumanReview: cls.requiresHumanReview, disposition: cls.disposition, claim: { claim: claim.claim || null, sourceEvidence: claim.sourceEvidence ? { url: claim.sourceEvidence.url || null, title: claim.sourceEvidence.title || null } : null, evidenceType: claim.evidenceType || null, species: claim.species || [], population: claim.population || null, number: claim.number || [], unit: claim.unit || [] }, sourceUrl: article?.sourceUrl || article?.sourceUrlRaw || null, shortEvidence: (row.warnings || []).join(", ") };
  });
  const counts = Object.fromEntries([...new Set(items.map((x) => x.classification))].sort().map((key) => [key, items.filter((x) => x.classification === key).length]));
  const data = { version: 1, generatedAt: new Date().toISOString(), warningCount: items.length, counts, critical: items.filter((x) => x.classification === "critical").length, items, note: "수치·단위는 원문과 대조하기 전 자동 수정하지 않습니다. 원문 전체 대신 URL, 제목, 구조화된 수치와 짧은 경고 근거만 저장합니다." };
  const md = `# 임상 주장 검수 분류\n\n- 경고: ${data.warningCount}\n- critical: ${data.critical}\n\n${Object.entries(counts).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n| 기사 | 분류 | 원문 | 경고 | 처리 |\n|---|---|---|---|---|\n${items.map((x) => `| ${x.articleId} | ${x.classification} | ${x.sourceUrl ? `[원문](${x.sourceUrl})` : "없음"} | ${x.warnings.join(", ")} | ${x.disposition} |`).join("\n")}\n`;
  atomicWrite(path.join(ROOT, "reports", "claim-review.json"), JSON.stringify(data, null, 2) + "\n");
  atomicWrite(path.join(ROOT, "reports", "claim-review.md"), md);
  return data;
}
function firstReleaseReport() {
  const source = readJson(path.join(ROOT, "reports", "draft-newsroom.json"), { drafts: [] });
  const ids = ["v1_88e7bde7826c5eaf", "v1_8977cdecc20db74b", "v1_66712dc60cebbebc", "v1_ecdd9715ae5b33aa", "v1_5f01b0b4f48babba"];
  const rows = ids.map((id) => source.drafts.find((x) => x.id === id)).filter(Boolean).map((x) => ({ id: x.id, title: x.sourceTitle, sourceLabel: x.sourceLabel, sourceUrl: x.sourceUrl, publishedAt: x.sourcePublishedAt, sourceStatus: x.sourceStatus, duplicateStatus: x.duplicateStatus, clinicalRisk: x.clinicalRisk, status: "needs-language-fix", reasons: ["한국어 titleKo·leadKo·bodyKo 초안이 없고 generationWarnings=llm-generation-not-requested입니다.", "원문 설명만으로 기사 본문을 생성하면 의미·저작권·임상 표현을 검증할 수 없어 자동 보완하지 않았습니다."], editorPacket: { sourceTitle: x.sourceTitle, sourceDescription: x.description || x.sourceEvidence?.description || null, canonical: x.canonicalUrl || x.sourceUrl, generatedText: null, reviewerRequired: true, published: false } }));
  const data = { version: 1, generatedAt: new Date().toISOString(), candidates: rows, counts: { "ready-for-editor": 0, "needs-source-fix": 0, "needs-language-fix": rows.length, duplicate: 0, rejected: 0 }, note: "5개 모두 사람 편집자가 원문을 직접 확인해 한국어 초안을 작성해야 합니다. reviewer 0명이므로 approved/published로 전환하지 않습니다." };
  atomicWrite(path.join(ROOT, "reports", "first-release-candidates-qa.json"), JSON.stringify(data, null, 2) + "\n");
  atomicWrite(path.join(ROOT, "reports", "first-release-candidates.md"), `# 첫 low-risk 후보 편집 상태\n\n- ready-for-editor: 0\n- needs-language-fix: ${rows.length}\n- 자동 published: 0\n\n${rows.map((x) => `## ${x.id} · ${x.title}\n\n- 매체: ${x.sourceLabel}\n- 원문: ${x.sourceUrl}\n- 상태: **${x.status}**\n- 사유: ${x.reasons.join(" ")}\n- 다음 단계: 원문을 사람이 읽고 제목·리드·본문·이미지 권리를 작성한 뒤 CLI 검수 큐에 등록`).join("\n\n")}` + "\n");
  return data;
}
function main() {
  const command = process.argv[2] || "all";
  const result = command === "language" ? { language: languageReport() } : command === "claims" ? { claims: claimReport() } : command === "first-release" ? { firstRelease: firstReleaseReport() } : { language: languageReport(), claims: claimReport(), firstRelease: firstReleaseReport() };
  console.log(JSON.stringify({ language: result.language?.warningCount, claims: result.claims?.warningCount, firstRelease: result.firstRelease?.counts }, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { languageReport, claimReport, firstReleaseReport };
