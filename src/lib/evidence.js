// 연구·임상 메타데이터는 원문 또는 사람 검수로 확인된 값만 통과시킨다.
// 이 모듈은 값을 추정하거나 자동 수정하지 않고, 누락·충돌 후보만 보고한다.
export const EVIDENCE_FIELDS = Object.freeze([
  "studyType", "speciesStudied", "sampleSize", "intervention", "comparator",
  "primaryOutcome", "evidenceLevel", "limitations", "journal", "doi",
  "institution", "funding", "conflictOfInterest",
]);

export function evidenceMetadata(item = {}) {
  return Object.fromEntries(EVIDENCE_FIELDS
    .filter((key) => item[key] !== undefined && item[key] !== null && String(item[key]).trim() !== "")
    .map((key) => [key, item[key]]));
}

const NUMBER_TOKEN = /(?:\b(?:n|N|sample(?: size)?|표본(?: 수)?|대상)\s*[=:]?\s*\d[\d,.]*|\d[\d,.]*\s*(?:mg|μg|ug|mL|ml|IU|%|개월|주|일|년|세|마리|명|건|배|시간|분)|\b\d[\d,.]*%)/gi;

function numericTokens(value) {
  return [...String(value || "").matchAll(NUMBER_TOKEN)].map((match) => match[0].replace(/\s+/g, " ").trim().toLowerCase());
}

export function numericEvidenceIssues(item = {}) {
  const fields = {
    lead: item.leadKo || item.summaryKo,
    body: Array.isArray(item.bodyKo) ? item.bodyKo.join(" ") : item.bodyKo,
    keyPoints: Array.isArray(item.keyPointsKo) ? item.keyPointsKo.join(" ") : item.keyPointsKo,
    radar: [item.radar?.clinical, item.radar?.evidence, item.radar?.owner].filter(Boolean).join(" "),
  };
  const bodyTokens = new Set(numericTokens(fields.body));
  const issues = [];
  if (fields.lead && numericTokens(fields.lead).some((token) => !bodyTokens.has(token))) issues.push("numeric-lead-body-mismatch");
  if (fields.keyPoints && numericTokens(fields.keyPoints).some((token) => !bodyTokens.has(token))) issues.push("numeric-keypoints-body-mismatch");
  if (fields.radar && numericTokens(fields.radar).some((token) => !bodyTokens.has(token))) issues.push("numeric-radar-body-mismatch");
  return issues;
}

export function studyTypeLabel(value) {
  return { "randomized-controlled-trial": "무작위 대조시험", cohort: "코호트 연구", "case-control": "환자-대조군 연구", "cross-sectional": "단면 연구", "case-report": "증례 보고", "systematic-review": "체계적 문헌고찰", "meta-analysis": "메타분석", diagnostic: "진단 정확도 연구", experimental: "실험 연구" }[value] || value;
}
