// Plain-text options context for the research assistant. Pure.
import { earningsPricing, impliedMoveBy, ivRank, realizedVol, cboeQuotePage } from "./core";
import type { OptionsBoardRow, OptionsRow } from "./data";
import { boardIvRank, volumeRatio } from "./data";

const pct = (x: number | null | undefined, d = 1) => (x == null || !Number.isFinite(x) ? "n/a" : `${(x * 100).toFixed(d)}%`);
const pts = (x: number | null | undefined) => (x == null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} vol pts`);
const ratio = (x: number | null | undefined) => (x == null ? "n/a" : x.toFixed(2));

export function optionsCompanyText(
  ticker: string,
  rows: OptionsRow[],
  ctx: { report?: { date: string; estimated: boolean } | null; pastMoves?: number[]; closes?: number[] } = {},
): string {
  if (!rows.length) return `${ticker}: no options snapshot recorded (no listed options, or not read yet). Snapshots are taken nightly from Cboe delayed quotes.`;
  const [s, ...prior] = rows;
  const out: string[] = [];
  out.push(`${ticker} options, Cboe delayed quotes for ${s.date} (stock ${s.price.toFixed(2)}; check at ${cboeQuotePage(ticker)}):`);
  const rank = s.iv30 != null ? ivRank(prior.map((r) => r.iv30 ?? NaN), s.iv30) : null;
  const rv = ctx.closes ? realizedVol(ctx.closes, 20) : null;
  out.push(
    `- 30-day implied volatility ${pct(s.iv30)}` +
      (rank ? ` (IV rank ${(rank.rank * 100).toFixed(0)} / percentile ${(rank.pct * 100).toFixed(0)} over ${rank.n} recorded days, range ${pct(rank.min)}–${pct(rank.max)})` : ` (only ${prior.length + 1} day(s) recorded so far, too few for an IV rank)`) +
      (rv != null ? `; 20-day realized volatility ${pct(rv)}, implied ÷ realized ${s.iv30 ? (s.iv30 / rv).toFixed(2) : "n/a"}` : ""),
  );
  out.push(`- 25-delta skew at ~30 days ${pts(s.skew25)} (positive = puts priced richer than calls)`);
  out.push(`- put/call open interest ${ratio(s.pc_oi)} (${s.put_oi.toLocaleString("en-US")} puts / ${s.call_oi.toLocaleString("en-US")} calls); put/call volume ${ratio(s.pc_vol)} (${(s.call_vol + s.put_vol).toLocaleString("en-US")} contracts)`);
  const m30 = impliedMoveBy(s.term, 28);
  if (s.term.length) out.push(`- priced moves (at-the-money straddle ÷ price, an expected absolute move): ${s.term.slice(0, 8).map((t) => `${t.e} (${t.d}d) ±${pct(t.m)}`).join(", ")}${m30 ? `; about ±${pct(m30.m)} by ${m30.e}` : ""}`);
  if (ctx.report) {
    const p = earningsPricing(s.term, ctx.report.date, s.date, ctx.pastMoves ?? []);
    if (p)
      out.push(
        `- next report ${ctx.report.date}${ctx.report.estimated ? " (projected date)" : ""}: the ${p.point.e} expiry prices ±${pct(p.point.m)} (±$${(p.point.m * s.price).toFixed(2)})` +
          (p.past ? `; the last ${p.past.n} reports moved a median ±${pct(p.past.median)} (mean ±${pct(p.past.mean)}), ${p.past.exceeded} of ${p.past.n} more than today's priced move` : ""),
      );
  }
  if (prior.length) {
    const wk = prior.find((r) => Date.parse(s.date) - Date.parse(r.date) >= 6 * 86400000);
    if (wk?.iv30 != null && s.iv30 != null) out.push(`- IV30 change since ${wk.date}: ${pts(s.iv30 - wk.iv30)}`);
  }
  return out.join("\n");
}

export type OptionsSort = "iv" | "iv_rank" | "iv_change" | "put_call" | "volume" | "skew" | "earnings";

export function optionsBoardText(
  rows: OptionsBoardRow[],
  opts: { sort?: OptionsSort; limit?: number; names: Map<string, string>; earnings?: Map<string, string>; asOf?: string },
): string {
  if (!rows.length) return "No options snapshots recorded yet.";
  const by = opts.sort ?? "iv";
  const limit = opts.limit ?? 30;
  const date = rows.reduce((d, r) => (r.date > d ? r.date : d), "");
  const val = (r: OptionsBoardRow): number => {
    switch (by) {
      case "iv": return r.iv30 ?? NaN;
      case "iv_rank": return boardIvRank(r)?.rank ?? NaN;
      case "iv_change": return r.iv30 != null && r.iv_prev != null ? r.iv30 - r.iv_prev : NaN;
      case "put_call": return r.pc_oi ?? NaN;
      case "volume": return volumeRatio(r) ?? NaN;
      case "skew": return r.skew25 ?? NaN;
      case "earnings": {
        const d = opts.earnings?.get(r.ticker);
        const p = d ? earningsPricing(r.term, d, r.date, []) : null;
        return p ? p.point.m : NaN;
      }
    }
  };
  const ranked = rows.map((r) => ({ r, v: val(r) })).filter((x) => Number.isFinite(x.v)).sort((a, b) => b.v - a.v);
  if (!ranked.length)
    return by === "iv_rank" || by === "volume" || by === "iv_change"
      ? `Not enough recorded days yet to rank by ${by.replace("_", " ")} (snapshots started recently; rank needs 20 days, volume vs average 5).`
      : "No stocks match.";
  const line = (r: OptionsBoardRow) => {
    const rank = boardIvRank(r);
    const vr = volumeRatio(r);
    const d = opts.earnings?.get(r.ticker);
    const p = d ? earningsPricing(r.term, d, r.date, []) : null;
    const m30 = impliedMoveBy(r.term, 28);
    return [
      `${r.ticker} ${opts.names.get(r.ticker) ?? ""}`.trim(),
      `IV30 ${pct(r.iv30)}`,
      rank ? `IV rank ${(rank.rank * 100).toFixed(0)}` : null,
      r.iv_prev != null && r.iv30 != null ? `1d ${pts(r.iv30 - r.iv_prev)}` : null,
      m30 ? `±${pct(m30.m)} by ${m30.e}` : null,
      `P/C OI ${ratio(r.pc_oi)}`,
      `P/C vol ${ratio(r.pc_vol)}`,
      vr != null ? `volume ${vr.toFixed(1)}× avg` : null,
      `skew ${pts(r.skew25)}`,
      p ? `report ${d}: ±${pct(p.point.m)} priced (${p.point.e} expiry)` : null,
    ].filter(Boolean).join(" · ");
  };
  return `Options snapshots (Cboe delayed quotes, latest ${date}; ${rows.length} stocks with listed options), sorted by ${by.replace("_", " ")}, highest first. Priced move = at-the-money straddle ÷ price (an expected absolute move to that expiry).\n${ranked.slice(0, limit).map((x) => line(x.r)).join("\n")}`;
}
