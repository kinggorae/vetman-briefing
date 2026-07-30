import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, isOfficialUrl, loadRegistry, readJson, safeSourceUrl } from "../src/lib/source-first.js";
import { clinicalSafetyIssues, organizationAuthor } from "../src/lib/editorial-policy.js";
import { imageCanRender, normalizeImageOwnership } from "../src/lib/image-rights.js";
import { qualityIssues } from "../src/lib/quality.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DRAFT_REPORT = path.join(ROOT, "reports", "draft-newsroom.json");
const QA_REPORT = path.join(ROOT, "reports", "first-release-candidates-qa.json");
const OUT_DIR = path.join(ROOT, "reports", "briefs");
const ISSUE_DIR = path.join(ROOT, "data", "issues");
const CANDIDATE_IDS = ["v1_88e7bde7826c5eaf", "v1_8977cdecc20db74b", "v1_66712dc60cebbebc", "v1_ecdd9715ae5b33aa", "v1_5f01b0b4f48babba"];

function parse() {
  const raw = process.argv.slice(2); const command = raw.shift() || "validate"; const positional = []; const flags = {};
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (!token.startsWith("--")) { positional.push(token); continue; }
    const [key, ...rest] = token.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : (raw[i + 1] && !raw[i + 1].startsWith("--") ? raw[++i] : true);
  }
  return { command, id: positional[0], flags };
}
function newsroom() { return readJson(DRAFT_REPORT, { drafts: [] }); }
function qa() { return readJson(QA_REPORT, { candidates: [] }); }
function find(id) {
  const report = newsroom();
  return report.drafts.find((row) => row.id === id) || qa().candidates.find((row) => row.id === id) || null;
}
function sourceFor(row) {
  const registry = loadRegistry();
  return registry.sources.find((source) => source.id === row.sourceId || source.label === row.sourceLabel) || null;
}
function languageWarnings(row) {
  const audit = readJson(path.join(ROOT, "reports", "language-audit.json"), { rows: [] });
  return (audit.rows || []).find((item) => item.id === row.id)?.warnings || [];
}
function claimWarnings(row) {
  const audit = readJson(path.join(ROOT, "reports", "claims-audit.json"), { rows: [] });
  return (audit.rows || []).find((item) => item.id === row.id)?.warnings || [];
}
function hasKorean(row) { return Boolean(row.titleKo && row.leadKo && Array.isArray(row.bodyKo) && row.bodyKo.length); }
function evaluate(row) {
  if (!row) throw new Error("draft 후보를 찾을 수 없습니다.");
  const source = sourceFor(row);
  const sourceOk = Boolean(row.sourceUrl && safeSourceUrl(row.sourceUrl) && row.sourceStatus === "verified" && source && isOfficialUrl(row.sourceUrl, source));
  const language = languageWarnings(row);
  const claims = claimWarnings(row);
  const imageUrl = row.imageUrl || row.image || null;
  const ownership = normalizeImageOwnership(row.imageOwnership, { hasImage: Boolean(imageUrl), origin: row.imageOrigin });
  const imageOk = Boolean(imageUrl && imageCanRender({ url: imageUrl, ownership, origin: row.imageOrigin }));
  const safety = clinicalSafetyIssues(row);
  const quality = hasKorean(row) ? qualityIssues(row) : ["titleKo/leadKo/bodyKo-missing"];
  const blockers = [];
  if (row.clinicalRisk !== "low") blockers.push(`low-risk 필요: ${row.clinicalRisk || "미분류"}`);
  if (!sourceOk) blockers.push("공식 canonical과 sourceStatus=verified 필요");
  if (row.duplicateStatus !== "unique") blockers.push(`duplicateStatus=unique 필요: ${row.duplicateStatus || "미분류"}`);
  if (!hasKorean(row)) blockers.push("한국어 titleKo·leadKo·bodyKo 필요");
  if (language.length) blockers.push(`언어 경고 ${language.length}건`);
  if (claims.length) blockers.push(`임상 주장 경고 ${claims.length}건`);
  if (safety.length) blockers.push("안전하지 않은 임상 명령 표현");
  if (quality.length) blockers.push(...quality);
  if (!imageOk) blockers.push("권리 확인된 대표 이미지 필요");
  const status = row.duplicateStatus !== "unique" ? "duplicate" : !sourceOk ? "needs-source-fix" : !hasKorean(row) || language.length ? "needs-language-fix" : claims.length || safety.length ? "needs-claim-fix" : row.clinicalRisk !== "low" ? "rejected" : blockers.length ? "needs-claim-fix" : "ready-public-brief";
  return {
    id: row.id,
    title: row.titleKo || row.sourceTitle || row.title || "",
    source: { label: row.sourceLabel || null, url: row.sourceUrl || null, rawUrl: row.sourceUrlRaw || null, status: row.sourceStatus || null, publishedAt: row.sourcePublishedAt || row.publishedAt || null },
    clinicalRisk: row.clinicalRisk || null,
    duplicateStatus: row.duplicateStatus || null,
    status,
    blockers: [...new Set(blockers)],
    languageWarnings: language,
    claimWarnings: claims,
    clinicalSafetyIssues: safety,
    image: { url: imageUrl, ownership: ownership || null, confirmed: imageOk },
    publication: { status: "public-brief", robots: "noindex,follow", sitemap: false, newsSitemap: false, rss: false },
    author: organizationAuthor(),
    reviewer: null,
    noReviewer: true,
    generatedTextPresent: hasKorean(row),
  };
}
function writePreview(row, evaluation) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const packageData = { version: 1, generatedAt: new Date().toISOString(), previewOnly: true, eligibleForRelease: evaluation.status === "ready-public-brief", evaluation, sourceEvidence: { title: row.sourceTitle || row.title || null, description: row.description || row.sourceEvidence?.description || null, canonical: row.canonicalUrl || row.sourceUrl || null }, article: { titleKo: row.titleKo || null, leadKo: row.leadKo || null, bodyKo: row.bodyKo || [], keyPointsKo: row.keyPointsKo || [], angleKo: row.angleKo || null }, jsonLd: { "@context": "https://schema.org", "@type": "NewsArticle", headline: row.titleKo || row.sourceTitle || "", description: row.leadKo || row.description || "", author: organizationAuthor(), ...(row.sourceUrl ? { isBasedOn: { "@type": "CreativeWork", url: row.sourceUrl } } : {}) }, note: "실제 reviewer가 없으므로 approved/published/index 상태를 만들지 않습니다." };
  atomicWrite(path.join(OUT_DIR, `${row.id}.json`), JSON.stringify(packageData, null, 2) + "\n");
  atomicWrite(path.join(OUT_DIR, `${row.id}.md`), `# public-brief 발행 전 패키지\n\n- ID: ${row.id}\n- 상태: ${evaluation.status}\n- 공개 정책: public-brief · noindex,follow · sitemap/RSS 제외\n- 작성 주체: ${evaluation.author.name}\n- 수의사 감수: 없음\n- 차단 사유: ${evaluation.blockers.join("; ") || "없음"}\n`);
  return packageData;
}
function prepare(id) { const row = find(id); const evaluation = evaluate(row); const packageData = writePreview(row, evaluation); console.log(JSON.stringify({ id, previewOnly: true, status: evaluation.status, package: packageData }, null, 2)); }
function validate(id) { const row = find(id); const evaluation = evaluate(row); console.log(JSON.stringify(evaluation, null, 2)); if (evaluation.blockers.length) throw new Error(`public-brief 검증 차단:\n- ${evaluation.blockers.join("\n- ")}`); }
function preview(id) { prepare(id); }
function release(id, flags) {
  const row = find(id); const evaluation = evaluate(row); console.log(JSON.stringify({ id, action: "release", dryRun: !flags.apply, evaluation }, null, 2));
  if (evaluation.blockers.length) throw new Error(`release 차단:\n- ${evaluation.blockers.join("\n- ")}`);
  if (!flags.apply) { console.log("dry-run: --apply 없이는 public-brief issue를 저장하지 않습니다."); return; }
  const date = flags.date || new Date().toISOString().slice(0, 10);
  const target = path.join(ISSUE_DIR, `${date}.json`);
  const current = readJson(target, { date, status: "published", generatedAt: new Date().toISOString(), items: [] });
  const published = { ...row, workflowStatus: "published", editorialStatus: "published", publicationStatus: "public-brief", author: null, authorUrl: null, reviewer: null, reviewerUrl: null, publishedAt: row.publishedAt || new Date().toISOString(), firstPublishedAt: row.firstPublishedAt || new Date().toISOString(), updatedAt: row.updatedAt || null };
  if (!current.items.some((item) => item.id === id)) current.items.push(published);
  atomicWrite(target, JSON.stringify(current, null, 2) + "\n");
  console.log(`public-brief 저장 완료: ${target} (noindex, sitemap/RSS 제외)`);
}
function main() {
  const { command, id, flags } = parse();
  try {
    if (!id) throw new Error("draft-id가 필요합니다.");
    if (command === "prepare") prepare(id);
    else if (command === "validate") validate(id);
    else if (command === "preview") preview(id);
    else if (command === "release") release(id, flags);
    else throw new Error("prepare | validate | preview | release <draft-id>");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { evaluate };
