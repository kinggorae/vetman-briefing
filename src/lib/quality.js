// 기사 공개·색인 품질 기준. 수집기, 빌더, 검증기가 같은 판정을 사용한다.
// 420자는 검색엔진 권장량이 아니라 이 프로젝트의 최소 편집 검수 기준이다.
import { clinicalReviewIssues } from "./editorial-review.js";
import { workflowReviewIssues, isNewWorkflowItem } from "./editorial-operations.js";

export const CONTENT_TIERS = new Set(["brief", "analysis", "evidence"]);
export const CARD_BLOCKERS = new Set([
  "title-missing",
  "body-missing",
  "foreign-script",
  "banned-term",
  "garbled-text",
  "template-text",
  "internal-ascii",
]);

// 자동 생성 결과에서 반복적으로 발견된 명백한 오염·템플릿 문구.
// 의미가 불확실한 새 오류는 여기에 임의로 추가하지 말고 needsReview/noindex로 남긴다.
export const BANNED_TERMS = Object.freeze([
  "Invol",
  "ractical",
  "말 이 교육",
  "세번서",
  "폴크 County",
  "병원ugeom",
  "조객 참여",
  "원-health",
  "무뎌지",
  "백식",
  "백석",
  "수수의료진",
  "proprietários",
]);

const FOREIGN_SCRIPT = /[一-鿿぀-ヿЀ-ӿ]/;
const SUSPICIOUS_TERMS = /\b(?:Hernia|fleas|corticosteroid|Oligodendroglioma|Taurine|Microbiome|historicas|alongside|efficacy|literature|refractory|site|generic|Responsible|organism|endogenous|exogenous|probiotic|hospital|owner|Trial|Pilot|Veterinarian|Practice|Nutrition|physiological demand|dietary supplementation)\b/i;
const TEMPLATE_TERMS = /(?:\b(?:lorem ipsum|tbd|todo|placeholder|insert here|제목을 입력|본문을 입력|여기에 입력|자동 생성|생성된 요약)\b|\[\s*(?:제목|본문|내용|출처)\s*\])/i;
const INTERNAL_ASCII = /[가-힣][A-Za-z]{2,}[가-힣]/;
const BAD_JOSA = /(?:^|[\s,])(?:을를|를을|이가|가이|은는|는은|의의|으로로|에에|와과|하고고)(?=$|[\s,.!?])|주인의 위한|과의의/;
const REPEATED_WORD = /(?:\b([A-Za-z가-힣]{2,})\s+\1\b|([가-힣]{2,})\s+\2)/i;
const GOOGLE_NEWS_RELAY = /^https?:\/\/(?:news\.)?google\.[^/]+\/rss\/articles\//i;
const SENTENCE_END = /(?:[.!?。！？]|습니다|입니다|합니다|됩니다|있습니다|됩니다)\s*$/;

const textOf = (item = {}) => [
  item.titleKo,
  item.leadKo || item.summaryKo,
  ...(Array.isArray(item.bodyKo) ? item.bodyKo : []),
  ...(Array.isArray(item.keyPointsKo) ? item.keyPointsKo : []),
  item.angleKo,
].filter((value) => value != null).map(String).join(" ").replace(/\s+/g, " ").trim();

export function bodyParagraphs(item = {}) {
  return Array.isArray(item.bodyKo) ? item.bodyKo.map((p) => String(p || "").trim()).filter(Boolean) : [];
}

export function bodyCharCount(item = {}) {
  return bodyParagraphs(item).join("").replace(/\s/g, "").length;
}

export function normalizeContentTier(item = {}) {
  const explicit = String(item.contentTier || "").toLowerCase();
  if (CONTENT_TIERS.has(explicit)) return explicit;
  if (String(item.tier || "").toLowerCase() === "brief" || item.category === "brief") return "brief";
  if (item.radar?.evidence || item.doi || item.sourceType === "paper" || item.journal) return "evidence";
  // legacy 필드가 없는 기존 기사도 충분한 본문과 편집 판단이 있을 때만 analysis로 승격한다.
  // 본문 길이·레이더가 부족하면 brief로 남겨 얇은 콘텐츠를 과대 분류하지 않는다.
  if (bodyCharCount(item) >= 420 && (item.radar?.clinical || item.radar?.owner)) {
    return "analysis";
  }
  return "brief";
}

function hasKoreanSentence(value) {
  const text = String(value || "").trim();
  if (!text || !/[가-힣]/.test(text) || FOREIGN_SCRIPT.test(text) || INTERNAL_ASCII.test(text)) return false;
  return SENTENCE_END.test(text) || /[가-힣0-9)]$/.test(text);
}

function titleBodyMismatch(title, body) {
  const tokens = String(title || "")
    .replace(/[^가-힣A-Za-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
  if (tokens.length < 2 || body.length < 120) return false;
  const matches = tokens.filter((token) => body.includes(token));
  return matches.length === 0;
}

export function qualityIssues(item = {}) {
  const issues = [];
  const title = String(item.titleKo || "").trim();
  const lead = String(item.leadKo || item.summaryKo || "").trim();
  const paragraphs = bodyParagraphs(item);
  const body = paragraphs.join(" ");
  const tier = normalizeContentTier(item);
  const allText = textOf(item);

  if (!title) issues.push("title-missing");
  if (!lead && !body) issues.push("body-missing");
  if (FOREIGN_SCRIPT.test(allText)) issues.push("foreign-script");
  if (SUSPICIOUS_TERMS.test(allText)) issues.push("untranslated-term");
  if (BANNED_TERMS.some((term) => allText.toLowerCase().includes(term.toLowerCase()))) issues.push("banned-term");
  if (/말\s*이\s*교육|세번서|폴크\s+County|\b(?:Invol|ractical)\b/i.test(allText)) issues.push("garbled-text");
  if (TEMPLATE_TERMS.test(allText)) issues.push("template-text");
  if (INTERNAL_ASCII.test(allText)) issues.push("internal-ascii");
  if (BAD_JOSA.test(allText)) issues.push("particle-error");
  if (REPEATED_WORD.test(allText)) issues.push("repeated-word");

  if (tier === "brief") {
    if (title.length < 10) issues.push("brief-title-too-short");
    if (lead.length < 90) issues.push("brief-too-short");
    return [...new Set(issues)];
  }

  if (paragraphs.length < 3) issues.push("paragraphs-too-few");
  if (bodyCharCount(item) < 420) issues.push("body-too-short");
  if (paragraphs.some((paragraph) => paragraph.replace(/\s/g, "").length < 40)) issues.push("paragraph-too-short");
  if (new Set(paragraphs.map((paragraph) => paragraph.replace(/\s/g, ""))).size !== paragraphs.length) issues.push("duplicate-paragraph");
  if (!hasKoreanSentence(title)) issues.push("title-not-korean-sentence");
  if (!hasKoreanSentence(lead || paragraphs[0])) issues.push("lead-not-korean-sentence");
  if (paragraphs.some((paragraph) => !hasKoreanSentence(paragraph))) issues.push("body-not-korean-sentence");
  if (titleBodyMismatch(title, body)) issues.push("title-body-mismatch");
  if (!String(item.sourceUrl || item.finalUrl || item.sourceUrlRaw || "").trim()) issues.push("source-missing");
  if (GOOGLE_NEWS_RELAY.test(String(item.sourceUrl || item.finalUrl || item.sourceUrlRaw || ""))) issues.push("source-relay");
  if (!(item.radar?.clinical || item.radar?.owner || item.radar?.evidence)) issues.push("radar-missing");
  return [...new Set(issues)];
}

// 기사 페이지 색인은 명시적 suppress/duplicate 및 모든 치명 오류를 통과해야 한다.
export function publishQualityIssues(item = {}, { duplicate = false } = {}) {
  const issues = qualityIssues(item);
  if (duplicate && !issues.includes("duplicate-source")) issues.push("duplicate-source");
  issues.push(...clinicalReviewIssues(item, { issueDate: item._day || item.day || item.publishedAt }));
  if (isNewWorkflowItem(item)) issues.push(...workflowReviewIssues(item));
  return [...new Set(issues)];
}

export function isCardRenderable(item = {}) {
  return item.visibility !== "suppressed" && !qualityIssues(item).some((issue) => CARD_BLOCKERS.has(issue));
}

export function isProfessionallyIndexable(item = {}, { duplicate = false } = {}) {
  const tier = normalizeContentTier(item);
  if (item.visibility === "suppressed" || item.indexPolicy === "legacy-noindex" || duplicate || item.duplicateSource) return false;
  if (!item.sourceUrl && !item.finalUrl && !item.sourceUrlRaw) return false;
  if (!(tier === "analysis" || tier === "evidence")) return false;
  return publishQualityIssues(item).length === 0;
}

export function markQuality(item) {
  const issues = qualityIssues(item);
  return issues.length ? { ...item, qualityFlags: issues, needsReview: true } : item;
}
