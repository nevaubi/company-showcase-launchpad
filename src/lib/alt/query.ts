import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { COVERAGE, coverageOf } from "@/lib/coverage";
import { universeQuery } from "@/lib/data";
import { isPartial } from "@/lib/alt/periods";
import { ALT_NAMES, REFRESH_DATASET, sharedCores, tickerKeys, type CompanyKeys } from "@/lib/alt/contracts";
import { bucketCandidates, confirmCounts, confirmSeries, rangeCandidates, rankUnusual, type UnusualItem } from "@/lib/alt/hub";
import { RANGE_RULES, RISE_LOOKBACK_DAYS, RISE_WINDOWS } from "@/lib/alt/history";
import { screenAltRows, withScreenColumns, type EventBucket, type ScreenRowLike } from "@/lib/alt/screen";

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
 * hand-checked registry name, universe legal name, hand-checked recipient aliases). Rows of unknown
 * companies are dropped. A failed universe fetch fails the read rather than judging one-word
 * companies ("Boeing") without their legal names, which would hide their rows without a word.
 */
export async function altKeysFor(client: QueryClient | undefined): Promise<(ticker: string) => CompanyKeys | null> {
  const uni = client ? await client.ensureQueryData(universeQuery) : null;
  const legal = new Map((uni?.companies ?? []).map((c) => [c.ticker, c.name]));
  const shared = sharedCores(COVERAGE.map((c) => ({ cik: c.cik, names: [ALT_NAMES[c.ticker], c.shortName, legal.get(c.ticker)] })));
  return (t) => {
    const short = coverageOf(t)?.shortName;
    const name = legal.get(t);
    return short || name ? tickerKeys(t, short, name, shared) : null;
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

/**
 * Leave out stored contract award rows the old collector copied from the government-wide list
 * (`usa:` award rows without a recorded tie; transactions are `usatx:` and every award the fixed
 * collector stores carries `meta.tie`). Apply before a limit so they cannot fill it; the repair's
 * first part deletes them.
 */
export const withoutCopiedAwards = (q: AltQuery): AltQuery => q.or("uid.like.usatx:*,meta->>tie.not.is.null");

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

export { DATASETS } from "@/lib/alt/catalog";

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

/**
 * The leaderboard as a board of finished periods: a federal fiscal year still settling is replaced
 * by the year before it (the reading a year earlier is that year), and a month still running by the
 * company's latest finished month. Replaced rows carry no comparison, since the database computed
 * those against the period in progress. `settledFrom` names the period that was replaced.
 */
export const altSettledLeadersQuery = (dataset: string, title: string) => ({
  queryKey: ["alt_leaders_settled", dataset, title],
  queryFn: async ({ client }: { client?: QueryClient }): Promise<(AltLeader & { settledFrom?: string })[]> => {
    const today = new Date().toISOString().slice(0, 10);
    const raw = client ? await client.ensureQueryData(altLeadersQuery(dataset, title)) : await altLeadersQuery(dataset, title).queryFn({ client });
    const running = raw.filter((r) => isPartial(r, today) || (dataset === "attention" && r.date.slice(0, 7) >= today.slice(0, 7)));
    const monthly = running.filter((r) => !r.meta?.fiscal_year).map((r) => r.ticker);
    const prev = new Map<string, AltRow>();
    for (const part of chunks(monthly, 60)) {
      const rows = await readAltAll<AltRow>(ROW_COLUMNS, (q) => q.eq("dataset", dataset).eq("title", title).eq("kind", "series").in("ticker", part).lt("date", `${today.slice(0, 7)}-01`).gte("date", isoDaysAgo(70)).order("date", { ascending: false }).order("uid"), client);
      for (const r of rows) if (!prev.has(r.ticker) && r.value != null && r.date && !isPartial(r, today)) prev.set(r.ticker, r);
    }
    const out: (AltLeader & { settledFrom?: string })[] = [];
    for (const r of raw) {
      if (!running.includes(r)) { out.push(r); continue; }
      const from = r.date;
      if (r.meta?.fiscal_year) {
        if (r.prior_value != null && r.prior_date) out.push({ ...r, value: r.prior_value, date: r.prior_date, meta: { fiscal_year: Number(r.meta.fiscal_year) - 1 }, prior_value: null, prior_date: null, base_median: null, base_n: null, settledFrom: from });
        continue;
      }
      const p = prev.get(r.ticker);
      if (p) out.push({ ...r, value: p.value!, date: p.date!, meta: p.meta, source_url: p.source_url, prior_value: null, prior_date: null, base_median: null, base_n: null, settledFrom: from });
    }
    return out;
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
  queryFn: async ({ client }: { client?: QueryClient }) => readAltAll(ROW_COLUMNS, (q) => q.eq("ticker", ticker).order("date", { ascending: false }).order("uid"), client),
  staleTime: 10 * 60_000,
});

/** Latest events across all companies for one dataset. */
export const altFeedQuery = (dataset: string, prefix = "") => ({
  queryKey: ["alt_feed", dataset, prefix],
  queryFn: async ({ client }: { client?: QueryClient }) => {
    if (prefix && !/^[A-Z0-9.-]+$/.test(prefix)) return [];
    return readAlt("*", (q) => {
      let base = q.eq("dataset", dataset).eq("kind", "event").not("date", "is", null);
      if (prefix) base = base.like("ticker", prefix + "%");
      return (dataset === "contracts" ? withoutCopiedAwards(base) : base).order("date", { ascending: false }).order("uid").limit(300);
    }, client);
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

export { fmtAlt } from "@/lib/alt/catalog";

/** Every row of `alt_event_buckets` (stored rows per company × dataset × 90-day window), paged in a stable order. */
export async function eventBucketsAll(): Promise<EventBucket[]> {
  const out: EventBucket[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.rpc("alt_event_buckets").order("ticker").order("dataset").order("bucket").range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as EventBucket[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

const ROW_COLUMNS = "uid,ticker,dataset,kind,date,title,value,unit,meta,source,source_url";
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const chunks = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export interface UnusualNow {
  items: UnusualItem[];
  /** company × dataset pairs tested by the rise rule after the pre-screen */
  tested: number;
  /** company × dataset pairs with 3 or more rows in the latest 90 days but under a year of stored history before them */
  short: number;
  /** parts that could not be read (the rest is still shown) */
  failed: string[];
}

/**
 * What is unusual now, by the company tab's own rules. Counts: `alt_event_buckets` picks candidates
 * (`bucketCandidates`), then each candidate's rows of the last RISE_LOOKBACK_DAYS go through
 * `riseFlag`. Series: each range rule's leaderboard (paged) picks candidates (`rangeCandidates`),
 * then their readings go through `rangeFlag`. A part that fails is named, not hidden.
 */
export const altUnusualQuery = () => ({
  queryKey: ["alt_unusual"],
  queryFn: async ({ client }: { client?: QueryClient }): Promise<UnusualNow> => {
    const today = new Date().toISOString().slice(0, 10);
    const items: UnusualItem[] = [];
    const failed: string[] = [];
    let tested = 0;
    let short = 0;
    try {
      const buckets = await eventBucketsAll();
      const cands = bucketCandidates(buckets);
      tested = cands.length;
      const firstBucket = new Map<string, number>();
      const latest = new Map<string, number>();
      for (const b of buckets) {
        const k = `${b.ticker}|${b.dataset}`;
        if (b.bucket < RISE_WINDOWS) firstBucket.set(k, Math.max(firstBucket.get(k) ?? -1, b.bucket));
        if (b.bucket === 0) latest.set(k, Number(b.n));
      }
      for (const [k, n] of latest) if (n >= 3 && (firstBucket.get(k) ?? 0) < 5) short++;
      const byDataset = new Map<string, string[]>();
      for (const c of cands) (byDataset.get(c.dataset) ?? byDataset.set(c.dataset, []).get(c.dataset)!).push(c.ticker);
      const since = isoDaysAgo(RISE_LOOKBACK_DAYS);
      for (const [dataset, tickers] of byDataset) {
        for (const part of chunks(tickers, 60)) {
          const rows = await readAltAll<AltRow>(ROW_COLUMNS, (q) => q.eq("dataset", dataset).eq("kind", "event").in("ticker", part).gt("date", since).lte("date", today).order("uid"), client);
          items.push(...confirmCounts(dataset, rows, today));
        }
      }
    } catch {
      failed.push("filing and record counts");
    }
    for (const rule of RANGE_RULES) {
      try {
        const leaders = client ? await client.ensureQueryData(altLeadersQuery(rule.dataset, rule.title)) : await altLeadersQuery(rule.dataset, rule.title).queryFn({ client });
        const tickers = rangeCandidates(leaders, rule, today);
        const since = isoDaysAgo(rule.readDays);
        for (const part of chunks(tickers, 60)) {
          const rows = await readAltAll<AltRow>(ROW_COLUMNS, (q) => q.eq("dataset", rule.dataset).eq("title", rule.title).eq("kind", "series").in("ticker", part).gte("date", since).order("uid"), client);
          items.push(...confirmSeries(rows, rule, today));
        }
      } catch {
        failed.push(rule.title);
      }
    }
    return { items: rankUnusual(items), tested, short, failed };
  },
  staleTime: 30 * 60_000,
});

export const altSourceStatsQuery = () => ({
  queryKey: ["alt_source_stats"],
  queryFn: async () => {
    const { data, error } = await supabase.rpc("alt_source_stats");
    if (error) throw error;
    // collection records are bookkeeping for the repair, not data
    return ((data ?? []) as { dataset: string; rows: number; tickers: number; latest: string | null; refreshed: string | null }[]).filter((r) => r.dataset !== REFRESH_DATASET);
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

/** Days the material-filings list covers. */
export const RED_FLAG_DAYS = 90;

/** Red-flag 8-K items (`items`, the tab's list) and activist 13Ds in the last RED_FLAG_DAYS, every page. */
export const altRedFlagsQuery = (items: string[]) => ({
  queryKey: ["alt_redflags", items.join(",")],
  queryFn: async ({ client }: { client?: QueryClient }) => {
    const since = isoDaysAgo(RED_FLAG_DAYS);
    const [ev, own] = await Promise.all([
      readAltAll(ROW_COLUMNS, (q) => q.eq("dataset", "events").eq("kind", "event").in("meta->>item", items).gte("date", since).order("date", { ascending: false }).order("uid"), client),
      readAltAll(ROW_COLUMNS, (q) => q.eq("dataset", "ownership").eq("kind", "event").eq("meta->>activist", "true").gte("date", since).order("date", { ascending: false }).order("uid"), client),
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
