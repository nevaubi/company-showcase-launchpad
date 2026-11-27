import { classify } from "@/lib/jobs/failure";

export const STALE_LOCK_MS = 4 * 60_000;
const RETRY_WAIT_MS = 60 * 60_000;

interface Slot {
  status: "ready" | "generating" | "failed";
  data_version: string;
  updated_at: string;
  started_at: string | null;
  error: string | null;
}

export function reportRefreshDue(row: Slot | undefined, version: string | null, now = Date.now()): boolean {
  if (!version) return false;
  if (!row) return true;
  if (row.status === "generating") return !row.started_at || now - Date.parse(row.started_at) >= STALE_LOCK_MS;
  if (row.status === "ready" && row.data_version === version) return false;
  if (!row.error) return row.status === "ready" || row.data_version !== version;
  const failure = classify({ message: row.error });
  if (failure === "quota" || failure === "config") return false;
  if (now - Date.parse(row.updated_at) < RETRY_WAIT_MS) return false;
  return failure === "transient" || failure === "rate" || /interrupted writer|HTTP 524/i.test(row.error)
    || (row.status === "failed" && row.data_version !== version);
}
