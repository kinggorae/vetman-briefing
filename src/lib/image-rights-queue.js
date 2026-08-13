import { imageRightsIssues, isExternalImage, normalizeImageOwnership } from "./image-rights.js";

const APPROVED = new Set(["owned", "licensed", "official-press", "source-embed"]);

export function validImageDecision(decision = {}) {
  if (!["approved", "rejected"].includes(decision.status)) return false;
  if (decision.status === "rejected") return Boolean(String(decision.reason || "").trim());
  if (!APPROVED.has(decision.ownership)) return false;
  if (decision.ownership === "licensed" && !decision.license && !decision.licenseUrl) return false;
  if (decision.ownership === "official-press" && !decision.sourceUrl && !decision.credit) return false;
  return true;
}

export function buildImageRightsQueue({ articles = [], indexIds = [], decisions = {} } = {}) {
  const indexSet = new Set(indexIds);
  return articles.map((row) => {
    const item = row.item || row;
    const id = item.id || row.id || `${row.date || String(row.file || "").slice(0, 10) || "unknown"}_${Number(row.index || 0) + 1}`;
    const imageUrl = item.imageUrl || item.image || "";
    const ownership = normalizeImageOwnership(item.imageOwnership, { hasImage: Boolean(imageUrl), origin: item.imageOrigin || (imageUrl ? "external-source" : "") });
    const issues = imageRightsIssues(item);
    const decision = decisions[id] || null;
    return { id, title: item.titleKo || item.title || "", file: row.file || null, indexable: indexSet.has(id), imageUrl, ownership, external: isExternalImage(imageUrl), issues, decision, status: decision?.status || (issues.length && isExternalImage(imageUrl) ? "pending" : "clear") };
  }).filter((row) => row.status !== "clear" && row.external).sort((a, b) => Number(b.indexable) - Number(a.indexable) || String(a.id).localeCompare(String(b.id)));
}

export function imageRightsQueueMarkdown(rows = []) {
  return [
    "# 이미지 권리 검수 큐",
    "",
    `- 전체 대기·결정 항목: ${rows.length}`,
    `- index 우선 확인: ${rows.filter((row) => row.indexable && row.status === "pending").length}`,
    `- 승인: ${rows.filter((row) => row.status === "approved").length}`,
    `- 반려: ${rows.filter((row) => row.status === "rejected").length}`,
    "",
    "권리 근거가 없는 외부 이미지는 복제·자체 호스팅하지 않고 편집 카드로 대체합니다.",
    "",
    ...rows.map((row) => `- ${row.indexable ? "[INDEX]" : "[NOINDEX]"} ${row.id} · ${row.status} · ${row.ownership || "unknown"} · ${row.issues.join(", ") || "결정 기록"} · ${row.title}`),
    "",
  ].join("\n");
}
