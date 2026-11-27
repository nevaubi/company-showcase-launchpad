// The options collector's I/O, shared by the worker (scripts/options-snapshot.ts) and the app's
// scheduled job. Every decision is pure in src/lib/jobs/options-collect.ts. Server-only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { DIRECT_RETRY_MS, judgeChain, readerLeft, type ChainOutcome, type Route } from "@/lib/jobs/options-collect";
import { openYahooSession, type YahooSession } from "@/lib/yahoo-session.server";
import { fetchYahooChain, readerYahooChain, type ChainFetch } from "./yahoo-fetch.server";

/** The stored session: service-role only. Reused for up to a day, and whenever Yahoo will not open a new one. */
const SESSION_KEY = "yahoo-session:v1";
const SESSION_MAX_AGE_MS = 24 * 3600_000;
/** The rate the forward and discount factor are read with: the 3-month Treasury yield the macro job stores. */
const RATE_SERIES = "DGS3MO";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any, any, any>;

export interface Rate {
  value: number;
  date: string | null;
}

/** Latest stored 3-month Treasury yield as a fraction; zero (and no date) when none is stored. */
export async function loadRate(db: Db): Promise<Rate> {
  const { data, error } = await db.from("macro_observations").select("date, value").eq("series_id", RATE_SERIES).order("date", { ascending: false }).limit(1);
  if (error) throw new Error(`macro_observations: ${error.message}`);
  const row = data?.[0] as { date: string; value: number | string } | undefined;
  const v = row ? Number(row.value) : NaN;
  return Number.isFinite(v) && v > -5 && v < 30 ? { value: v / 100, date: row!.date } : { value: 0, date: null };
}

export interface Routes {
  /** epoch ms until which the direct route is left alone after a refusal */
  directBlockedUntil: number;
  /** page-reader requests used this session */
  readerUsed: number;
  /** the reader refused too (out of credit, or Yahoo refused it): no more reader requests this pass */
  readerClosed: boolean;
  /** the last refusal's HTTP status */
  lastStatus: number;
}
export const openRoutes = (readerUsed = 0): Routes => ({ directBlockedUntil: 0, readerUsed, readerClosed: false, lastStatus: 0 });

export class Collector {
  private ys: YahooSession | null = null;
  constructor(
    private readonly db: Db,
    private readonly env: Record<string, string | undefined>,
    private readonly rate: Rate,
    private readonly sessionDate: string,
    readonly routes: Routes = openRoutes(),
  ) {}

  /** The session in use: this process's, else the stored one, else a new one. */
  private async yahoo(signal?: AbortSignal): Promise<YahooSession> {
    if (this.ys) return this.ys;
    const { data } = await this.db.from("ai_cache").select("payload").eq("key", SESSION_KEY).maybeSingle();
    const kept = (data?.payload ?? null) as YahooSession | null;
    if (kept?.cookie && kept.crumb && Date.now() - (kept.at ?? 0) < SESSION_MAX_AGE_MS) return (this.ys = kept);
    try {
      return await this.fresh(signal);
    } catch (e) {
      // Yahoo will not open a session for this address: an older one may still be accepted (the reader presents it)
      if (kept?.cookie && kept.crumb) return (this.ys = kept);
      throw e;
    }
  }

  private async fresh(signal?: AbortSignal): Promise<YahooSession> {
    const s = await openYahooSession(signal, 2);
    this.ys = s;
    await this.db.from("ai_cache").upsert({ key: SESSION_KEY, payload: s as never, created_at: new Date(s.at).toISOString() });
    return s;
  }

  /** One stock's chain, by the direct route or, when Yahoo refuses this address, the page reader. */
  async one(t: string, signal?: AbortSignal): Promise<ChainOutcome> {
    const r = this.routes;
    let via: Route = Date.now() < r.directBlockedUntil ? "reader" : "direct";
    let reopened = false;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (via === "reader" && (r.readerClosed || readerLeft(r.readerUsed) <= 0)) return { t, kind: "blocked", status: r.lastStatus || 429 };
      let s: YahooSession;
      try {
        s = await this.yahoo(signal);
      } catch (e) {
        const status = (e as { status?: number }).status ?? 0;
        // no session at all: the address is refused before a chain can be asked for
        if (status === 429 || status === 403 || status === 999) {
          r.directBlockedUntil = Date.now() + DIRECT_RETRY_MS;
          r.lastStatus = status;
          return { t, kind: "blocked", status };
        }
        return { t, kind: "error", message: (e as Error).message.slice(0, 120) };
      }
      let f: ChainFetch;
      if (via === "direct") f = await fetchYahooChain(t, s, signal);
      else {
        r.readerUsed++;
        f = await readerYahooChain(t, s, this.env, signal);
      }
      if (f.kind === "read") return judgeChain(t, f.result, this.sessionDate, this.rate, via);
      if (f.kind === "session") {
        if (reopened) return { t, kind: "error", message: "Yahoo did not accept a new session" };
        reopened = true;
        this.ys = null;
        try {
          await this.fresh(signal);
        } catch (e) {
          return { t, kind: "error", message: (e as Error).message.slice(0, 120) };
        }
        continue;
      }
      if (f.kind === "blocked") {
        r.lastStatus = f.status;
        if (via === "direct") {
          r.directBlockedUntil = Date.now() + DIRECT_RETRY_MS;
          via = "reader";
          continue;
        }
        r.readerClosed = true;
        return { t, kind: "blocked", status: f.status };
      }
      return { t, kind: "error", message: f.message };
    }
    return { t, kind: "error", message: "no answer after four tries" };
  }

  /** The probe's chain (never stored): tells whether today had a session and whether its quotes are final. */
  async probe(symbol: string, signal?: AbortSignal): Promise<ChainFetch> {
    const s = await this.yahoo(signal);
    const direct = Date.now() < this.routes.directBlockedUntil ? null : await fetchYahooChain(symbol, s, signal);
    if (direct && direct.kind !== "blocked") return direct;
    if (direct?.kind === "blocked") {
      this.routes.directBlockedUntil = Date.now() + DIRECT_RETRY_MS;
      this.routes.lastStatus = direct.status;
    }
    if (this.routes.readerClosed || readerLeft(this.routes.readerUsed) <= 0) return direct ?? { kind: "blocked", status: this.routes.lastStatus || 429 };
    this.routes.readerUsed++;
    return readerYahooChain(symbol, s, this.env, signal);
  }
}
