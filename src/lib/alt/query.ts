import { supabase } from "@/integrations/supabase/client";

export interface AltRow {
  uid: string;
  ticker: string;
  dataset: string;
  kind: "event" | "series";
  date: string | null;
  title: string;
  value: number | null;
  unit: string | null;
  meta: Record<string, any>;
  source: string;
  source_url: string | null;
}

export const DATASETS: Record<string, { label: string; blurb: string; source: string }> = {
  ownership: { label: "Ownership & activists", blurb: "Schedule 13D (activist) and 13G (5%+ passive) holder filings", source: "SEC EDGAR" },
  events: { label: "Corporate events", blurb: "8-K items: deals, M&A, new debt, restructurings, impairments, exec changes, auditor changes, restatements, cyber incidents", source: "SEC EDGAR" },
  contracts: { label: "Government contracts", blurb: "Federal contract obligations by fiscal year and the largest awards", source: "USAspending.gov" },
  regulatory: { label: "Regulatory actions", blurb: "Rules, proposed rules and notices in the Federal Register naming the company", source: "Federal Register" },
  fda: { label: "FDA approvals & recalls", blurb: "Drug approvals and new indications, drug/device/food recalls", source: "openFDA" },
  recalls: { label: "Vehicle & equipment recalls", blurb: "NHTSA recall campaigns and units affected", source: "NHTSA" },
  complaints: { label: "Consumer complaints", blurb: "CFPB complaints per year with product mix", source: "CFPB" },
  bank: { label: "Bank call reports", blurb: "Quarterly FDIC data for the main insured bank: deposits, loans, NIM, charge-offs, capital", source: "FDIC" },
  attention: { label: "Public attention", blurb: "Monthly Wikipedia pageviews — a free demand/interest proxy", source: "Wikimedia" },
};

async function pageAll(build: () => any): Promise<AltRow[]> {
  const out: AltRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as AltRow[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const altCompanyQuery = (ticker: string) => ({
  queryKey: ["alt_data", ticker],
  queryFn: () => pageAll(() => supabase.from("alt_data").select("*").eq("ticker", ticker).order("date", { ascending: false })),
  staleTime: 10 * 60_000,
});

/** Latest events across all companies for one dataset. */
export const altFeedQuery = (dataset: string) => ({
  queryKey: ["alt_feed", dataset],
  queryFn: async () => {
    const { data, error } = await supabase.from("alt_data").select("*").eq("dataset", dataset).eq("kind", "event").not("date", "is", null).order("date", { ascending: false }).limit(300);
    if (error) throw error;
    return (data ?? []) as AltRow[];
  },
  staleTime: 10 * 60_000,
});

/** Recent series rows across companies (last ~3 years) for leaderboards. */
export const altSeriesQuery = (dataset: string) => ({
  queryKey: ["alt_series", dataset],
  queryFn: () => {
    const since = `${new Date().getFullYear() - 3}-01-01`;
    return pageAll(() => supabase.from("alt_data").select("ticker,dataset,kind,date,title,value,unit,meta,source,source_url,uid").eq("dataset", dataset).eq("kind", "series").gte("date", since).order("date", { ascending: false }));
  },
  staleTime: 10 * 60_000,
});

/** Group series rows by title, ascending by date. */
export function seriesByTitle(rows: AltRow[]) {
  const m = new Map<string, AltRow[]>();
  for (const r of rows) if (r.kind === "series" && r.value != null && r.date) (m.get(r.title) ?? m.set(r.title, []).get(r.title)!).push(r);
  for (const v of m.values()) v.sort((a, b) => a.date!.localeCompare(b.date!));
  return m;
}

/** Latest value per ticker and its change vs one year earlier (same title). */
export function leaderboard(rows: AltRow[], title: string) {
  const by = new Map<string, AltRow[]>();
  const full = rows.filter((r) => !r.meta?.ytd);
  for (const r of full) if (r.title === title && r.value != null && r.date) (by.get(r.ticker) ?? by.set(r.ticker, []).get(r.ticker)!).push(r);
  return [...by.entries()].map(([ticker, rs]) => {
    rs.sort((a, b) => b.date!.localeCompare(a.date!));
    const last = rs[0];
    const yearAgo = rs.find((r) => r.date! <= `${Number(last.date!.slice(0, 4)) - 1}${last.date!.slice(4)}`);
    return { ticker, last, prior: yearAgo ?? null, chg: yearAgo?.value ? last.value! / yearAgo.value - 1 : null };
  }).sort((a, b) => (b.last.value ?? 0) - (a.last.value ?? 0));
}

export function fmtAlt(v: number | null, unit: string | null) {
  if (v == null) return "—";
  if (unit === "USD") { const a = Math.abs(v); return a >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1e3).toFixed(0)}K`; }
  if (unit === "%") return `${v.toFixed(2)}%`;
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(0)}K` : v.toLocaleString();
}

/** Event counts per company × dataset in 90-day windows (last ~27 months). */
export const altBucketsQuery = () => ({
  queryKey: ["alt_buckets"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("alt_event_buckets");
    if (error) throw error;
    return (data ?? []) as { ticker: string; dataset: string; bucket: number; n: number; last_date: string | null }[];
  },
  staleTime: 10 * 60_000,
});

export const altSourceStatsQuery = () => ({
  queryKey: ["alt_source_stats"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("alt_source_stats");
    if (error) throw error;
    return (data ?? []) as { dataset: string; rows: number; tickers: number; latest: string | null; refreshed: string | null }[];
  },
  staleTime: 10 * 60_000,
});

/** Events for one company × dataset in the last `days`. */
export const altCellQuery = (ticker: string, dataset: string, days = 90) => ({
  queryKey: ["alt_cell", ticker, dataset, days],
  queryFn: async () => {
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    const { data, error } = await supabase.from("alt_data").select("*").eq("ticker", ticker).eq("dataset", dataset).eq("kind", "event").gte("date", since).order("date", { ascending: false }).limit(200);
    if (error) throw error;
    return (data ?? []) as AltRow[];
  },
  staleTime: 10 * 60_000,
});

/** Red-flag 8-K items and activist 13Ds in the last 90 days. */
export const altRedFlagsQuery = (items: string[]) => ({
  queryKey: ["alt_redflags", items.join(",")],
  queryFn: async () => {
    const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const [ev, own] = await Promise.all([
      supabase.from("alt_data").select("*").eq("dataset", "events").in("meta->>item", items).gte("date", since).order("date", { ascending: false }).limit(300),
      supabase.from("alt_data").select("*").eq("dataset", "ownership").eq("meta->>activist", "true").gte("date", since).order("date", { ascending: false }).limit(100),
    ]);
    if (ev.error) throw ev.error;
    if (own.error) throw own.error;
    return [...(own.data ?? []), ...(ev.data ?? [])] as AltRow[];
  },
  staleTime: 10 * 60_000,
});
