import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, isRelayUrl, readJson } from "../src/lib/source-first.js";
import { inferClinicalRisk } from "../src/lib/editorial-review.js";
import { isProfessionallyIndexable, qualityIssues } from "../src/lib/quality.js";
import { clinicalSafetyIssues, loadEditorialSettings } from "../src/lib/editorial-policy.js";
import { evaluate } from "./brief-publishing.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUE_DIR = path.join(ROOT, "data", "issues");
const REPORT_DIR = path.join(ROOT, "reports");
const CANDIDATES = ["v1_88e7bde7826c5eaf", "v1_8977cdecc20db74b", "v1_66712dc60cebbebc", "v1_ecdd9715ae5b33aa", "v1_5f01b0b4f48babba"];

function articles() {
  return fs.readdirSync(ISSUE_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).flatMap((file) => {
    const data = readJson(path.join(ISSUE_DIR, file), {});
    return (data.items || []).map((item, index) => ({ ...item, _day: data.date || file.slice(0, 10), _index: index }));
  });
}
function articleId(item) { return item.id || `${item._day}_${item._index + 1}`; }
function auditLegacy() {
  const rows = [];
  for (const item of articles()) {
    const risk = inferClinicalRisk(item);
    const indexable = isProfessionallyIndexable(item);
    const safety = clinicalSafetyIssues(item);
    const sourceMissing = !item.sourceUrl && !item.sourceUrlRaw;
    const relay = isRelayUrl(item.sourceUrl || item.sourceUrlRaw || "");
    const critical = indexable && risk === "high" && safety.length > 0 && (sourceMissing || relay);
    if (safety.length) rows.push({ articleId: articleId(item), title: item.titleKo, indexable, clinicalRisk: risk, sourceStatus: item.sourceStatus || null, sourceUrl: item.sourceUrl || item.sourceUrlRaw || null, unsafeExpressions: safety, qualityWarnings: qualityIssues(item), disposition: critical ? "correction-required-noindex" : "legacy-review-queue", critical });
  }
  return { scanned: articles().length, unsafeCount: rows.length, criticalCount: rows.filter((row) => row.critical).length, rows };
}
function main() {
  const settings = loadEditorialSettings();
  const candidateRows = CANDIDATES.map((id) => {
    try { return evaluate(readJson(path.join(ROOT, "reports", "draft-newsroom.json"), { drafts: [] }).drafts.find((row) => row.id === id)); } catch { return { id, status: "rejected", blockers: ["candidate-not-found"] }; }
  });
  const candidateCounts = Object.fromEntries(["ready-public-brief", "needs-source-fix", "needs-claim-fix", "needs-language-fix", "duplicate", "rejected"].map((status) => [status, candidateRows.filter((row) => row.status === status).length]));
  const legacy = auditLegacy();
  const automaticPublished = articles().filter((item) => item.publicationStatus === "index-news").length;
  const data = { version: 1, generatedAt: new Date().toISOString(), settings: { editorialMode: settings.editorialMode, veterinaryReviewerAvailable: settings.veterinaryReviewerAvailable, organization: settings.organization }, policy: { high: "blocked-clinical", medium: "brief-index-news-after-automated-checks", low: "brief-index-news-after-automated-checks" }, candidates: candidateRows, candidateCounts, legacyRiskAudit: legacy, automaticPublished, reviewerCount: 0, note: "실제 수의사 감수자는 없지만 출처·언어·안전 검사를 통과한 brief 뉴스는 index-news로 공개합니다. high-risk 임상 콘텐츠와 index-analysis는 계속 차단합니다." };
  atomicWrite(path.join(REPORT_DIR, "no-reviewer-policy.json"), JSON.stringify(data, null, 2) + "\n");
  atomicWrite(path.join(REPORT_DIR, "no-reviewer-low-risk-candidates.md"), `# 수의사 감수자 없음: 자동 뉴스 색인 후보\n\n- 생성 시각: ${data.generatedAt}\n- 운영 모드: ${settings.editorialMode}\n- 수의사 감수자: 없음\n- 자동 index-news: ${data.automaticPublished}\n\n| ID | 제목 | 상태 | 차단·보류 사유 |\n|---|---|---|---|\n${candidateRows.map((row) => `| ${row.id} | ${(row.title || "").replace(/\|/g, "\\|")} | **${row.status}** | ${(row.blockers || []).join("; ").replace(/\|/g, "\\|") || "자동 검사 후 index-news 후보"} |`).join("\n")}\n\n## 자동 공개 조건\n\n- 출처 URL·canonical이 공식 도메인에서 확인된 brief\n- 한국어·길이·중복·임상 안전 검사를 통과한 low/medium 뉴스\n- high-risk·처방·용량·진단 지시는 자동 색인하지 않음\n- 분석·근거 기사(index-analysis)는 실제 편집 검수 전까지 생성하지 않음\n`);
  atomicWrite(path.join(REPORT_DIR, "no-reviewer-policy.md"), `# 수의사 감수자 없음 운영 정책\n\n- 운영 모드: ${settings.editorialMode}\n- 수의사 감수자: 없음\n- 기존 index 보호: ${legacy.criticalCount}건의 즉시 차단 대상\n- 기존 기사 unsafe 표현 검수 큐: ${legacy.unsafeCount}건\n- 자동 index-news: ${data.automaticPublished}건\n\n## 신규 콘텐츠\n\n- high-risk: blocked-clinical\n- low/medium brief: 자동 검사 통과 시 index-news(검색·뉴스 사이트맵·RSS 포함)\n- 분석·근거 기사: low-risk 심층 조건 또는 사람 편집 검수 필요\n- public-brief: noindex\n`);
  console.log(JSON.stringify({ candidateCounts, legacyRiskAudit: { scanned: legacy.scanned, unsafe: legacy.unsafeCount, critical: legacy.criticalCount }, reviewerCount: 0, automaticPublished }, null, 2));
}
main();
