// Assistant text for the setups engine (short list, watch list, rule scoreboard) and the paper autopilots.
// Pure: the executor passes in what the pages already load. Wording follows the Setups page: rules are judged
// against luck, a rule is "listed" or "not listed", and the Watch list rows are never evidence and carry no stop or target.
import { fmtPct } from "@/lib/format";
import type { BotStats } from "@/lib/signals/bots";
import type { EvidenceBook } from "@/lib/signals/evidence";
import { emptyListLine, evidenceLine, liveLine, verdictLine } from "@/lib/signals/explain";
import { rankSetups, type LiveSignal, type RankedSetup } from "@/lib/signals/rank";
import type { SetupsFile } from "@/lib/signals/setups";
import { FAMILY_LABEL, STRATEGY, type Family } from "@/lib/signals/strategies";

const MAX = 9000;
const pct = (v: number | null | undefined) => fmtPct(v ?? null, 2, true);
const num = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "–" : v.toFixed(d));
const label = (v: { strategy: string; side: 1 | -1; horizon: number }) => `${STRATEGY[v.strategy as keyof typeof STRATEGY]?.label ?? v.strategy} (${v.side > 0 ? "long" : "short"}, ${v.horizon}d)`;

export interface SetupsArgs {
  ticker?: string | null;
  family?: Family | null;
  includeWatch?: boolean;
  max?: number;
}

/** What setupsQuery returns: the published run plus the read-time evidence and the session's live signals. */
export type SetupsInput = SetupsFile & { book?: EvidenceBook; live?: LiveSignal[] };

export function setupsText(f: SetupsInput, a: SetupsArgs = {}): string {
  const m = f.market;
  const book = f.book ?? null;
  const out = [
    `Short-term setups engine, closing prices ${f.asOf} (${f.source === "daily" ? "nightly run" : "full-history run"} over ${f.companies.toLocaleString("en-US")} stocks). Market regime: ${f.regime}.${m ? ` VIX ${num(m.vix, 1)}${m.vixRatio != null ? `, VIX/VIX3M ${num(m.vixRatio)}${m.vixRatio > 1 ? " (inverted: stress)" : ""}` : ""}; ${fmtPct(m.breadth200, 0)} of stocks above their 200-day average; ${fmtPct(m.nearHighs, 0)} within 2% of a 52-week high; median short-sale share of volume ${fmtPct(m.shortRatio, 0)} (FINRA).` : ""}`,
    `Each rule is a published strategy judged against luck on trades after ${f.oosStart}, after trading and borrowing costs, month by month (holds overlap, so signal days are not counted as independent). ${f.variants.length} rules are tried, so a rule is listed only if it stands out from all of them under false-discovery control (Benjamini-Hochberg: watch at 10%, candidate at 5%; "proven" also needs all eight checks of the strict gate). ${book ? (book.discovery.proven + book.discovery.candidates + book.discovery.watch > 0 ? verdictLine(book) : emptyListLine(book)) : `${f.variants.filter((v) => v.passed).length} of ${f.variants.length} rules pass the strict gate; the read-time luck check was not available.`} Signals from rules that are not listed are a watch list, not evidence and not a recommendation: say so when citing them, and never call a backtest figure proven or predictive. Not investment advice. Page: /app/setups (opens on the Short list; views: Short list, Watch list, All fired; filters: side, hold, family, sector, traded a day).`,
  ];
  const t = a.ticker?.toUpperCase();
  const max = Math.max(1, Math.min(a.max ?? 15, 40));
  const line = (s: RankedSetup) => {
    const listed = s.grade !== "unproven";
    const head = `  ${s.ticker} ${s.name} [${s.sector}] ${s.side > 0 ? "LONG" : "SHORT"} ${STRATEGY[s.strategy]?.label ?? s.strategy}, hold ${s.horizon} days, rule ${listed ? s.grade : "not listed"}; signal ${s.firedAt}: ${s.detail}; price $${num(s.price)}`;
    // The page shows a stop, a target and an expected edge only for a listed rule.
    const tail = !listed
      ? " (watch list only: this rule's record cannot be told apart from luck; no stop, target or expected edge)"
      : `${s.barsOk ? `, stop $${num(s.stop)}, target $${num(s.target)}` : " (stored prices look wrong: no stop or target)"}; expected edge ${pct(s.edge)} per trade vs sector after costs`;
    return `${head}${tail} </app/companies/${s.ticker}>`;
  };
  if (book && f.live) {
    const r = rankSetups(book, f.live);
    const pick = (rows: RankedSetup[]) => rows.filter((s) => (!t || s.ticker === t) && (!a.family || s.family === a.family));
    if (t) {
      // One stock: every live signal on it, whatever its rule's standing, at any liquidity.
      const rows = pick(rankSetups(book, f.live, { side: "all", hold: "all", family: "all", sector: "all", minDollarVolume: 5e6 }).all);
      out.push(`LIVE SIGNALS ON ${t} (last three trading days, best-evidenced rule first):`);
      if (!rows.length) out.push(`  none: no rule fired on ${t} in the last three trading days.`);
      for (const s of rows.slice(0, max)) out.push(line(s));
    } else {
      const short = pick(r.list);
      out.push(`SHORT LIST (${short.length}: signals from listed rules, at most 5 per rule and sector, one per stock, $20M a day or more):`);
      if (!short.length) out.push("  none: no listed rule has a live signal.");
      for (const s of short.slice(0, max)) out.push(line(s));
      if (a.includeWatch !== false) {
        const closest = pick(r.closest);
        out.push(`WATCH LIST, NOT LISTED (${closest.length}: signals of the rules nearest the bar, same limits; these are not suggestions, the rules cannot be told apart from luck and the page shows no stop or target for them):`);
        for (const s of closest.slice(0, max)) out.push(line(s));
        if (closest.length > max) out.push(`  …${closest.length - max} more`);
      }
      out.push(`${r.all.length} live signals pass the default filters in all (view "All fired").`);
    }
  } else {
    const rows = f.setups.filter((s) => (!t || s.ticker === t) && (!a.family || s.family === a.family) && (a.includeWatch !== false || s.proven));
    out.push(t ? `SETUPS ON ${t} (last three trading days):` : `TODAY'S SETUPS (${rows.length}):`);
    if (!rows.length) out.push(t ? `  none among the rows shown on the page for ${t}.` : "  none.");
    for (const s of rows.slice(0, max))
      out.push(`  ${s.ticker} ${s.name} [${s.sector}] ${s.side > 0 ? "LONG" : "SHORT"} ${STRATEGY[s.strategy]?.label ?? s.strategy}, hold ${s.horizon} days, rule ${s.proven ? "passes the strict gate" : "not listed"}; signal ${s.firedAt}: ${s.detail}; price $${num(s.price)}, stop $${num(s.stop)}, target $${num(s.target)}; expected edge ${pct(s.edge)} per trade vs sector after costs </app/companies/${s.ticker}>`);
  }
  if (f.pairs.length && !t) {
    out.push(`PAIRS STRETCHED APART (${f.pairsProven ? "the pairs rule passes the strict gate" : "context only: the pairs rule is not listed"}; shown in the scoreboard under the pairs rule):`);
    for (const p of f.pairs.slice(0, 6)) out.push(`  ${p.side > 0 ? "long" : "short"} ${p.a} / ${p.side > 0 ? "short" : "long"} ${p.b} [${p.sector}] z ${num(p.z)}, half-life ${num(p.halfLife, 0)} days, correlation ${num(p.rho)}`);
  }
  const fam = a.family ? f.variants.filter((v) => v.family === a.family) : f.variants;
  const tOf = (key: string) => book?.byKey.get(key)?.blocks?.t ?? -99;
  const board = [...fam].sort((x, y) => Number(y.passed) - Number(x.passed) || tOf(y.key) - tOf(x.key) || (y.outSample.t ?? -9) - (x.outSample.t ?? -9));
  out.push(`RULE SCOREBOARD (closest to the bar first${book ? "; t is on the monthly record" : ""}):`);
  for (const v of board.slice(0, 14)) {
    const e = book?.byKey.get(v.key);
    const o = v.outSample;
    out.push(
      e && book
        ? `  ${label(v)} [${FAMILY_LABEL[v.family]}] ${o.n} trades since ${f.oosStart.slice(0, 4)}: ${evidenceLine(e, book.discovery)} Live: ${liveLine(e.live)} Strict gate: ${v.passed ? "passes every check" : `fails ${v.failed.length} of 8`}.`
        : `  ${label(v)} [${FAMILY_LABEL[v.family]}] out of sample: ${o.n} trades over ${o.days} days, avg net ${pct(o.avgNet)}, vs SPY ${pct(o.avgExSpy)}, hit ${fmtPct(o.hit, 0)}, t ${num(o.t)}, deflated Sharpe ${num(v.dsr)}, max drawdown ${fmtPct(v.maxDrawdown, 1)}; strict gate: ${v.passed ? "passes every check" : `fails: ${v.failed.join(", ") || "?"}`}`,
    );
  }
  const body = out.join("\n");
  return body.length > MAX ? `${body.slice(0, MAX - 20)}\n…[truncated]` : body;
}

export interface BotView {
  id: string;
  name: string;
  house: boolean;
  status: string;
  capital: number;
  startedOn: string;
  lastAsOf: string | null;
  lastError: string | null;
  description: string | null;
  stats: BotStats;
  open: number;
}

export function botsText(bots: BotView[]): string {
  if (!bots.length) return "No paper autopilots yet. The user can start one at /app/autopilots.";
  const out = [
    "Paper autopilots: each trades the setups engine's signals on paper by fixed rules (daily fills at the next open, stops/targets/time exits, costs included), marked to market against SPY. Results are paper, not investment advice. Page: /app/autopilots",
  ];
  for (const b of bots) {
    const s = b.stats;
    out.push(
      `${b.name} (${b.house ? "house" : "user's own"}, ${b.status}) since ${b.startedOn}, capital $${b.capital.toLocaleString("en-US")}: return ${pct(s.totalReturn)} vs SPY ${pct(s.spyReturn)} (excess ${pct(s.excess)}); ${s.trades} closed trades, hit ${fmtPct(s.hit, 0)}, avg trade ${pct(s.avgTrade)}, max drawdown ${fmtPct(s.maxDrawdown, 1)}, Sharpe ${num(s.sharpe)}${s.sharpe == null ? " (needs 20+ days)" : ""}; ${b.open} open/pending positions; last run ${b.lastAsOf ?? "never"}${b.lastError ? ` — last error: ${b.lastError}` : ""}${b.description ? `. Rules: ${b.description}` : ""} </app/autopilots/${b.id}>`,
    );
  }
  return out.join("\n").slice(0, MAX);
}
