import { classify } from "@/lib/jobs/failure";
import { byRank } from "@/lib/jobs/priority";
import type { SupabaseClient } from "@supabase/supabase-js";

type ReaderStatus = "extract_status" | "vision_status" | "prose_status";

/** Running the same input against the same output limit cannot fix a truncated response. */
export async function requeueReaderErrors(client: SupabaseClient, ticker: string, field: ReaderStatus) {
  const reset = field === "extract_status"
    ? { extract_status: null, extracted_at: null }
    : field === "prose_status" ? { prose_status: null, prose_at: null } : { vision_status: null };
  const { count, error } = await client.from("ir_documents")
    .update(reset, { count: "exact" })
    .eq("ticker", ticker)
    .like(field, "error:%")
    .not(field, "ilike", String.raw`%max\_output\_tokens%`);
  if (error) throw new Error(`Could not requeue ${ticker} ${field}: ${error.message}`);
  return count ?? 0;
}

/** A held failure still belongs in the company's review count. An unread hold has no error. */
export const VISION_REVIEW_FILTER = "vision_status.like.error:*,vision_status.like.held:historical-vision:review*";

/** Files that make a finished company worth re-reading (same kinds the readers handle). */
export const REREAD_KINDS = ["press-release", "supplement", "presentation", "data", "other", "image"];
export const REREAD_WINDOW_DAYS = 30;

/**
 * Finished companies to re-read: any one new readable file (from any source — SEC job, IR site,
 * mirror import, owner staging) fetched after the last check and filed in the last 30 days.
 * Returns the tickers and the new high-water mark for `fetched_at`.
 */
export function rereadTickers(done: Iterable<string>, rows: { ticker: string; fetched_at: string; filed: string | null; kind: string }[], since: string, today = new Date()) {
  const finished = new Set(done);
  const cutoff = new Date(today.getTime() - REREAD_WINDOW_DAYS * 86400000).toISOString().slice(0, 10);
  let last = since;
  const tickers = new Set<string>();
  for (const r of rows) {
    if (r.fetched_at > last) last = r.fetched_at;
    if (r.fetched_at <= since || !r.filed || r.filed < cutoff || !REREAD_KINDS.includes(r.kind)) continue;
    if (finished.has(r.ticker)) tickers.add(r.ticker);
  }
  return { tickers: [...tickers], last };
}

// ---------- configuration-failed documents (P0-4) ----------

/** IR_REQUEUE_CONFIG=1 turns the re-queue on (off by default: every re-queued document spends an AI read). */
export const requeueEnabled = (env: Record<string, string | undefined>) => env["IR_REQUEUE_CONFIG"] === "1";
/** Documents reset per pass (env IR_REQUEUE_CONFIG_MAX, default 2,000, hard cap 5,000). */
export const requeueLimit = (env: Record<string, string | undefined>) => Math.max(0, Math.min(5000, Number(env["IR_REQUEUE_CONFIG_MAX"] ?? 2000) || 0));

/** SQL prefilter for stored statuses (the pure `isConfigFailure` decides). Only the message seen in production. */
export const CONFIG_STATUS_LIKE = "error:%Invalid model ID%";

/**
 * A stored reader status that records a configuration failure (wrong model id, missing key), not a
 * bad document. Only `error:` statuses qualify; "rendition failed: Invalid row number in model" and
 * ordinary rejects do not.
 */
export function isConfigFailure(status: string | null | undefined): boolean {
  if (!status || !status.startsWith("error:")) return false;
  return classify({ message: status.slice("error:".length).trim() }) === "config";
}

export interface FailedDoc {
  id: string;
  ticker: string;
  status: string | null;
}

/**
 * Which configuration-failed documents to reset this pass: only rows whose stored error is a config
 * failure, top-ranked companies first (rank = dv20), input order among equals, at most `limit`.
 * Returns the ids and the companies touched.
 */
export function requeuePlan(rows: readonly FailedDoc[], rank: Map<string, number>, limit: number): { ids: string[]; tickers: string[] } {
  const picked = byRank(
    rows.filter((r) => isConfigFailure(r.status)),
    (r) => r.ticker,
    rank,
  ).slice(0, Math.max(0, limit));
  return { ids: picked.map((r) => r.id), tickers: [...new Set(picked.map((r) => r.ticker))] };
}
