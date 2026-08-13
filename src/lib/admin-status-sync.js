function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function syncAdminStatus(adminReport, operationsStatus, imageRightsQueue, workQueue = null, syncedAt = new Date().toISOString()) {
  const current = objectValue(adminReport);
  const operations = objectValue(operationsStatus);
  const imageRights = objectValue(imageRightsQueue);
  const work = workQueue === null ? objectValue(current.workQueue) : objectValue(workQueue);
  if (!Object.keys(current).length) throw new Error("admin-review.json이 비어 있습니다.");
  if (!Object.keys(operations).length) throw new Error("operations-status.json이 비어 있습니다.");
  if (!Object.keys(imageRights).length) throw new Error("image-rights-queue.json이 비어 있습니다.");
  if (!Object.keys(work).length) throw new Error("newsroom-work-queue.json이 비어 있습니다.");
  return {
    ...current,
    operationsStatus: operations,
    imageRightsQueue: imageRights,
    workQueue: work,
    statusSyncedAt: syncedAt,
  };
}
