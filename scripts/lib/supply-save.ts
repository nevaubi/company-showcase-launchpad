// Saving one company's supply signals of one source kind (review F16). The replace runs in the
// database function replace_supply_signals (migration 0066), one transaction: the stored signals
// are either all replaced or left exactly as they were.
export const REPLACE_FN = "replace_supply_signals";

import type { SupabaseClient } from "@supabase/supabase-js";

/** The function is not in the database yet (the worker deployed before the app's migration ran). */
export const missingFunction = (e: { message: string; code?: string }) => e.code === "PGRST202" || e.code === "42883" || /Could not find the function|function .*replace_supply_signals.* does not exist/i.test(e.message);

export type SaveResult = { stored: number; via: "rpc" | "fallback"; note?: string } | { stored: 0; via: "none"; reason: string };

/**
 * Replace `ticker`'s `sourceKind` signals with `rows`. Empty rows store nothing and keep what is stored
 * (an empty answer is no evidence the stored signals are wrong). Throws when the database refuses,
 * which fails the stage and leaves the stored signals untouched. Only while the function does not
 * exist yet (the worker deployed before the app's migration ran) the old two-step save runs: insert
 * the new rows, then delete the others. It never loses a stored signal and at worst leaves extras;
 * failing instead would throw away the AI answer the stage already paid for.
 */
export async function saveSignals(client: SupabaseClient, ticker: string, sourceKind: string, rows: Record<string, unknown>[]): Promise<SaveResult> {
  if (!rows.length) return { stored: 0, via: "none", reason: "no rows" };
  const bad = rows.find((r) => r.ticker !== ticker || r.source_kind !== sourceKind);
  if (bad) throw new Error(`save refused: a row for ${String(bad.ticker)} ${String(bad.source_kind)} in the ${ticker} ${sourceKind} batch`);
  const { data, error } = await client.rpc(REPLACE_FN, { _ticker: ticker, _source_kind: sourceKind, _rows: rows });
  if (error && missingFunction(error)) return fallback(client, ticker, sourceKind, rows);
  if (error) throw new Error(`save failed: ${error.message}`);
  const stored = Number(data);
  if (!Number.isFinite(stored) || stored !== rows.length) throw new Error(`save stored ${String(data)} of ${rows.length} rows`);
  return { stored, via: "rpc" };
}

async function fallback(client: SupabaseClient, ticker: string, sourceKind: string, rows: Record<string, unknown>[]): Promise<SaveResult> {
  const { data, error } = await client.from("supply_signals").insert(rows as never).select("id");
  if (error) throw new Error(`insert failed: ${error.message}`);
  const ids = ((data ?? []) as { id: string }[]).map((d) => d.id);
  if (ids.length !== rows.length) throw new Error(`insert stored ${ids.length} of ${rows.length} rows`);
  const { error: del } = await client.from("supply_signals").delete().eq("ticker", ticker).eq("source_kind", sourceKind).not("id", "in", `(${ids.join(",")})`);
  return { stored: ids.length, via: "fallback", note: del ? `${REPLACE_FN} missing; old rows not removed: ${del.message}` : `${REPLACE_FN} missing; two-step save` };
}
