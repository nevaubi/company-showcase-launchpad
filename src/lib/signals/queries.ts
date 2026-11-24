// Browser queries for the setups engine: the latest published run (Cloud, refreshed nightly) with the
// bundled full-history file as the fallback, the session's live signals, and the paper autopilots
// (RLS: house + own bots).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { buildEvidence, type EvidenceBook } from "./evidence";
import { liveDays, sameLiveTrades, type LiveTrade } from "./live";
import { rankSetups, toSetup, type LiveSignal } from "./rank";
import type { SetupsFile } from "./setups";
import type { EquityRow, Position } from "./bots";

/** The published run plus the session's live signals, as the pages and the assistant read it. */
export interface SetupsData extends SetupsFile {
  /**
   * Every signal the engine holds live for `asOf` (fired within the last three sessions), without
   * its sparkline. `setups` is ranked from these at read time (`rankSetups` with the default
   * filters), not the list the nightly job stored: the short list, or, when no rule is listed, the
   * signals of the closest rules (`proven: false`, expected edge zero), which is what the page
   * shows by default and what the assistant reads.
   */
  live: LiveSignal[];
  /** Set when the signals could not be read; the scoreboard still works. */
  liveError: string | null;
  /** Evidence for every variant, worked out once per load from the stored records (kept in the query cache). */
  book: EvidenceBook;
  /** Rules whose finished live trades are the same trades as other rules' (key to the other keys). */
  sameLive: Map<string, string[]>;
}

const SIGNAL_COLUMNS = "ticker, variant, fired_at, first_seen, name, sector, strength, detail, price, atr, dv20, cost";
const PAGE = 1000;

interface SignalRow {
  ticker: string;
  variant: string;
  fired_at: string;
  first_seen: string | null;
  name: string | null;
  sector: string | null;
  strength: number | null;
  detail: string | null;
  price: number | null;
  atr: number | null;
  dv20: number | null;
  cost: number | null;
}

const num = (x: unknown) => (x == null ? null : Number(x));

/**
 * Live signals of one session, read a page at a time (the API returns at most 1,000 rows a call).
 * A signal was live on `asOf` when it was first seen on or before that session and last seen on or
 * after it. Matching `last_seen` exactly would lose every signal the next night's scan has already
 * touched, while the published run still points at `asOf`.
 */
export async function fetchLiveSignals(asOf: string): Promise<LiveSignal[]> {
  const out: LiveSignal[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await supabase
      .from("setup_signals")
      .select(SIGNAL_COLUMNS)
      .gte("last_seen", asOf)
      .order("ticker")
      .order("variant")
      .order("fired_at")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as SignalRow[]) {
      // First seen after `asOf`: the next session's signal, not this one's.
      if (r.first_seen != null && r.first_seen > asOf) continue;
      out.push({
        ticker: r.ticker, name: r.name ?? r.ticker, sector: r.sector ?? "", variant: r.variant, firedAt: r.fired_at, firstSeen: r.first_seen,
        strength: Number(r.strength ?? 0), detail: r.detail ?? "", price: Number(r.price ?? 0), atr: Number(r.atr ?? 0), dv20: num(r.dv20), cost: num(r.cost),
      });
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/**
 * Finished live trades (caught the night they fired: `first_seen = fired_at`) since the first live
 * signal any rule has, for the live check by signal day. The API cannot compare two columns, so rows
 * are filtered here; the date bound keeps the read to the live era (about 600 rows on 24 Nov 2026).
 */
export async function fetchLiveTrades(since: string): Promise<LiveTrade[]> {
  const out: LiveTrade[] = [];
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await supabase
      .from("setup_signals")
      .select("ticker, variant, fired_at, first_seen, outcome_net")
      .gte("fired_at", since)
      .not("outcome_net", "is", null)
      .order("variant")
      .order("fired_at")
      .order("ticker")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as { ticker: string; variant: string; fired_at: string; first_seen: string | null; outcome_net: number | string | null }[];
    for (const r of rows) {
      if (r.first_seen !== r.fired_at || r.outcome_net == null) continue;
      out.push({ variant: r.variant, ticker: r.ticker, firedAt: r.fired_at, net: Number(r.outcome_net) });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

async function fetchSetupsFile(): Promise<SetupsFile> {
  const { data } = await supabase.from("setup_results").select("payload").order("as_of", { ascending: false }).limit(1).maybeSingle();
  if (data?.payload) return data.payload as unknown as SetupsFile;
  const r = await fetch("/data/setups.json");
  if (!r.ok) throw new Error(`setups ${r.status}`);
  return (await r.json()) as SetupsFile;
}

export const setupsQuery = queryOptions({
  queryKey: ["setups", "latest"],
  staleTime: 10 * 60_000,
  queryFn: async (): Promise<SetupsData> => {
    const file = await fetchSetupsFile();
    let live: LiveSignal[] = [];
    let liveError: string | null = null;
    try {
      live = await fetchLiveSignals(file.asOf);
    } catch (e) {
      liveError = (e as Error).message;
    }
    // The live record by signal day; if it cannot be read, no live record is judged (nothing demoted).
    const since = file.variants.map((v) => v.live?.since).filter((d): d is string => !!d).sort()[0];
    let trades: LiveTrade[] | null = since ? null : [];
    if (since) {
      try {
        trades = await fetchLiveTrades(since);
      } catch {
        trades = null;
      }
    }
    const book = buildEvidence(file.variants, file.regime, file.asOf, trades ? liveDays(trades) : null);
    // What the page shows by default: the short list, or the closest rules' signals when no rule is listed.
    const ranking = rankSetups(book, live);
    const shown = ranking.list.length ? ranking.list : ranking.closest;
    return { ...file, setups: shown.map((r) => toSetup(r)), live, liveError, book, sameLive: sameLiveTrades(trades ?? []) };
  },
});

/** Sixty closes per ticker for the rows on screen (the signals query leaves them out: 60 numbers a row). */
export const sparksQuery = (asOf: string, rows: readonly { ticker: string; key: string }[]) => {
  const tickers = [...new Set(rows.map((r) => r.ticker))].sort();
  const variants = [...new Set(rows.map((r) => r.key))].sort();
  return queryOptions({
    queryKey: ["setups", "sparks", asOf, tickers.join(","), variants.join(",")],
    staleTime: 30 * 60_000,
    enabled: tickers.length > 0,
    queryFn: async (): Promise<Map<string, number[]>> => {
      const out = new Map<string, number[]>();
      for (let k = 0; k < tickers.length; k += 40) {
        // The variant filter keeps the answer to about one row per ticker on screen.
        const { data, error } = await supabase.from("setup_signals").select("ticker, spark").gte("last_seen", asOf).in("ticker", tickers.slice(k, k + 40)).in("variant", variants).limit(PAGE);
        if (error) throw new Error(error.message);
        for (const r of (data ?? []) as { ticker: string; spark: number[] | null }[]) if (!out.has(r.ticker) && r.spark?.length) out.set(r.ticker, r.spark.map(Number));
      }
      return out;
    },
  });
};

export interface BotRow {
  id: string;
  user_id: string | null;
  slug: string | null;
  name: string;
  description: string | null;
  rules: unknown;
  capital: number;
  status: "active" | "paused";
  started_on: string;
  last_as_of: string | null;
  last_error: string | null;
  created_at: string;
}

export interface BotsList {
  bots: BotRow[];
  equity: Map<string, (EquityRow & { bot_id: string })[]>;
  closed: Map<string, { bot_id: string; ret: number | null }[]>;
  active: Map<string, { bot_id: string; status: string }[]>;
}

export const botsQuery = queryOptions({
  queryKey: ["autopilots", "list"],
  staleTime: 5 * 60_000,
  queryFn: async (): Promise<BotsList> => {
    const { data, error } = await supabase.from("paper_bots").select("id, user_id, slug, name, description, rules, capital, status, started_on, last_as_of, last_error, created_at").order("created_at");
    if (error) throw error;
    const bots = (data ?? []) as BotRow[];
    // Equity curves and closed-trade returns for the summary cards (small: one row per trading day).
    const ids = bots.map((b) => b.id);
    const [eq, closed, open] = await Promise.all([
      ids.length ? supabase.from("paper_bot_equity").select("bot_id, date, equity, invested, realized, open_positions, spy").in("bot_id", ids).order("date").limit(10000) : Promise.resolve({ data: [] }),
      ids.length ? supabase.from("paper_bot_positions").select("bot_id, ret").in("bot_id", ids).eq("status", "closed").limit(10000) : Promise.resolve({ data: [] }),
      ids.length ? supabase.from("paper_bot_positions").select("bot_id, status").in("bot_id", ids).in("status", ["open", "pending"]).limit(10000) : Promise.resolve({ data: [] }),
    ]);
    const by = <T extends { bot_id: string }>(rows: T[] | null) => {
      const m = new Map<string, T[]>();
      for (const r of rows ?? []) m.set(r.bot_id, [...(m.get(r.bot_id) ?? []), r]);
      return m;
    };
    return {
      bots,
      equity: by(eq.data as (EquityRow & { bot_id: string })[] | null),
      closed: by(closed.data as { bot_id: string; ret: number | null }[] | null),
      active: by(open.data as { bot_id: string; status: string }[] | null),
    };
  },
});

export const botDetailQuery = (id: string) =>
  queryOptions({
    queryKey: ["autopilots", "detail", id],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [bot, pos, eq] = await Promise.all([
        supabase.from("paper_bots").select("id, user_id, slug, name, description, rules, capital, status, started_on, last_as_of, last_error, created_at").eq("id", id).maybeSingle(),
        supabase.from("paper_bot_positions").select("*").eq("bot_id", id).order("signal_date", { ascending: false }).limit(2000),
        supabase.from("paper_bot_equity").select("date, equity, invested, realized, open_positions, spy").eq("bot_id", id).order("date").limit(5000),
      ]);
      if (bot.error) throw bot.error;
      const positions = (pos.data ?? []) as unknown as Position[];
      // Latest closes for open positions (marked to market in the table).
      const tickers = [...new Set(positions.filter((p) => p.status === "open").map((p) => p.ticker))];
      const last = new Map<string, { date: string; close: number }>();
      if (tickers.length) {
        const since = new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10);
        const { data } = await supabase.from("market_bars").select("symbol, date, close").in("symbol", tickers).gte("date", since).order("date").limit(2000);
        for (const r of data ?? []) last.set(r.symbol, { date: r.date, close: Number(r.close) });
      }
      return { bot: bot.data as BotRow | null, positions, equity: (eq.data ?? []) as EquityRow[], last };
    },
  });
