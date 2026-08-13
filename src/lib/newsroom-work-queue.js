const OPEN_SOURCE_STATUSES = new Set(["unresolved", "candidate", "rejected"]);
const OPEN_IMAGE_STATUSES = new Set(["pending"]);
const OPEN_FEED_STATUSES = new Set(["failing", "degraded", "stale"]);
const CLOSED_CORRECTION_STATUSES = new Set(["resolved", "closed", "rejected"]);

function rowsFrom(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function bool(value) {
  return value === true || value === 1 || value === "true";
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function sortTasks(left, right) {
  return number(right.priority) - number(left.priority)
    || Number(bool(right.indexable)) - Number(bool(left.indexable))
    || text(left.title, left.id).localeCompare(text(right.title, right.id), "ko")
    || text(left.id).localeCompare(text(right.id));
}

function addTask(tasks, task) {
  if (!task || !task.id || !task.type) return;
  tasks.push({
    status: "open",
    indexable: false,
    requiredRole: "editor",
    commands: [],
    evidence: [],
    ...task,
  });
}

function articleLookup(reviewRows) {
  const byId = new Map();
  const byTitle = new Map();
  for (const row of rowsFrom(reviewRows)) {
    if (row?.id) byId.set(row.id, row);
    const key = `${text(row?.date)}\t${text(row?.title)}`;
    if (key !== "\t") byTitle.set(key, row);
  }
  return { byId, byTitle };
}

function relatedArticle(row, lookup) {
  if (!row) return null;
  if (row.articleId && lookup.byId.has(row.articleId)) return lookup.byId.get(row.articleId);
  const date = text(row.date || row.issueDate || String(row.file || "").match(/\d{4}-\d{2}-\d{2}/)?.[0]);
  const key = `${date}\t${text(row.title || row.titleKo)}`;
  return lookup.byTitle.get(key) || null;
}

function articleFields(article) {
  return article ? {
    articleId: article.id || null,
    articleUrl: article.generatedUrl || null,
    title: text(article.title, "제목 없음"),
    indexable: bool(article.indexable),
    risk: text(article.clinicalRisk, "unknown"),
    date: article.date || null,
  } : {};
}

function buildEditorialTasks(tasks, reviewRows) {
  for (const article of rowsFrom(reviewRows)) {
    const correction = article?.workflowStatus === "correction-required"
      || rowsFrom(article?.clinicalReviewIssues).includes("correction-required")
      || rowsFrom(article?.qualityIssues).includes("correction-required");
    const highRisk = article?.clinicalRisk === "high";
    const mediumRisk = article?.clinicalRisk === "medium";
    const reReview = bool(article?.reReviewRequired);
    const numeric = rowsFrom(article?.numericEvidenceIssues).length > 0;
    const needsReview = bool(article?.reviewerNeeded) && bool(article?.indexable) && (highRisk || mediumRisk);
    if (!correction && !needsReview && !reReview && !numeric) continue;
    const priority = correction ? 140 : highRisk ? 115 : mediumRisk ? 95 : 85;
    const reasons = [];
    if (correction) reasons.push("정정 필요");
    if (highRisk) reasons.push("high 임상 위험");
    if (mediumRisk) reasons.push("medium 임상 위험");
    if (needsReview) reasons.push("검수자 확인 없음");
    if (reReview) reasons.push("본문 해시 변경 후 재검수 필요");
    if (numeric) reasons.push(...article.numericEvidenceIssues);
    const articleId = text(article.id, `${text(article.date, "unknown")}_${text(article.title, "article")}`);
    addTask(tasks, {
      id: `editorial:${articleId}`,
      type: correction ? "correction" : "editorial-review",
      label: correction ? "정정·재검수" : "임상·편집 감수",
      priority,
      ...articleFields(article),
      requiredRole: highRisk || (mediumRisk && article.reviewerRole !== "editor") ? "vet" : "editor",
      blocker: correction ? "correction-required" : "review-required",
      reason: reasons.join(" · "),
      commands: [
        `npm run review:show -- ${articleId}`,
        ...(correction ? [`npm run review:correct -- ${articleId}`] : []),
        ...(highRisk || mediumRisk ? [`npm run review:request-vet -- ${articleId}`] : []),
      ],
      evidence: [...rowsFrom(article.qualityIssues), ...rowsFrom(article.clinicalReviewIssues), ...rowsFrom(article.numericEvidenceIssues)],
    });
  }
}

function buildSourceTasks(tasks, sourceResolution, lookup) {
  for (const row of rowsFrom(sourceResolution?.rows)) {
    if (!OPEN_SOURCE_STATUSES.has(text(row?.status))) continue;
    const article = relatedArticle(row, lookup);
    const fields = articleFields(article);
    const indexable = bool(article?.indexable);
    const status = text(row.status, "unresolved");
    addTask(tasks, {
      id: `source:${text(row.articleId, `${row.file || "unknown"}:${row.index ?? 0}`)}`,
      type: "source-review",
      label: "공식 원문 확인",
      priority: indexable ? 125 : 75,
      ...fields,
      indexable,
      title: fields.title || text(row.titleKo || row.sourceTitle, "제목 없음"),
      blocker: "source-unresolved",
      reason: `${status === "candidate" ? "후보 URL 사람 확인" : status === "rejected" ? "거절된 출처 재판정" : "공식 원문 URL 미확정"} · ${text(row.sourceLabel, "출처 미상")}`,
      sourceLabel: row.sourceLabel || null,
      sourceUrl: row.rawUrl || null,
      candidates: rowsFrom(row.candidates).slice(0, 3),
      commands: ["npm run source:review"],
      evidence: [text(row.reason), text(row.candidates?.[0]?.url)].filter(Boolean),
    });
  }
}

function buildImageTasks(tasks, imageRightsQueue, lookup) {
  for (const row of rowsFrom(imageRightsQueue?.rows)) {
    if (!OPEN_IMAGE_STATUSES.has(text(row?.status))) continue;
    const article = lookup.byId.get(row.id) || null;
    const fields = articleFields(article);
    const indexable = bool(row.indexable || article?.indexable);
    addTask(tasks, {
      id: `image:${text(row.id, "unknown")}`,
      type: "image-rights",
      label: "이미지 권리 확인",
      priority: indexable ? 105 : 45,
      ...fields,
      articleId: fields.articleId || row.id,
      title: fields.title || text(row.title, "제목 없음"),
      indexable,
      blocker: "image-rights-unknown",
      reason: `${indexable ? "index 기사 우선" : "noindex 기사"} · ${rowsFrom(row.issues).join(", ") || "권리 근거 없음"}`,
      imageUrl: row.imageUrl || null,
      ownership: row.ownership || "unknown",
      commands: [
        `npm run image:rights:decision -- approve --id=${row.id} --ownership=licensed --license=<근거>`,
        `npm run image:rights:decision -- reject --id=${row.id} --reason=<사유>`,
      ],
      evidence: rowsFrom(row.issues),
    });
  }
}

function buildFeedTasks(tasks, sourceHealth) {
  for (const feed of rowsFrom(sourceHealth?.feeds || sourceHealth?.rows)) {
    if (!OPEN_FEED_STATUSES.has(text(feed?.status))) continue;
    const priority = feed.status === "failing" ? 90 : feed.status === "stale" ? 65 : 55;
    addTask(tasks, {
      id: `feed:${text(feed.sourceId || feed.feedUrl, "unknown")}`,
      type: "feed-health",
      label: "공식 피드 복구",
      priority,
      title: text(feed.sourceLabel || feed.feedUrl, "피드"),
      blocker: "feed-health",
      reason: `${feed.status} · ${feed.lastError || feed.error || "최근 피드 상태 확인 필요"}`,
      sourceLabel: feed.sourceLabel || null,
      sourceUrl: feed.feedUrl || null,
      commands: ["npm run sources:diagnose", "npm run sources:repair:validate"],
      evidence: [feed.httpStatus ? `HTTP ${feed.httpStatus}` : "HTTP 미확인", feed.contentType || "MIME 미확인"],
    });
  }
}

function buildDraftTasks(tasks, newsroom) {
  for (const row of rowsFrom(newsroom?.drafts)) {
    if (row?.published === true) continue;
    const risk = text(row.clinicalRisk, "low");
    const priority = risk === "high" ? 100 : risk === "medium" ? 80 : 50;
    const id = text(row.id, text(row.sourceTitle, "draft"));
    addTask(tasks, {
      id: `draft:${id}`,
      type: "draft-review",
      label: "신규 초안 검수",
      priority,
      articleId: row.id || null,
      title: text(row.title || row.sourceTitle, "제목 없음"),
      risk,
      blocker: "draft-not-approved",
      reason: `${risk}-risk 신규 draft · 사람 승인 필요`,
      sourceLabel: row.sourceLabel || null,
      sourceUrl: row.sourceUrl || null,
      commands: [row.commands?.show || `npm run review:show -- ${id}`, row.commands?.promote || `npm run ingest:promote -- ${id}`],
      evidence: rowsFrom(row.warnings),
    });
  }
}

function buildProductionTask(tasks, productionMonitor) {
  const critical = rowsFrom(productionMonitor?.critical);
  const warnings = rowsFrom(productionMonitor?.warnings);
  if (!critical.length && !warnings.length) return;
  addTask(tasks, {
    id: "production:sync",
    type: "production-sync",
    label: "라이브 배포 동기화",
    priority: critical.length ? 150 : 60,
    blocker: critical.length ? "production-critical" : "production-warning",
    reason: critical.length ? `라이브 치명 오류 ${critical.length}건` : `라이브 경고 ${warnings.length}건`,
    commands: ["npm run verify:deployment", "npm run monitor:production"],
    evidence: [...critical, ...warnings].slice(0, 6).map((row) => `${row.pathname || ""} ${row.reason || ""}`.trim()),
  });
}

function buildPublicCorrectionTasks(tasks, correctionRows) {
  for (const row of rowsFrom(correctionRows)) {
    const status = text(row.status, "open").toLowerCase();
    if (CLOSED_CORRECTION_STATUSES.has(status) || !row.id) continue;
    const type = text(row.type, "other");
    const priority = ["fact", "copyright", "deletion"].includes(type) ? 145 : 135;
    addTask(tasks, {
      id: `public-correction:${row.id}`,
      type: "correction",
      label: "독자 정정 접수",
      priority,
      title: `정정 접수 · ${type}`,
      articleUrl: row.articleUrl || null,
      indexable: false,
      requiredRole: "editor",
      blocker: "public-correction-open",
      reason: `${status} · ${text(row.receivedAt, "접수 시각 없음")}`,
      sourceLabel: "public-report-form",
      commands: ["관리자 화면에서 in-review / resolved / rejected 상태 기록", "원문 대조 후 실제 기사 수정은 Git 검수·배포 절차로 진행"],
      evidence: [text(row.message, "정정 근거 없음")],
    });
  }
}

function queueCounts(tasks) {
  const byType = Object.fromEntries([...new Set(tasks.map((task) => task.type))].sort().map((type) => [type, tasks.filter((task) => task.type === type).length]));
  const byPriority = {
    critical: tasks.filter((task) => task.priority >= 130).length,
    high: tasks.filter((task) => task.priority >= 90 && task.priority < 130).length,
    normal: tasks.filter((task) => task.priority < 90).length,
  };
  return { byType, byPriority };
}

function priorityMatches(priority, value) {
  if (!value || value === "all") return true;
  const score = number(priority);
  if (value === "critical") return score >= 130;
  if (value === "high") return score >= 90 && score < 130;
  if (value === "normal") return score < 90;
  return false;
}

export function filterNewsroomWorkQueue(queue = {}, { type = "", priority = "", query = "" } = {}) {
  const rows = rowsFrom(queue.rows);
  const needle = String(query || "").trim().toLocaleLowerCase();
  const filtered = rows.filter((row) => {
    if (type && type !== "all" && text(row.type) !== type) return false;
    if (!priorityMatches(row.priority, priority)) return false;
    if (!needle) return true;
    return [row.id, row.type, row.label, row.title, row.reason, row.sourceLabel, row.articleId, ...rowsFrom(row.evidence)]
      .map((value) => String(value ?? "").toLocaleLowerCase())
      .some((value) => value.includes(needle));
  });
  return {
    count: filtered.length,
    open: filtered.filter((row) => text(row.status, "open") === "open").length,
    next: filtered.slice(0, 10),
    rows: filtered,
    counts: queueCounts(filtered),
  };
}

export function buildNewsroomWorkQueue({
  sourceResolution = {},
  imageRightsQueue = {},
  reviewRows = [],
  sourceHealth = {},
  newsroom = {},
  productionMonitor = {},
  generatedAt = new Date().toISOString(),
} = {}) {
  const tasks = [];
  const lookup = articleLookup(reviewRows);
  buildProductionTask(tasks, productionMonitor);
  buildEditorialTasks(tasks, reviewRows);
  buildSourceTasks(tasks, sourceResolution, lookup);
  buildImageTasks(tasks, imageRightsQueue, lookup);
  buildFeedTasks(tasks, sourceHealth);
  buildDraftTasks(tasks, newsroom);
  tasks.sort(sortTasks);
  return {
    version: 1,
    generatedAt,
    noindex: true,
    count: tasks.length,
    open: tasks.length,
    next: tasks.slice(0, 10),
    rows: tasks,
    counts: queueCounts(tasks),
    note: "인증 관리자 전용 작업 큐. 작업 카드는 승인·발행을 자동 실행하지 않으며 기존 검수 CLI의 다음 명령만 안내합니다.",
  };
}

export function mergePublicCorrectionRequests(queue, correctionRows, generatedAt = new Date().toISOString()) {
  const tasks = [...rowsFrom(queue?.rows)];
  buildPublicCorrectionTasks(tasks, correctionRows);
  tasks.sort(sortTasks);
  return {
    ...(queue || {}),
    version: 1,
    generatedAt,
    noindex: true,
    count: tasks.length,
    open: tasks.length,
    next: tasks.slice(0, 10),
    rows: tasks,
    counts: queueCounts(tasks),
  };
}

export function newsroomWorkQueueMarkdown(report = {}) {
  const rows = rowsFrom(report.rows);
  const counts = report.counts?.byType || {};
  return [
    "# 뉴스룸 통합 작업 큐",
    "",
    `- 생성 시각: ${report.generatedAt || "-"}`,
    `- 미처리 작업: ${report.open || rows.length}`,
    `- 유형: ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(" · ") || "없음"}`,
    "",
    "우선순위가 높은 항목부터 처리합니다. 이 큐는 공개 상태를 자동 변경하지 않습니다.",
    "",
    ...rows.slice(0, 200).map((row, index) => `${index + 1}. [${row.priority}] ${row.label} · ${row.articleId || row.id} · ${row.title || ""} · ${row.reason || ""}`),
    "",
  ].join("\n");
}
