import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { StoredDetail } from "@/lib/xbrl/detail";

const hour = 3_600_000;

/** Latest 10-K / 10-Q dimensional detail (built by scripts/xbrl-detail.ts); null when not built yet. */
export const filingDetailQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["xbrl-detail", ticker],
    queryFn: async (): Promise<StoredDetail | null> => {
      const { data, error } = await supabase.storage.from("datasets").download(`detail/${ticker}.json`);
      if (error || !data) return null;
      return JSON.parse(await data.text()) as StoredDetail;
    },
    staleTime: 6 * hour,
    retry: 1,
  });

export interface ConcentrationMention {
  ticker: string;
  form: string;
  filed: string;
  period_end: string;
  kind: string;
  benchmark: string;
  label: string;
  pct: number;
  accn: string;
  element_id: string | null;
}

/** Other covered companies whose filings name this company as a major customer or supplier. */
export const namedByQuery = (ticker: string) =>
  queryOptions({
    queryKey: ["xbrl-named-by", ticker],
    queryFn: async (): Promise<ConcentrationMention[]> => {
      const { data, error } = await supabase
        .from("xbrl_concentration")
        .select("ticker, form, filed, period_end, kind, benchmark, label, pct, accn, element_id")
        .eq("counterparty", ticker)
        .order("period_end", { ascending: false })
        .limit(200);
      if (error) throw error;
      // newest period per reporting company and kind
      const seen = new Set<string>();
      return (data ?? []).filter((r) => {
        const k = `${r.ticker}|${r.kind}|${r.benchmark}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      }) as ConcentrationMention[];
    },
    staleTime: 6 * hour,
  });
