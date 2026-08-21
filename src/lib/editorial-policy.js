import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SETTINGS_FILE = path.join(ROOT, "data", "editorial", "settings.json");

export const PUBLICATION_STATUSES = new Set([
  "internal-draft",
  "public-brief",
  // index-low-risk: 임상 위험도 low이고 언어·주장·임상안전 경고가 하나도 없는
  // 글만 감수 없이 색인 대상으로 내보내는 등급. 조직 명의로 나가고 감수자를
  // 주장하지 않는 점은 public-brief와 같지만 색인·사이트맵에는 포함된다.
  // medium 이상은 이 등급을 받을 수 없고 public-brief로 남아 검수를 기다린다.
  "index-low-risk",
  // index-news: 수의사 감수 없이도 출처·언어·안전 자동 검사를 통과한 짧은
  // 뉴스 브리핑을 검색·뉴스 사이트맵·RSS에 싣는 등급이다. 임상 판단을
  // 제공하는 분석·처방·용량·진단 콘텐츠에는 적용하지 않는다.
  "index-news",
  "index-analysis",
  "blocked-clinical",
]);

const DEFAULT_SETTINGS = {
  version: 1,
  editorialMode: "organization-only",
  veterinaryReviewerAvailable: false,
  organization: { name: "베트맨랩", url: "https://news.vetmanlab.com/about" },
  transparency: {
    noReviewerLabel: "현재 등록된 수의사 감수자가 없습니다.",
    clinicalDisclaimer: "임상 정보는 참고용입니다. 적용 전 원문과 최신 문헌을 확인하고 담당 수의사가 판단해야 합니다.",
  },
};

export function loadEditorialSettings() {
  try {
    const value = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8"));
    return {
      ...DEFAULT_SETTINGS,
      ...value,
      organization: { ...DEFAULT_SETTINGS.organization, ...(value.organization || {}) },
      transparency: { ...DEFAULT_SETTINGS.transparency, ...(value.transparency || {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function normalizePublicationStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return PUBLICATION_STATUSES.has(status) ? status : null;
}

export function isVeterinaryReviewerAvailable(settings = loadEditorialSettings()) {
  return settings.veterinaryReviewerAvailable === true;
}

export function organizationAuthor(settings = loadEditorialSettings()) {
  return { "@type": "Organization", name: settings.organization.name, ...(settings.organization.url ? { url: settings.organization.url } : {}) };
}

export const UNSAFE_CLINICAL_PATTERNS = Object.freeze([
  /반드시\s*(?:투여|사용|치료|처치)(?:해야)?/i,
  /권장\s*용량/i,
  /치료해야\s*한다/i,
  /(?:환자|동물|개|고양이)는?\s*안전하다/i,
  /효과가\s*입증됐다/i,
  /완치/i,
  /즉시\s*약물(?:을)?\s*사용/i,
  /진단할\s*수\s*있다/i,
  /예방할\s*수\s*있다/i,
]);

export function clinicalSafetyIssues(item = {}) {
  const text = [item.titleKo, item.leadKo, ...(item.bodyKo || []), ...(item.keyPointsKo || []), item.angleKo, item.radar?.clinical]
    .filter(Boolean)
    .join(" ");
  return [...new Set(UNSAFE_CLINICAL_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source))];
}

export function isNewPublication(item = {}) {
  return Boolean(item.publicationStatus || item.draftKind || item.generation || item.reviewPolicyVersion);
}

export function publicationPolicy(item = {}) {
  const explicit = normalizePublicationStatus(item.publicationStatus);
  if (explicit) return explicit;
  if (!isNewPublication(item)) return null;
  const risk = String(item.clinicalRisk || "low").toLowerCase();
  if (risk === "high") return "blocked-clinical";
  return "internal-draft";
}
