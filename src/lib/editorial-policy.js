import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SETTINGS_FILE = path.join(ROOT, "data", "editorial", "settings.json");

export const PUBLICATION_STATUSES = new Set([
  "internal-draft",
  "public-brief",
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
