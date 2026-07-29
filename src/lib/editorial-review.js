export const EDITORIAL_STATUSES = new Set([
  "automated",
  "editor-reviewed",
  "vet-reviewed",
  "correction-required",
  "draft",
  "editor-review-required",
  "vet-review-required",
  "approved",
  "published",
  "archived",
  "legacy-published",
]);
export const CLINICAL_RISKS = new Set(["low", "medium", "high"]);
export const REVIEW_POLICY_DATE = "2026-07-29";

const HIGH_RISK = /약물|용량|투여|처치|치료 선택|응급|진단 지침|예후|dose|dosage|emergency|prognos|treatment recommendation/i;
const MEDIUM_RISK = /임상|질환|증례|검사|보호자|환자|연구|clinical|disease|patient|study/i;
const LOW_RISK = /병원 경영|채용|인력|업계|정책|시장|커리어|industry|management|policy/i;

export function normalizeEditorialStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return EDITORIAL_STATUSES.has(status) ? status : "automated";
}

export function inferClinicalRisk(item = {}) {
  if (CLINICAL_RISKS.has(String(item.clinicalRisk || "").toLowerCase())) return String(item.clinicalRisk).toLowerCase();
  const text = [item.titleKo, item.leadKo, ...(item.bodyKo || []), item.angleKo, item.radar?.clinical].filter(Boolean).join(" ");
  if (HIGH_RISK.test(text)) return "high";
  if (LOW_RISK.test(text) && !MEDIUM_RISK.test(text)) return "low";
  if (MEDIUM_RISK.test(text)) return "medium";
  return "low";
}

export function isPolicyNew(item = {}, issueDate = "") {
  const date = String(item.createdAt || item.publishedAt || item._day || issueDate || "").slice(0, 10);
  // 기존 1·2차 기사에는 날짜만으로 소급 적용하지 않는다. 새 파이프라인은
  // reviewPolicyVersion/검수 필드로 명시하거나 시행일 다음 날짜부터 적용한다.
  const explicit = item._reviewPolicyExplicit || item.reviewPolicyVersion;
  return Boolean(explicit) || (/^\d{4}-\d{2}-\d{2}$/.test(date) && date > REVIEW_POLICY_DATE);
}

export function clinicalReviewIssues(item = {}, { issueDate = "", existingIndex = false } = {}) {
  const status = normalizeEditorialStatus(item.workflowStatus || item.editorialStatus);
  const risk = inferClinicalRisk(item);
  const issues = [];
  if (status === "correction-required") issues.push("correction-required");
  if (item.workflowStatus && ["draft", "automated", "editor-review-required", "vet-review-required", "archived"].includes(item.workflowStatus)) issues.push("workflow-not-approved");
  // 1·2차 기존 색인 기사는 일괄 차단하지 않는다. 정책 시행일 이후의 새 기사에만
  // 검수 게이트를 적용하고, 기존 기사는 관리자 우선순위 큐에서 사람 검수를 기다린다.
  if (!existingIndex && isPolicyNew(item, issueDate)) {
    if (risk === "high" && status !== "vet-reviewed" && !(item.vetReviewedAt && (item.vetReviewer || item.vetReviewerId))) issues.push("high-risk-not-vet-reviewed");
    if (risk === "medium" && !["editor-reviewed", "vet-reviewed"].includes(status) && !(item.reviewedAt || item.vetReviewedAt)) issues.push("medium-risk-not-editor-reviewed");
  }
  return [...new Set(issues)];
}

export function reviewLabel(item = {}) {
  const status = normalizeEditorialStatus(item.workflowStatus || item.editorialStatus);
  if (status === "correction-required") return "정정 필요";
  if (status === "vet-reviewed") return "수의사 감수 완료";
  if (status === "editor-reviewed") return "사람 편집 검수 완료";
  if (status === "legacy-published") return "기존 발행 · 검수 대기";
  if (status === "approved") return "발행 승인";
  if (status === "published") return "발행됨";
  if (status === "vet-review-required") return "수의사 검수 필요";
  if (status === "editor-review-required") return "편집 검수 필요";
  if (item.aiAssisted === true) return "AI 보조 번역·요약 · 사람 검수 대기";
  return "자동 생성 · 사람 검수 대기";
}
