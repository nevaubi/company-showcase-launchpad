// Server-side daily digest for one user: their watchlist (service-role read), their company visits, and each
// company's changes/{T}.json read from the partner data service with the server key. For the agent scheduler and
// inbox: `buildUserDigest(userId)` returns the structured digest and `digestText` (core.ts) renders it as text.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { buildDigest, digestText, visitBaseline, type CompanyVisit, type Digest } from "./core";
import type { ChangeTier, CompanyChanges } from "./types";

const PARTNER_DATA_URL =
  process.env["PARTNER_DATA_URL"] || "https://filedunderai.vercel.app/api/app-data";
const CHANGES_PATH = /^changes\/(feed|[A-Za-z0-9_.-]{1,32})\.json$/;

export async function partnerChanges<T>(path: string): Promise<T | null> {
  const key = process.env["PARTNER_DATA_KEY"];
  if (!key || !CHANGES_PATH.test(path)) return null;
  try {
    const res = await fetch(`${PARTNER_DATA_URL}?path=${encodeURIComponent(path)}`, {
      headers: { "x-partner-key": key },
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const k = i++;
        out[k] = await fn(items[k]);
      }
    }),
  );
  return out;
}

export interface UserDigest extends Digest {
  userId: string;
  text: string;
}

/**
 * The user's digest: top events across their watchlist (or `tickers` when given) in the last `days` days.
 * Never throws for missing company files; they are skipped.
 */
export async function buildUserDigest(
  userId: string,
  opts: {
    tickers?: string[];
    days?: number;
    limit?: number;
    minTier?: ChangeTier;
    appUrl?: string;
  } = {},
): Promise<UserDigest> {
  let tickers = opts.tickers;
  if (!tickers) {
    const { data, error } = await supabaseAdmin
      .from("watchlist")
      .select("ticker")
      .eq("user_id", userId);
    if (error) throw error;
    tickers = (data ?? []).map((r) => r.ticker);
  }
  const { data: visits } = await supabaseAdmin
    .from("company_visits")
    .select("ticker, last_seen_at, previous_seen_at")
    .eq("user_id", userId);
  const lastSeen = Object.fromEntries(
    (visits ?? []).map((v) => [v.ticker, visitBaseline(v as CompanyVisit) ?? undefined]),
  );
  const files = (
    await pool(tickers.slice(0, 200), 8, (t) => partnerChanges<CompanyChanges>(`changes/${t}.json`))
  ).filter((f): f is CompanyChanges => !!f);
  const digest = buildDigest({
    files: files.map((f) => ({ ticker: f.ticker, events: f.events })),
    lastSeen,
    today: new Date().toISOString().slice(0, 10),
    days: opts.days ?? 1,
    limit: opts.limit ?? 10,
    minTier: opts.minTier ?? "medium",
  });
  return { ...digest, userId, text: digestText(digest, opts.appUrl ?? "") };
}
