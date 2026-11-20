import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { coverageOf } from "@/lib/coverage";
import { universeQuery } from "@/lib/data";
import { tickerKeys, type CompanyKeys } from "@/lib/alt/contracts";
import { BUCKET_RECOUNT, eventBuckets, screenAltRows, withScreenColumns, type EventBucket, type ScreenRowLike } from "@/lib/alt/screen";

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

/**
 * Who each ticker is, for checking that a stored row is the company's own (coverage short name,
 * hand-checked registry name, universe legal name). Rows of unknown companies are dropped.
 */
export async function altKeysFor(client: QueryClient | undefined): Promise<(ticker: string) => CompanyKeys | null> {
  const uni = client ? await client.ensureQueryData(universeQuery).catch(() => null) : null;
  const legal = new Map((uni?.companies ?? []).map((c) => [c.ticker, c.name]));
  return (t) => {
    const short = coverageOf(t)?.shortName;
    const name = legal.get(t);
    return short || name ? tickerKeys(t, short, name) : null;
  };
}

/**
 * Stored rows with everything `screenAltRows` (src/lib/alt/screen.ts) refuses removed: contract awards
 * of other recipients, FDA firms, trial sponsors and vehicle makers that only share the company's
 * name, and FDIC zero placeholders.
 */
export async function screenAlt<T extends ScreenRowLike>(rows: T[], client: QueryClient | undefined): Promise<T[]> {
  return screenAltRows(rows, await altKeysFor(client));
}

/**
 * The one way to read `alt_data` rows: selects `columns` plus what the screen needs, lets `build`
 * add filters, ordering and a limit, and returns screened rows. A limit applies before screening, so
 * a reader may get fewer rows than it asked for.
 */
/** The `alt_data` select builder a reader adds filters, ordering and a limit to. */
const altSelect = (columns: string) => supabase.from("alt_data").select(columns);
export type AltQuery = ReturnType<typeof altSelect>;

export async function readAlt<T = AltRow>(columns: string, build: (q: AltQuery) => AltQuery, client?: QueryClient): Promise<T[]> {
  const { data, error } = await build(altSelect(withScreenColumns(columns)));
  if (error) throw error;
  return (await screenAlt((data ?? []) as unknown as ScreenRowLike[], client)) as T[];
}

/** `readAlt` over every page of a query (1,000 rows a page); `build` must set a stable order. */
export async function readAltAll<T = AltRow>(columns: string, build: (q: AltQuery) => AltQuery, client?: QueryClient): Promise<T[]> {
  const out: ScreenRowLike[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(altSelect(withScreenColumns(columns))).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as ScreenRowLike[]));
    if (!data || data.length < 1000) break;
  }
  return (await screenAlt(out, client)) as T[];
}

/** The newest stored date of one dataset (no row content, so nothing to screen). */
async function latestDate(dataset: string): Promise<string | undefined> {
  const { data, error } = await supabase.from("alt_data").select("date").eq("dataset", dataset).order("date", { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0]?.date as string | undefined) ?? undefined;
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
  capital: { label: "Capital markets", blurb: "Shelf registrations, bond/equity takedowns, tender offers, merger registrations and stock-plan filings", source: "SEC EDGAR" },
  trials: { label: "Clinical trials", blurb: "Trials the company leads as sponsor: phase, status, enrollment and completion dates", source: "ClinicalTrials.gov" },
  consumer: { label: "Consumer product recalls", blurb: "CPSC recalls naming the company as maker, importer or retailer, with units and hazard", source: "CPSC" },
  attention: { label: "Public attention", blurb: "Monthly Wikipedia pageviews — a free demand/interest proxy", source: "Wikimedia" },
  medicare: { label: "Medicare drug spending", blurb: "Gross Medicare spending on the company's drugs — Part D (pharmacy) and Part B (given in clinics) — per year and the latest quarter, before rebates", source: "CMS" },
  medicare_states: { label: "Medicare drugs by state", blurb: "Gross Medicare Part D drug costs for the company's own brands by the prescriber's state, its slice of each state's Part D spending and how far each state over- or under-indexes vs Medicare overall", source: "CMS" },
  tri: { label: "Plants & releases", blurb: "EPA Toxics Release Inventory: the company's US plants that handle listed chemicals, by state, with yearly releases and a production index (each plant's reported production this year ÷ last year)", source: "EPA" },
  deposits: { label: "Deposits by state", blurb: "Branch deposits each June 30 by state and metro area for all the company's insured banks, with its share of each state's deposits", source: "FDIC" },
  settlement: { label: "Fails to deliver", blurb: "Shares sold but not delivered on settlement day (NSCC), average daily balance per half-month valued at the day's price; persistent or spiking fails can flag hard-to-borrow stock", source: "SEC" },
};

export interface AltLeader {
  ticker: string;
  date: string;
  value: number;
  unit: string | null;
  meta: Record<string, any> | null;
  source_url: string | null;
  prior_value: number | null;
  prior_date: string | null;
  base_median: number | null;
  base_n: number | null;
}

/** Latest reading per company for one series, with the reading a year earlier and its trailing-year median (computed in the database). */
export const altLeadersQuery = (dataset: string, title: string) => ({
  queryKey: ["alt_leaders", dataset, title],
  queryFn: async ({ client }: { client?: QueryClient }) => {
    const out: AltLeader[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.rpc("alt_series_leaders", { _dataset: dataset, _title: title }).range(from, from + 999);
      if (error) throw error;
      out.push(...((data ?? []) as AltLeader[]));
      if (!data || data.length < 1000) break;
    }
    return screenAlt(out.map((r) => ({ ...r, dataset, kind: "series" })), client);
  },
  staleTime: 10 * 60_000,
});

/** Change vs a year earlier and the multiple of the company's own trailing-year median. */
export function leaderStats(r: AltLeader) {
  const chg = r.prior_value ? r.value / r.prior_value - 1 : null;
  const vsTypical = r.base_median && r.base_median > 0 && (r.base_n ?? 0) >= 4 ? r.value / r.base_median : null;
  return { chg, vsTypical };
}

export const altCompanyQuery = (ticker: string) => ({
  queryKey: ["alt_data", ticker],
  queryFn: async ({ client }: { client?: QueryClient }) => readAltAll("*", (q) => q.eq("ticker", ticker).order("date", { ascending: false }).order("uid"), client),
  staleTime: 10 * 60_000,
});

/** Latest events across all companies for one dataset. */
export const altFeedQuery = (dataset: string) => ({
  queryKey: ["alt_feed", dataset],
  queryFn: async ({ client }: { client?: QueryClient }) => readAlt("*", (q) => q.eq("dataset", dataset).eq("kind", "event").not("date", "is", null).order("date", { ascending: false }).limit(300), client),
  staleTime: 10 * 60_000,
});

/** Group series rows by title, ascending by date. */
export function seriesByTitle(rows: AltRow[]) {
  const m = new Map<string, AltRow[]>();
  for (const r of rows) if (r.kind === "series" && r.value != null && r.date) (m.get(r.title) ?? m.set(r.title, []).get(r.title)!).push(r);
  for (const v of m.values()) v.sort((a, b) => a.date!.localeCompare(b.date!));
  return m;
}

export function fmtAlt(v: number | null, unit: string | null) {
  if (v == null) return "—";
  if (unit === "USD") { const a = Math.abs(v); return a >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(0)}K` : `$${v.toFixed(0)}`; }
  if (unit === "%") return `${v.toFixed(2)}%`;
  if (unit === "ratio") return `${v.toFixed(2)}×`;
  if (unit === "lbs") return `${v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(0)}K` : Math.round(v).toLocaleString()} lb`;
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${(v / 1e3).toFixed(0)}K` : v.toLocaleString();
}

/**
 * Event counts per company × dataset in 90-day windows (last ~27 months). The database function counts
 * stored rows, misattributed ones included until the repair runs, so the datasets the screen judges
 * (BUCKET_RECOUNT) are recounted here from screened rows.
 */
export const altBucketsQuery = () => ({
  queryKey: ["alt_buckets"],
  queryFn: async ({ client }: { client?: QueryClient }) => {
    const today = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 810 * 864e5).toISOString().slice(0, 10);
    const [{ data, error }, screened] = await Promise.all([
      supabase.rpc("alt_event_buckets"),
      readAltAll<{ ticker: string; dataset: string; date: string | null }>(
        "uid,ticker,dataset,kind,date,meta",
        (q) => q.eq("kind", "event").in("dataset", [...BUCKET_RECOUNT]).gt("date", from).lte("date", today).order("uid"),
        client,
      ),
    ]);
    if (error) throw error;
    const recount = new Set<string>(BUCKET_RECOUNT);
    const rows = ((data ?? []) as EventBucket[]).filter((r) => !recount.has(r.dataset));
    return [...rows, ...eventBuckets(screened, today)];
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
  queryFn: async ({ client }: { client?: QueryClient }) => {
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
    return readAlt("*", (q) => q.eq("ticker", ticker).eq("dataset", dataset).eq("kind", "event").gte("date", since).order("date", { ascending: false }).limit(200), client);
  },
  staleTime: 10 * 60_000,
});

/** Red-flag 8-K items and activist 13Ds in the last 90 days. */
export const altRedFlagsQuery = (items: string[]) => ({
  queryKey: ["alt_redflags", items.join(",")],
  queryFn: async ({ client }: { client?: QueryClient }) => {
    const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const [ev, own] = await Promise.all([
      readAlt("*", (q) => q.eq("dataset", "events").in("meta->>item", items).gte("date", since).order("date", { ascending: false }).limit(300), client),
      readAlt("*", (q) => q.eq("dataset", "ownership").eq("meta->>activist", "true").gte("date", since).order("date", { ascending: false }).limit(100), client),
    ]);
    return [...own, ...ev];
  },
  staleTime: 10 * 60_000,
});

/** Every covered bank's deposits by state for the latest two June 30 surveys (FDIC Summary of Deposits). */
export const depositsByStateQuery = () => ({
  queryKey: ["alt_deposits_states"],
  queryFn: async ({ client }: { client?: QueryClient }) => {
    const latest = await latestDate("deposits");
    if (!latest) return { latest: null as string | null, rows: [] as AltRow[] };
    const prior = `${Number(latest.slice(0, 4)) - 1}${latest.slice(4)}`;
    const rows = await readAltAll("uid,ticker,dataset,kind,date,title,value,unit,meta,source,source_url", (q) => q.eq("dataset", "deposits").in("date", [latest, prior]).order("uid"), client);
    return { latest, rows };
  },
  staleTime: 60 * 60_000,
});

/** Every drug maker's Part D drug costs in one state for the latest year (CMS prescribers by geography). */
export const medicareStateQuery = (state: string) => ({
  queryKey: ["alt_medicare_state", state],
  queryFn: async ({ client }: { client?: QueryClient }) => {
    const latest = await latestDate("medicare_states");
    if (!latest) return { latest: null, rows: [] as AltRow[] };
    const rows = await readAlt("uid,ticker,dataset,kind,date,title,value,unit,meta,source,source_url", (q) => q.eq("dataset", "medicare_states").eq("title", `Part D · ${state}`).eq("date", latest).order("value", { ascending: false }).limit(200), client);
    return { latest, rows };
  },
  staleTime: 6 * 60 * 60_000,
});
