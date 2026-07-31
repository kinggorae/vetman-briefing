import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, isOfficialUrl, loadRegistry, readJson, safeSourceUrl } from "../src/lib/source-first.js";
import { clinicalSafetyIssues, organizationAuthor } from "../src/lib/editorial-policy.js";
import { imageCanRender, normalizeImageOwnership } from "../src/lib/image-rights.js";
import { qualityIssues } from "../src/lib/quality.js";
import { normalizeSourceUrl } from "../src/identity.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DRAFT_REPORT = path.join(ROOT, "reports", "draft-newsroom.json");
const QA_REPORT = path.join(ROOT, "reports", "first-release-candidates-qa.json");
const OUT_DIR = path.join(ROOT, "reports", "briefs");
const ISSUE_DIR = path.join(ROOT, "data", "issues");
const DRAFT_DIR = path.join(ROOT, "data", "drafts");
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
// data/drafts의 생성본을 먼저 본다. draft-newsroom.json은 본문 없는 후보 목록이라
// 거기만 보면 생성된 한국어 본문을 못 찾아 전 항목이 "한국어 필요"로 탈락한다.
function draftFiles() {
  if (!fs.existsSync(DRAFT_DIR)) return [];
  return fs.readdirSync(DRAFT_DIR).filter((name) => name.endsWith(".json")).map((name) => path.join(DRAFT_DIR, name));
}
function find(id) {
  for (const file of draftFiles()) {
    const row = (readJson(file, { items: [] }).items || []).find((item) => item.id === id);
    if (row) return row;
  }
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
  // 임상 위험도: high만 차단하고 low·medium은 발행한다. requiredReviewRole이
  // 수의사를 요구하는 구간이 high(및 임상 행위 표현이 있는 medium)이므로,
  // 그 아래는 수의사 없이 조직 명의로 내보내도 검수 정책과 어긋나지 않는다.
  if (row.clinicalRisk === "high") blockers.push(`high-risk는 수의사 검수 필요: ${row.clinicalRisk}`);
  if (!row.clinicalRisk) blockers.push("clinicalRisk 미분류");
  if (!sourceOk) blockers.push("공식 canonical과 sourceStatus=verified 필요");
  if (row.duplicateStatus !== "unique") blockers.push(`duplicateStatus=unique 필요: ${row.duplicateStatus || "미분류"}`);
  if (!hasKorean(row)) blockers.push("한국어 titleKo·leadKo·bodyKo 필요");
  if (language.length) blockers.push(`언어 경고 ${language.length}건`);
  if (claims.length) blockers.push(`임상 주장 경고 ${claims.length}건`);
  if (safety.length) blockers.push("안전하지 않은 임상 명령 표현");
  if (quality.length) blockers.push(...quality);
  // 대표 이미지는 선택. 다만 이미지를 달았는데 권리가 불확실하면 그건 막는다.
  // (source-first 수집에는 이미지 권리 확인 단계가 아예 없어, 필수로 두면
  //  전 항목이 탈락한다. 텍스트만으로도 발행 가치가 있는 브리핑이다.)
  if (imageUrl && !imageOk) blockers.push("대표 이미지 권리 확인 필요");
  const status = row.duplicateStatus !== "unique" ? "duplicate" : !sourceOk ? "needs-source-fix" : !hasKorean(row) || language.length ? "needs-language-fix" : claims.length || safety.length ? "needs-claim-fix" : row.clinicalRisk === "high" ? "rejected" : blockers.length ? "needs-claim-fix" : "ready-public-brief";
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
// 일간 자동발행용 일괄 릴리스. 해당 날짜 draft 중 ready-public-brief만 발행하고
// 나머지는 사유와 함께 남긴다. 이미 다른 날짜에 나간 sourceUrl은 건너뛴다.
function releaseReady(flags) {
  const date = flags.date || new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  // 기본은 그날 수집분만 본다. 전체 draft를 훑으면 며칠 지난 초안이 오늘 날짜로
  // 발행된다. 과거분 소급 발행이 필요할 때만 --all-drafts로 명시한다.
  const files = flags["all-drafts"] ? draftFiles() : draftFiles().filter((file) => path.basename(file).includes(date));
  const rows = files.flatMap((file) => readJson(file, { items: [] }).items || []);
  const published = new Set();
  for (const file of fs.readdirSync(ISSUE_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))) {
    if (file.slice(0, 10) === date) continue;
    for (const item of readJson(path.join(ISSUE_DIR, file), { items: [] }).items || []) {
      const url = normalizeSourceUrl(item.sourceUrl || item.sourceUrlRaw || "");
      if (url) published.add(url);
    }
  }
  const seen = new Set();
  const summary = { date, total: rows.length, released: 0, skipped: {}, ids: [] };
  const bump = (reason) => { summary.skipped[reason] = (summary.skipped[reason] || 0) + 1; };
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const url = normalizeSourceUrl(row.sourceUrl || row.sourceUrlRaw || "");
    if (url && published.has(url)) { bump("이미 발행된 원문"); continue; }
    let evaluation;
    try { evaluation = evaluate(row); } catch { bump("평가 실패"); continue; }
    if (evaluation.status !== "ready-public-brief") { bump(evaluation.status); continue; }
    if (!flags.apply) { summary.released += 1; summary.ids.push(row.id); if (url) published.add(url); continue; }
    release(row.id, { ...flags, date, apply: true });
    summary.released += 1;
    summary.ids.push(row.id);
    if (url) published.add(url);
  }
  console.log(JSON.stringify({ ...summary, dryRun: !flags.apply }, null, 2));
}
function main() {
  const { command, id, flags } = parse();
  try {
    if (command === "release-ready") return releaseReady(flags);
    if (!id) throw new Error("draft-id가 필요합니다.");
    if (command === "prepare") prepare(id);
    else if (command === "validate") validate(id);
    else if (command === "preview") preview(id);
    else if (command === "release") release(id, flags);
    else throw new Error("prepare | validate | preview | release <draft-id> | release-ready [--date=] [--apply]");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

export { evaluate };
