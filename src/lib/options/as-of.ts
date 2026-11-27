// Market comparisons use the information available at the close of each option quote.
import type { Bar } from "../financials/types";
import { earningsReactions } from "../markets/core";
import { realizedVol } from "./core";

type Release = { filed: string; accn: string; doc: string };
export type StoredMove = { d: string; end?: string; m: number; a: string; doc: string };

export function quoteHistory(bars: Bar[], releases: Release[], quoteDate?: string) {
  const observed = quoteDate ? bars.filter((bar) => bar[0] <= quoteDate) : [];
  const closes = observed.map((bar) => bar[5] || bar[4]);
  const realized = observed.length && observed.at(-1)![0] === quoteDate ? realizedVol(closes, 20) : null;
  const eligible = releases.filter((r) => r.filed && r.filed <= (quoteDate ?? ""));
  const reactions = earningsReactions(observed, eligible).slice(0, 12).reverse();
  return { realized, reactions };
}

/** An older file lacks individual exit dates. Its build date is a safe upper bound. */
export function reactionsAtQuote(moves: StoredMove[], generated: string, quoteDate: string) {
  const built = generated.slice(0, 10);
  const eligible = moves.filter((m) => {
    const available = m.end || built;
    return available && m.d <= available && available <= quoteDate && Number.isFinite(m.m);
  }).sort((a, b) => a.d.localeCompare(b.d));
  if (!eligible.length) return null;
  const abs = eligible.map((m) => Math.abs(m.m)).sort((a, b) => a - b);
  const n = abs.length;
  return { n, moves: eligible, median: (abs[(n - 1) >> 1] + abs[n >> 1]) / 2 };
}

export function indexVolatility(observations: [string, number][], bars: Bar[]) {
  const valid = observations.filter(([, value]) => Number.isFinite(value) && value > 0);
  const last = valid.at(-1);
  if (!last) return null;
  const [date, value] = last;
  const prior = valid.slice(-253, -1);
  const fifth = prior.at(-5);
  const closes = bars.filter((bar) => bar[0] <= date);
  const rv = closes.at(-1)?.[0] === date ? realizedVol(closes.map((bar) => bar[5] || bar[4]), 20) : null;
  return {
    date, value, change: fifth ? value - fifth[1] : null,
    percentile: prior.length === 252 ? prior.filter(([, v]) => v < value).length / prior.length : null,
    realized: rv, trend: valid.slice(-21),
  };
}
