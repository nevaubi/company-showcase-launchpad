// Loading "what changed" files and per-user company visits.
import {
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { partnerFile } from "@/lib/data";
import { visitBaseline, type CompanyVisit } from "./core";
import type { ChangesFeed, CompanyChanges } from "./types";

export { visitBaseline, type CompanyVisit };

export const changesFeedQuery = queryOptions({
  queryKey: ["changes", "feed"],
  queryFn: () => partnerFile<ChangesFeed>("changes/feed.json"),
  staleTime: 10 * 60_000,
  retry: 1,
});

export const companyChangesQuery = (t: string) =>
  queryOptions({
    queryKey: ["changes", "company", t],
    queryFn: () => partnerFile<CompanyChanges>(`changes/${t}.json`),
    staleTime: 10 * 60_000,
    retry: 0,
  });

/** Change files for several companies (watchlist rows, the digest). Missing files resolve to null. */
export function useCompanyChangesMany(tickers: string[]) {
  return useQueries({
    queries: tickers.map((t) => ({
      queryKey: ["changes", "company-or-null", t],
      queryFn: (): Promise<CompanyChanges | null> =>
        partnerFile<CompanyChanges>(`changes/${t}.json`).catch(() => null),
      staleTime: 10 * 60_000,
      retry: 0,
    })),
  });
}

/** All of the user's company visits (last and previous visit per ticker). */
export function useVisits() {
  return useQuery({
    queryKey: ["company-visits"],
    queryFn: async (): Promise<Record<string, CompanyVisit>> => {
      const { data, error } = await supabase
        .from("company_visits")
        .select("ticker, last_seen_at, previous_seen_at");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((v) => [v.ticker, v as CompanyVisit]));
    },
    staleTime: 60_000,
    retry: 0,
  });
}

/**
 * The visit this page view is measured against (null on a first visit). With `record`, the new visit is written
 * once per mount after a short delay, so a quick bounce does not reset the badges. Only the company layout records.
 */
export function useCompanyVisit(ticker: string, record = false) {
  const qc = useQueryClient();
  const visits = useVisits();
  const recorded = useRef<string | null>(null);
  const rec = useMutation({
    mutationFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return;
      const cur = visits.data?.[ticker];
      // Inside one session keep the older baseline; otherwise the last visit becomes the previous one.
      const prior = cur ? visitBaseline(cur) : null;
      const { error } = await supabase.from("company_visits").upsert(
        {
          user_id: auth.user.id,
          ticker,
          last_seen_at: new Date().toISOString(),
          previous_seen_at: prior,
        },
        { onConflict: "user_id,ticker" },
      );
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["company-visits"] }),
  });
  const baseline = useRef<{ t: string; since: string | null } | null>(null);
  if (visits.isSuccess && baseline.current?.t !== ticker)
    baseline.current = { t: ticker, since: visitBaseline(visits.data[ticker]) };
  useEffect(() => {
    if (!record || !visits.isSuccess || recorded.current === ticker) return;
    const id = setTimeout(() => {
      recorded.current = ticker;
      rec.mutate();
    }, 8000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, visits.isSuccess, record]);
  return {
    ready: baseline.current?.t === ticker,
    since: baseline.current?.t === ticker ? baseline.current.since : null,
  };
}

/** Count of events new since the user's last visit, for a watchlist row. */
export function useNewCounts(tickers: string[]) {
  const files = useCompanyChangesMany(tickers);
  const visits = useVisits();
  return useMemo(() => {
    const out: Record<string, { n: number; high: number }> = {};
    for (const f of files) {
      if (!f.data) continue;
      const since = visitBaseline(visits.data?.[f.data.ticker]);
      if (!since) continue;
      const fresh = f.data.events.filter(
        (e) => !e.upcoming && (e.first_seen ?? `${e.date}T00:00:00Z`) > since,
      );
      out[f.data.ticker] = { n: fresh.length, high: fresh.filter((e) => e.tier === "high").length };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.map((f) => f.dataUpdatedAt).join(","), visits.data]);
}
