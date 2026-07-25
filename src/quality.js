// MiniMax 결과를 발행 전에 검사하는 결정론적 품질 게이트.
// 학명·약어 전체를 금지하지 않고, 실제로 독자에게 노출되면 안 되는 일반 영어만 잡는다.
const FOREIGN_SCRIPT = /[一-鿿぀-ヿЀ-ӿ]/;
const SUSPICIOUS_TERMS = /\b(?:Hernia|fleas|corticosteroid|Oligodendroglioma|Taurine|Microbiome|historicas|alongside|efficacy|literature|refractory|site|generic|Responsible|organism|endogenous|exogenous|probiotic|hospital|owner|Trial|Pilot|Veterinarian|Practice|Nutrition|physiological demand|dietary supplementation)\b/i;

export function qualityIssues(item = {}) {
  const issues = [];
  const title = String(item.titleKo || "").trim();
  const lead = String(item.leadKo || item.summaryKo || "").trim();
  const body = Array.isArray(item.bodyKo) ? item.bodyKo.map(String).join(" ").trim() : "";
  const tier = item.tier || "deep";

  if (!title) issues.push("title-missing");
  if (!lead && !body) issues.push("body-missing");
  if (FOREIGN_SCRIPT.test([title, lead, body, ...(item.keyPointsKo || [])].join(" "))) issues.push("foreign-script");
  if (SUSPICIOUS_TERMS.test([title, lead, body].join(" "))) issues.push("untranslated-term");
  if (tier !== "brief" && body.length < 420) issues.push("body-too-short");
  if (tier !== "brief" && Array.isArray(item.bodyKo) && item.bodyKo.length < 3) issues.push("paragraphs-too-few");
  return issues;
}

export function markQuality(item) {
  const issues = qualityIssues(item);
  return issues.length ? { ...item, qualityFlags: issues, needsReview: true } : item;
}
