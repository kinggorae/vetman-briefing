import crypto from "node:crypto";

export const WORKFLOW_STATUSES = new Set([
  "draft", "automated", "editor-review-required", "vet-review-required",
  "approved", "published", "correction-required", "archived", "legacy-published",
  // 1~3차 데이터의 공개 상태는 별도로 보존한다. 새 워크플로 상태로
  // 소급 승격하지 않으며, 읽을 때만 호환한다.
  "editor-reviewed", "vet-reviewed",
]);
export const REVIEW_ROLES = new Set(["editor", "vet", "admin"]);
export const SCHEMA_VERSION = 2;
export const CHECKLIST_KEYS = ["sourceConfirmed", "titleLeadBodyChecked", "numbersChecked", "speciesAndStudyChecked", "limitationsChecked", "clinicalLanguageChecked"];

export function normalizeWorkflowStatus(value, { legacy = false, draft = false } = {}) {
  const status = String(value || "").trim().toLowerCase();
  if (WORKFLOW_STATUSES.has(status)) return status;
  return draft ? "draft" : legacy ? "legacy-published" : "automated";
}
export function workflowLabel(value) {
  return { draft: "초안", automated: "자동 생성", "editor-review-required": "편집 검수 필요", "vet-review-required": "수의사 검수 필요", approved: "발행 승인", published: "발행됨", "correction-required": "정정 필요", archived: "보관됨", "legacy-published": "기존 발행 · 검수 대기", "editor-reviewed": "사람 편집 검수 완료", "vet-reviewed": "수의사 감수 완료" }[value] || "상태 미분류";
}
export function normalizedChecklist(value = {}) { return Object.fromEntries(CHECKLIST_KEYS.map((key) => [key, value[key] === true])); }
export function checklistComplete(value = {}) { const checklist = normalizedChecklist(value); return CHECKLIST_KEYS.every((key) => checklist[key]); }
export function contentHash(item = {}) {
  const payload = { titleKo: item.titleKo || "", leadKo: item.leadKo || item.summaryKo || "", bodyKo: Array.isArray(item.bodyKo) ? item.bodyKo : [], keyPointsKo: Array.isArray(item.keyPointsKo) ? item.keyPointsKo : [], angleKo: item.angleKo || "", evidence: item.evidence || null };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
export function sourceHash(item = {}) {
  const payload = { sourceUrl: item.sourceUrl || "", sourceUrlRaw: item.sourceUrlRaw || "", sourceTitle: item.sourceTitle || "", sourceLabel: item.sourceLabel || "", publishedAt: item.publishedAt || "", doi: item.doi || "" };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
export function requiredReviewRole(item = {}) {
  const risk = String(item.clinicalRisk || "low").toLowerCase();
  const clinicalAction = /권고|투여|용량|처치|치료|진단|응급|예후|임상 적용|환자에게/i.test([item.titleKo, item.leadKo, ...(item.bodyKo || []), item.radar?.clinical].filter(Boolean).join(" "));
  if (risk === "high" || (risk === "medium" && clinicalAction)) return "vet";
  return "editor";
}
export function workflowReviewIssues(item = {}) {
  const status = normalizeWorkflowStatus(item.workflowStatus || item.editorialStatus);
  const required = requiredReviewRole(item);
  const hasEditorReview = Boolean(item.reviewedAt && (item.reviewedBy || item.reviewerId));
  const hasVetReview = Boolean(item.vetReviewedAt && (item.vetReviewer || item.vetReviewerId));
  const issues = [];
  if (["draft", "automated", "editor-review-required", "vet-review-required", "correction-required", "archived"].includes(status)) issues.push("workflow-not-approved");
  if (status === "correction-required") issues.push("correction-required");
  if (["approved", "published"].includes(status) && required === "vet" && !hasVetReview) issues.push("vet-review-missing");
  if (["approved", "published"].includes(status) && required === "editor" && !hasEditorReview && !hasVetReview) issues.push("editor-review-missing");
  return [...new Set(issues)];
}
export function reviewPriority(item = {}, { legacyIndex = false, reReview = false } = {}) {
  const risk = item.clinicalRisk === "high" ? 40 : item.clinicalRisk === "medium" ? 25 : 10;
  const status = normalizeWorkflowStatus(item.workflowStatus || item.editorialStatus, { legacy: legacyIndex });
  return risk + (status === "correction-required" ? 40 : 0) + (status === "vet-review-required" ? 20 : 0) + (legacyIndex ? 15 : 0) + (reReview ? 15 : 0);
}
export function articleContractIssues(item = {}) {
  const issues = [];
  if (!String(item.id || "").trim()) issues.push("id-missing");
  if (!String(item.titleKo || "").trim()) issues.push("titleKo-missing");
  if (!String(item.leadKo || item.summaryKo || "").trim()) issues.push("leadKo-missing");
  if (!Array.isArray(item.bodyKo) || !item.bodyKo.length) issues.push("bodyKo-missing");
  if (!String(item.sourceLabel || "").trim()) issues.push("sourceLabel-missing");
  if (!String(item.sourceUrl || item.sourceUrlRaw || "").trim() && item.sourceResolution?.status !== "unresolved") issues.push("source-missing");
  if (!String(item.publishedAt || "").trim()) issues.push("publishedAt-missing");
  if (!["brief", "analysis", "evidence"].includes(String(item.contentTier || ""))) issues.push("contentTier-missing");
  if (!["low", "medium", "high"].includes(String(item.clinicalRisk || ""))) issues.push("clinicalRisk-missing");
  if (!WORKFLOW_STATUSES.has(String(item.workflowStatus || ""))) issues.push("workflowStatus-missing");
  return [...new Set(issues)];
}
export function isNewWorkflowItem(item = {}) { return item._workflowExplicit === true || Boolean(item.dataSchemaVersion || item.reviewPolicyVersion); }
