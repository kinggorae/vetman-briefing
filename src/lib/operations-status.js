import { isRelayUrl } from "./source-first.js";
import { imageRightsIssues, isExternalImage, normalizeImageOwnership } from "./image-rights.js";
import { inferClinicalRisk } from "./editorial-review.js";
import { normalizeWorkflowStatus, requiredReviewRole } from "./editorial-operations.js";

function rowsFrom(value) {
  return Array.isArray(value) ? value : [];
}

function countBy(rows, key) {
  return Object.fromEntries(
    [...new Set(rows.map((row) => row?.[key] || "unclassified"))]
      .sort()
      .map((value) => [value, rows.filter((row) => (row?.[key] || "unclassified") === value).length]),
  );
}

function latestReviewMap(reviews) {
  const map = new Map();
  for (const review of rowsFrom(reviews)) {
    if (review?.articleId) map.set(review.articleId, review);
  }
  return map;
}

function articleId(row) {
  return row?.item?.id || row?.id || `${row?.date || "unknown"}_${Number(row?.index || 0) + 1}`;
}

function isReviewed(item, review) {
  const status = normalizeWorkflowStatus(item?.workflowStatus || item?.editorialStatus, {
    legacy: review?.published === true,
    draft: review?.published !== true,
  });
  const role = requiredReviewRole({ ...item, clinicalRisk: item?.clinicalRisk || inferClinicalRisk(item) });
  const hasEditor = Boolean(item?.reviewedAt && (item?.reviewedBy || item?.reviewerId));
  const hasVet = Boolean(item?.vetReviewedAt && (item?.vetReviewer || item?.vetReviewerId));
  if (role === "vet") return hasVet || status === "vet-reviewed";
  return hasEditor || hasVet || ["editor-reviewed", "vet-reviewed"].includes(status);
}

export function summarizeOperations({
  articles = [],
  indexIds = [],
  sourceResolution = {},
  sourceDecisions = {},
  imageDecisions = {},
  reviews = [],
  seoPerformance = {},
  sourceHealth = {},
  corrections = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  const rows = rowsFrom(articles);
  const indexSet = new Set(rowsFrom(indexIds).filter(Boolean));
  const reviewMap = latestReviewMap(reviews);
  const indexedRows = rows.filter((row) => indexSet.has(articleId(row)));
  const relayRows = rows.filter((row) => isRelayUrl(row?.item?.sourceUrlRaw || row?.item?.sourceUrl || row?.sourceUrlRaw || row?.sourceUrl));
  const resolutionRows = rowsFrom(sourceResolution.rows);
  const resolutionCounts = { ...(sourceResolution.counts || {}) };
  const approvedSourceIds = new Set(
    Object.entries(sourceDecisions || {})
      .filter(([, decision]) => decision?.status === "manually-approved")
      .map(([id]) => id),
  );
  const unresolvedSourceRows = resolutionRows.filter((row) => {
    const decision = sourceDecisions?.[row.articleId];
    return !decision || !["manually-approved", "rejected"].includes(decision.status);
  });

  const imageRows = rows.map((row) => {
    const item = row.item || row;
    const url = item.imageUrl || item.image || "";
    const ownership = normalizeImageOwnership(item.imageOwnership, {
      hasImage: Boolean(url),
      origin: item.imageOrigin || (url ? "external-source" : ""),
    });
    const issues = imageRightsIssues(item);
    return {
      id: articleId(row),
      indexable: indexSet.has(articleId(row)),
      url,
      ownership,
      external: isExternalImage(url),
      issues,
    };
  });
  const imagePending = imageRows.filter((row) => row.external && row.ownership === "unknown" && !imageDecisions?.[row.id]);
  const imageIndexedPending = imagePending.filter((row) => row.indexable);
  const reviewRows = rows.map((row) => {
    const item = row.item || row;
    const risk = item.clinicalRisk || inferClinicalRisk(item);
    const review = reviewMap.get(articleId(row));
    const status = normalizeWorkflowStatus(item.workflowStatus || item.editorialStatus, {
      legacy: row.published === true,
      draft: row.published !== true,
    });
    return { id: articleId(row), risk, status, publicationStatus: item.publicationStatus || null, automatedNews: item.publicationStatus === "index-news", indexable: indexSet.has(articleId(row)), reviewed: isReviewed(item, row), priority: risk === "high" ? 40 : risk === "medium" ? 25 : 10, latestReview: review || null };
  });
  const reviewerQueue = reviewRows.filter((row) => row.indexable && !row.automatedNews && !row.reviewed && ["high", "medium"].includes(row.risk));
  const correctionRows = rowsFrom(corrections);
  const correctionCounts = countBy(correctionRows, "status");
  const feedRows = rowsFrom(sourceHealth.feeds || sourceHealth.rows);
  const feedCounts = countBy(feedRows, "status");
  const seoRows = rowsFrom(seoPerformance.rows);

  const report = {
    version: 1,
    generatedAt,
    publication: {
      totalArticles: rows.length,
      index: indexedRows.length,
      noindex: rows.length - indexedRows.length,
      indexRate: rows.length ? Number((indexedRows.length / rows.length).toFixed(4)) : 0,
      indexIds: [...indexSet],
    },
    source: {
      relayArticles: relayRows.length,
      resolutionTotal: Number(sourceResolution.totalRelayArticles || resolutionRows.length || relayRows.length),
      unresolved: unresolvedSourceRows.length,
      candidate: Number(resolutionCounts.candidate || 0),
      resolved: Number(resolutionCounts.resolved || 0) + approvedSourceIds.size,
      manuallyApproved: approvedSourceIds.size,
      rejected: Number(resolutionCounts.rejected || 0),
      decisions: Object.keys(sourceDecisions || {}).length,
    },
    editorial: {
      indexHighRiskWaiting: reviewerQueue.filter((row) => row.risk === "high").length,
      indexMediumRiskWaiting: reviewerQueue.filter((row) => row.risk === "medium").length,
      queue: reviewerQueue.length,
      byRisk: countBy(reviewRows, "risk"),
      byStatus: countBy(reviewRows, "status"),
      reviewerRegistered: rowsFrom(reviews).length > 0 || false,
    },
    images: {
      totalExternal: imageRows.filter((row) => row.external).length,
      unknownExternal: imageRows.filter((row) => row.external && row.ownership === "unknown").length,
      indexUnknownExternal: imageIndexedPending.length,
      pending: imagePending.length,
      decisions: Object.keys(imageDecisions || {}).length,
      issueCounts: Object.fromEntries(
        [...new Set(imageRows.flatMap((row) => row.issues))].sort().map((issue) => [issue, imageRows.filter((row) => row.issues.includes(issue)).length]),
      ),
    },
    corrections: {
      total: correctionRows.length,
      byStatus: correctionCounts,
      open: correctionRows.filter((row) => !["resolved", "rejected", "closed"].includes(row.status || "open")).length,
    },
    feeds: {
      total: feedRows.length,
      byStatus: feedCounts,
      failing: feedRows.filter((row) => ["failing", "disabled"].includes(row.status)).length,
    },
    searchPerformance: {
      rows: seoRows.length,
      providers: [...new Set(seoRows.map((row) => row.provider).filter(Boolean))],
      updatedAt: seoPerformance.updatedAt || null,
    },
    gates: {
      automaticPublished: indexedRows.filter((row) => row.item?.publicationStatus === "index-news").length,
      canIncreaseIndex: unresolvedSourceRows.length === 0 && reviewerQueue.length === 0,
      requiresHumanAction: unresolvedSourceRows.length > 0 || reviewerQueue.length > 0 || imagePending.length > 0,
    },
  };
  return report;
}

export function operationsMarkdown(report = {}) {
  const p = report.publication || {};
  const s = report.source || {};
  const e = report.editorial || {};
  const i = report.images || {};
  const c = report.corrections || {};
  const f = report.feeds || {};
  const seo = report.searchPerformance || {};
  return [
    "# 운영 현황",
    "",
    `- 생성 시각: ${report.generatedAt || "-"}`,
    `- 전체 기사: ${p.totalArticles || 0} · index ${p.index || 0} · noindex ${p.noindex || 0} · 색인율 ${((p.indexRate || 0) * 100).toFixed(1)}%`,
    `- 원문 중계 URL: ${s.relayArticles || 0} · 미해결 ${s.unresolved || 0} · 수동 승인 ${s.manuallyApproved || 0}`,
    `- 색인 high/medium 감수 대기: ${e.indexHighRiskWaiting || 0}/${e.indexMediumRiskWaiting || 0}`,
    `- 외부 이미지 권리 확인 대기: 전체 ${i.unknownExternal || 0} · index ${i.indexUnknownExternal || 0}`,
    `- 정정 요청: 전체 ${c.total || 0} · 미처리 ${c.open || 0}`,
    `- 피드: 전체 ${f.total || 0} · 실패·비활성 ${f.failing || 0}`,
    `- 검색 성과: ${seo.rows || 0}행 · ${seo.providers?.join(", ") || "실제 데이터 없음"}`,
    "",
    "## 사람이 확인해야 하는 항목",
    "",
    s.unresolved ? `- 원문 URL ${s.unresolved}건: npm run source:review 후 승인 URL을 기록하고 npm run source:apply -- --apply 실행` : "- 미해결 원문 URL 없음",
    e.indexHighRiskWaiting || e.indexMediumRiskWaiting ? `- 임상 감수 대기 ${e.indexHighRiskWaiting + e.indexMediumRiskWaiting}건: 등록된 실제 검수자와 체크리스트로 npm run review:approve 실행` : "- 임상·편집 감수 대기 없음",
    i.pending ? `- 이미지 권리 ${i.pending}건: npm run image:rights:queue에서 소유·라이선스 근거 확인` : "- 이미지 권리 대기 없음",
    "",
    "> 이 보고서는 색인 수를 인위적으로 늘리지 않습니다. 승인·감수·권리·정정 기록이 확인된 경우에만 공개 상태를 변경합니다.",
    "",
  ].join("\n");
}
