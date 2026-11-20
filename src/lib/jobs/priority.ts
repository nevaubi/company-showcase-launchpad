/**
 * Priority ordering (pure). "Top 1,000" = the 1,000 covered tickers with the highest 20-day dollar
 * volume (`setup_series.dv20`), the only size measure the database carries for every company.
 *
 * AI budget and deep builds go to the top 1,000 first; a fair rotation still serves the tail, so a
 * small company is delayed, never starved.
 */

export const PRIORITY_TOP = 1000;

/** PRIORITY_ORDER=0 turns ranking off (callers keep their old order). */
export const priorityEnabled = (env: Record<string, string | undefined>) => env["PRIORITY_ORDER"] !== "0";

/** dv20 rows → 1-based rank (highest dv20 = 1; ties by ticker). Rows without a positive dv20 are unranked. */
export function rankFromDv20(rows: { ticker: string; dv20: number | string | null }[]): Map<string, number> {
  const best = new Map<string, number>();
  for (const r of rows) {
    const v = Number(r.dv20);
    if (!r.ticker || !Number.isFinite(v) || v <= 0) continue;
    if ((best.get(r.ticker) ?? -1) < v) best.set(r.ticker, v);
  }
  const sorted = [...best].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return new Map(sorted.map(([t], i) => [t, i + 1]));
}

/** Ranked tickers first (ascending rank), then unranked in input order. Stable; drops duplicates. */
export function rankOrder<T extends string>(tickers: readonly T[], rank: Map<string, number>): T[] {
  const seen = new Set<string>();
  const list = tickers.map((t, i) => ({ t, i, r: rank.get(t) })).filter((x) => (seen.has(x.t) ? false : (seen.add(x.t), true)));
  return list.sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || a.i - b.i).map((x) => x.t);
}

/** The top `n` tickers by rank. */
export function topN(rank: Map<string, number>, n = PRIORITY_TOP): Set<string> {
  return new Set([...rank].filter(([, r]) => r <= n).map(([t]) => t));
}

export interface FairOpts {
  /** size of the head (default 1,000) */
  top?: number;
  /** one tail item after every `tailEvery` head items (default 4, so the tail gets 20% of slots) */
  tailEvery?: number;
  /** rotation offset into the tail (persist and bump it per pass, e.g. the UTC day number) */
  offset?: number;
}

/**
 * Priority with a fair share for the tail: the head (top `top` by rank, in rank order) with one tail
 * ticker interleaved after every `tailEvery` head tickers; the tail starts at `offset` and wraps, so
 * successive passes walk the whole tail. Once the head is used up the rest of the tail follows.
 */
export function fairOrder<T extends string>(tickers: readonly T[], rank: Map<string, number>, opts: FairOpts = {}): T[] {
  const top = opts.top ?? PRIORITY_TOP;
  const every = Math.max(1, Math.floor(opts.tailEvery ?? 4));
  const ordered = rankOrder(tickers, rank);
  const head = ordered.filter((t) => (rank.get(t) ?? Infinity) <= top);
  const rest = ordered.filter((t) => !((rank.get(t) ?? Infinity) <= top));
  const k = rest.length ? (((opts.offset ?? 0) % rest.length) + rest.length) % rest.length : 0;
  const tail = [...rest.slice(k), ...rest.slice(0, k)];
  const out: T[] = [];
  let ti = 0;
  head.forEach((t, i) => {
    out.push(t);
    if ((i + 1) % every === 0 && ti < tail.length) out.push(tail[ti++]);
  });
  while (ti < tail.length) out.push(tail[ti++]);
  return out;
}

/** Sort any rows by ticker rank, keeping the input order among equals (unranked last). */
export function byRank<R>(rows: readonly R[], tickerOf: (r: R) => string, rank: Map<string, number>): R[] {
  return rows
    .map((r, i) => ({ r, i, k: rank.get(tickerOf(r)) ?? Infinity }))
    .sort((a, b) => a.k - b.k || a.i - b.i)
    .map((x) => x.r);
}

/**
 * Where the tail rotation starts on the next pass (review R4). A pass that ends at position `pos` of
 * `fairOrder(..., { offset })` served the tail items before `pos`; the next pass starts the tail right
 * after them, so a short pass delays the tail instead of starving the same names every time.
 */
export function nextTailOffset<T extends string>(tickers: readonly T[], rank: Map<string, number>, offset: number, pos: number, opts: Omit<FairOpts, "offset"> = {}): number {
  const top = opts.top ?? PRIORITY_TOP;
  const order = fairOrder(tickers, rank, { ...opts, offset });
  const isTail = (t: string) => !((rank.get(t) ?? Infinity) <= top);
  const tailLen = order.filter(isTail).length;
  if (!tailLen) return 0;
  const served = order.slice(0, Math.max(0, Math.min(pos, order.length))).filter(isTail).length;
  return (((offset + served) % tailLen) + tailLen) % tailLen;
}
