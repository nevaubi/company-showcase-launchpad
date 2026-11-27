// A company's rows of the coverage ledger, read in the browser (row-level security: people with app
// access). Used by the company tabs' empty states, the admin company view and the assistant.
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CORPORA, type CoverageRow, type CoverageState } from "./corpora";

export interface CompanyCoverage {
  /** when the ledger last checked this company; null when it holds no row for it */
  checked: string | null;
  /** one row per corpus, in the order of the rules */
  rows: CoverageRow[];
}

export async function readCompanyCoverage(ticker: string): Promise<CompanyCoverage> {
  const t = ticker.toUpperCase();
  const { data, error } = await supabase.from("corpus_coverage").select("corpus, state, items, newest, why, checked_at").eq("ticker", t);
  if (error) throw new Error(error.message);
  const by = new Map((data ?? []).map((r) => [r.corpus, r]));
  const rows = CORPORA.flatMap((def) => {
    const r = by.get(def.id);
    return r ? [{ ticker: t, corpus: def.id, state: r.state as CoverageState, items: r.items, newest: r.newest, why: r.why }] : [];
  });
  const checked = (data ?? []).map((r) => r.checked_at).sort().pop() ?? null;
  return { checked, rows };
}

/** Cached for ten minutes: the ledger changes once a day. */
export const companyCoverageQuery = (ticker: string) =>
  queryOptions({ queryKey: ["coverage", "company", ticker.toUpperCase()], queryFn: () => readCompanyCoverage(ticker), staleTime: 10 * 60_000 });
