import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRegistry, readJson } from "../src/lib/source-first.js";
import { inferClinicalRisk } from "../src/lib/editorial-review.js";
import { numericEvidenceIssues } from "../src/lib/evidence.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUE_DIR = path.join(ROOT, "data", "issues");
const SOURCE_REPORT = path.join(ROOT, "reports", "source-resolution.json");
const REVIEW_REPORT = path.join(ROOT, "reports", "review-export.json");
const PACKET_JSON = path.join(ROOT, "reports", "clinical-review-packets.json");
const PACKET_MD = path.join(ROOT, "reports", "clinical-review-packets.md");
const BATCH_DIR = path.join(ROOT, "reports", "source-review-batches");

function json(file, fallback) { return readJson(file, fallback); }
function slug(value) { return String(value || "source").toLowerCase().replace(/[^a-z0-9가-힣]+/gi, "-").replace(/^-|-$/g, "").slice(0, 70) || "source"; }
function issues() {
  const result = [];
  for (const file of fs.readdirSync(ISSUE_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))) {
    const issue = json(path.join(ISSUE_DIR, file), {});
    for (const [index, item] of (issue.items || []).entries()) result.push({ file, index, date: issue.date, item, id: item.id || `${issue.date}_${index + 1}` });
  }
  return result;
}
function indexIds() {
  const search = json(path.join(ROOT, "site", "search.json"), { items: [] });
  return new Set((search.items || []).map((row) => row.id));
}
function checklist() { return ["연구 대상 종과 사람/동물 연구 여부 확인", "연구 유형과 표본 수를 원문에서 확인", "약물명·용량·단위·기간 확인", "상관관계와 인과관계 구분", "핵심 결과와 한계가 원문 의미와 일치하는지 확인", "국내 임상 적용 가능성 표현을 과장하지 않았는지 확인", "최신 문헌·정정·철회 여부 확인", "원출처와 인용 범위 확인"]; }
function makePackets() {
  const ids = indexIds();
  const reviewRows = new Map(json(REVIEW_REPORT, { rows: [] }).rows.map((row) => [row.id, row]));
  const packets = issues().filter(({ id }) => ids.has(id)).map(({ item, file, index, date, id }) => {
    const row = reviewRows.get(id) || {};
    const risk = item.clinicalRisk || inferClinicalRisk(item);
    if (!(["high", "medium"].includes(risk))) return null;
    const numeric = numericEvidenceIssues(item);
    return {
      id, date, file: `data/issues/${file}`, index, articleUrl: `https://news.vetmanlab.com/article/${id}`,
      titleKo: item.titleKo || "", clinicalRisk: risk, workflowStatus: item.workflowStatus || "legacy-published", indexable: Boolean(row.indexable),
      source: { label: item.sourceLabel || null, url: item.sourceUrl || null, rawUrl: item.sourceUrlRaw || null, status: item.sourceStatus || (item.sourceUrl ? "ok" : "unresolved"), title: item.sourceTitle || null, publishedAt: item.sourcePublishedAt || null },
      research: { studyType: item.studyType || null, speciesStudied: item.speciesStudied || null, sampleSize: item.sampleSize ?? null, evidenceLevel: item.evidenceLevel || null, doi: item.doi || null, limitations: item.limitations || null },
      numericWarnings: numeric, reviewPriority: row.priority || 0, checklist: checklist(), commands: { show: `npm run review:show -- ${id}`, requestVet: `npm run review:request-vet -- ${id}`, correct: `npm run review:correct -- ${id}` },
      content: { title: item.titleKo || "", lead: item.leadKo || item.summaryKo || "", body: item.bodyKo || [], keyPoints: item.keyPointsKo || [] },
      note: "이 패킷은 검수 자료이며 실제 승인·감수 결과를 의미하지 않습니다.",
    };
  }).filter(Boolean).sort((a, b) => b.reviewPriority - a.reviewPriority || b.date.localeCompare(a.date));
  const counts = { total: packets.length, high: packets.filter((p) => p.clinicalRisk === "high").length, medium: packets.filter((p) => p.clinicalRisk === "medium").length, legacy: packets.filter((p) => p.workflowStatus === "legacy-published").length };
  const report = { generatedAt: new Date().toISOString(), counts, packets, note: "사람이 원문과 기사를 대조한 뒤에만 review CLI로 상태를 변경하세요." };
  fs.mkdirSync(path.dirname(PACKET_JSON), { recursive: true });
  fs.writeFileSync(PACKET_JSON, JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(PACKET_MD, `# 임상 검수 패킷\n\n- 전체: ${counts.total}건\n- high: ${counts.high}건\n- medium: ${counts.medium}건\n- legacy-published: ${counts.legacy}건\n\n${packets.map((p, i) => `## ${i + 1}. ${p.titleKo}\n\n- ID: \`${p.id}\` · 위험도: **${p.clinicalRisk}** · 상태: ${p.workflowStatus}\n- 원문: ${p.source.url || p.source.rawUrl || "미확정"}\n- 수치 경고: ${p.numericWarnings.join(", ") || "없음"}\n- 검수 명령: \`${p.commands.show}\` · \`${p.commands.requestVet}\`\n- 체크리스트: ${p.checklist.join("; ")}\n`).join("\n") || "대상이 없습니다."}`);
  return report;
}
function sourceBatches() {
  const sourceReport = json(SOURCE_REPORT, { rows: [], manualReviewQueue: [] });
  const registry = loadRegistry();
  const groups = new Map();
  for (const row of sourceReport.rows || []) {
    const key = row.sourceLabel || "미분류";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  fs.rmSync(BATCH_DIR, { recursive: true, force: true });
  fs.mkdirSync(BATCH_DIR, { recursive: true });
  const batches = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([label, rows]) => {
    const source = registry.sources.find((item) => item.label === label) || {};
    const file = `${String(batchesLengthPlaceholder()).padStart(3, "0")}-${slug(label)}.md`;
    const text = `# ${label} 원출처 검수 배치\n\n- 공식 도메인: ${(source.officialDomains || source.domains || []).join(", ") || "레지스트리 미확정"}\n- 공식 RSS: ${(source.rssUrls || []).concat(source.atomUrls || []).join(", ") || "없음"}\n- 검색 템플릿: ${source.searchUrlTemplate || "없음"}\n- 승인 예시: \`npm run source:approve -- ARTICLE_ID https://official.example/article\`\n\n> 후보 URL은 사람이 제목·발행일·canonical·개별 기사 페이지를 확인한 뒤 승인해야 합니다.\n\n${rows.map((row, i) => `## ${i + 1}. ${row.titleKo}\n\n- 기사 ID: \`${row.articleId}\`\n- 원문 제목: ${row.sourceTitle || "-"}\n- 발행일: ${row.publishedAt || "-"}\n- relay URL: ${row.rawUrl}\n- 공식 도메인: ${(row.officialDomains || []).join(", ") || "미매핑"}\n- 후보: ${(row.candidates || []).map((candidate) => candidate.url || candidate).join(", ") || "없음"}\n- 검색 후보: ${(row.query || []).join(" | ")}\n- 상태: ${row.status} · 사유: ${row.reason || "-"}\n- 승인 명령: \`npm run source:approve -- ${row.articleId} <확인한-공식-URL>\`\n`).join("\n")}`;
    fs.writeFileSync(path.join(BATCH_DIR, file), text);
    return { label, count: rows.length, file: `reports/source-review-batches/${file}`, officialDomains: source.officialDomains || source.domains || [], feedUrls: [...(source.rssUrls || []), ...(source.atomUrls || [])] };
  });
  const summary = { generatedAt: new Date().toISOString(), total: sourceReport.rows?.length || 0, batchCount: batches.length, batches };
  fs.writeFileSync(path.join(BATCH_DIR, "index.json"), JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(path.join(BATCH_DIR, "README.md"), `# 원출처 검수 배치\n\n총 ${summary.total}건, ${summary.batchCount}개 매체 그룹입니다. 빈도순으로 정렬했습니다.\n\n${batches.map((batch) => `- [${batch.label}](${path.basename(batch.file)}) · ${batch.count}건`).join("\n")}`);
  return summary;
}
let batchCounter = 0;
function batchesLengthPlaceholder() { return ++batchCounter; }
const command = process.argv[2] || "all";
try {
  if (command === "packets") console.log(JSON.stringify(makePackets().counts, null, 2));
  else if (command === "source-batches") console.log(JSON.stringify(sourceBatches(), null, 2));
  else console.log(JSON.stringify({ packets: makePackets().counts, sourceBatches: sourceBatches() }, null, 2));
} catch (error) { console.error(error.message); process.exit(1); }
