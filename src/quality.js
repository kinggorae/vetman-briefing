// MiniMax 결과를 발행 전에 검사하는 결정론적 품질 게이트.
// 학명·약어 전체를 금지하지 않고, 실제로 독자에게 노출되면 안 되는 일반 영어만 잡는다.
const FOREIGN_SCRIPT = /[一-鿿぀-ヿЀ-ӿ]/;
const SUSPICIOUS_TERMS = /\b(?:Hernia|fleas|corticosteroid|Oligodendroglioma|Taurine|Microbiome|historicas|alongside|efficacy|literature|refractory|site|generic|Responsible|organism|endogenous|exogenous|probiotic|hospital|owner|Trial|Pilot|Veterinarian|Practice|Nutrition|physiological demand|dietary supplementation)\b/i;
const GARBLED_TERMS = /\b(?:Invol|ractical)\b|말\s*이\s*교육|세번서|폴크\s+County/i;

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
  if (GARBLED_TERMS.test([title, lead, body].join(" "))) issues.push("garbled-text");
  if (tier === "brief") {
    // 브리프는 짧아도 되지만 제목만 있고 한 문장으로 끝난 단신은
    // 카드로 내보낼 최소 정보량이 되지 않는다.
    if (title.length < 10) issues.push("brief-title-too-short");
    if (lead.length < 90) issues.push("brief-too-short");
  } else if (item.category === "watercooler") {
    if (body.length < 220) issues.push("story-too-short");
  } else if (body.length < 420) issues.push("body-too-short");
  if (tier !== "brief" && Array.isArray(item.bodyKo) && item.bodyKo.length < 3) issues.push("paragraphs-too-few");
  return issues;
}

export function markQuality(item) {
  const issues = qualityIssues(item);
  return issues.length ? { ...item, qualityFlags: issues, needsReview: true } : item;
}
