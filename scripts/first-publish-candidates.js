import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, safeSourceUrl, loadRegistry, isOfficialUrl } from "../src/lib/source-first.js";
import { publishQualityIssues } from "../src/quality.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const IDS = [
  "v1_88e7bde7826c5eaf",
  "v1_8977cdecc20db74b",
  "v1_66712dc60cebbebc",
  "v1_ecdd9715ae5b33aa",
  "v1_5f01b0b4f48babba",
];
const OUT = path.join(ROOT, "reports", "first-publish-candidates.json");
const OUT_MD = path.join(ROOT, "reports", "first-publish-candidates.md");

function loadCandidates() {
  const report = readJson(path.join(ROOT, "reports", "draft-newsroom.json"), { drafts: [] });
  return IDS.map((id) => report.drafts.find((item) => item.id === id)).filter(Boolean);
}

function classify(item, registry) {
  const source = registry.sources.find((row) => row.id === item.sourceId || row.label === item.sourceLabel);
  const warnings = [...(item.warnings || []), ...(item.generation?.generationWarnings || [])];
  const quality = publishQualityIssues(item);
  const hasKorean = Boolean(item.titleKo && item.leadKo && Array.isArray(item.bodyKo) && item.bodyKo.length);
  const official = Boolean(item.sourceUrl && safeSourceUrl(item.sourceUrl) && source && isOfficialUrl(item.sourceUrl, source));
  let status = "ready-for-editor";
  const reasons = [];
  if (item.duplicateStatus !== "unique") { status = "duplicate"; reasons.push(`duplicateStatus=${item.duplicateStatus}`); }
  else if (!official || item.sourceStatus !== "verified") { status = "needs-source-fix"; reasons.push("공식 canonical 또는 sourceStatus 확인 필요"); }
  else if (!hasKorean || warnings.length || quality.length) { status = "needs-language-fix"; reasons.push(...(!hasKorean ? ["한국어 제목·리드·본문 초안 없음"] : []), ...warnings, ...quality); }
  else if (item.clinicalRisk !== "low") { status = "rejected"; reasons.push("low-risk 후보가 아님"); }
  return { id: item.id, title: item.sourceTitle || item.title || "", sourceLabel: item.sourceLabel || "", sourceUrl: item.sourceUrl || null, sourceStatus: item.sourceStatus || null, duplicateStatus: item.duplicateStatus || null, clinicalRisk: item.clinicalRisk || null, status, reasons: [...new Set(reasons)], reviewerRequired: true, published: false };
}

const registry = loadRegistry();
const rows = loadCandidates().map((item) => classify(item, registry));
const report = { generatedAt: new Date().toISOString(), candidates: rows, counts: Object.fromEntries(["ready-for-editor", "needs-source-fix", "needs-language-fix", "duplicate", "rejected"].map((status) => [status, rows.filter((row) => row.status === status).length])), note: "사람 reviewer가 없으므로 이 보고서는 published 상태를 만들지 않습니다." };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
fs.writeFileSync(OUT_MD, `# 첫 low-risk 발행 후보\n\n- 생성 시각: ${report.generatedAt}\n- 자동 published: 0\n\n| ID | 제목 | 매체 | 상태 | 사유 |\n|---|---|---|---|---|\n${rows.map((row) => `| ${row.id} | ${row.title.replace(/\|/g, "\\|")} | ${row.sourceLabel} | ${row.status} | ${(row.reasons.join("; ") || "편집자 검수 준비").replace(/\|/g, "\\|")} |`).join("\n")}` + "\n");
console.log(JSON.stringify({ counts: report.counts, published: 0 }, null, 2));
