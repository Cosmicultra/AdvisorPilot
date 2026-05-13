export type StatementUploadQueueItem = {
  id: string;
  file: File;
  /** 1-based pages that contain holdings (e.g. 1-2, 1,3,5, 1-3,5-6,10-11). */
  holdingsPages: string;
};

export function newStatementUploadId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `up-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
