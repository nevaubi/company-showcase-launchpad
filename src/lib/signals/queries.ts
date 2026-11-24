// Browser queries for the setups engine: the latest published run (Cloud, refreshed nightly) with the
// bundled full-history file as the fallback, and the paper autopilots (RLS: house + own bots).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SetupsFile } from "./setups";
import type { EquityRow, Position } from "./bots";

export const setupsQuery = queryOptions({
  queryKey: ["setups", "latest"],
  staleTime: 10 * 60_000,
  queryFn: async (): Promise<SetupsFile> => {
    const { data } = await supabase.from("setup_results").select("payload").order("as_of", { ascending: false }).limit(1).maybeSingle();
    if (data?.payload) return data.payload as unknown as SetupsFile;
    const r = await fetch("/data/setups.json");
    if (!r.ok) throw new Error(`setups ${r.status}`);
    return (await r.json()) as SetupsFile;
  },
});

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
