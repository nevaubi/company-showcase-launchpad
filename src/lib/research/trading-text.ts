// Assistant text for the setups engine (strategy scoreboard + today's setups) and the paper autopilots.
// Pure: the executor passes in what the pages already load.
import { fmtPct } from "@/lib/format";
import type { BotStats } from "@/lib/signals/bots";
import type { SetupsFile, VariantMeta } from "@/lib/signals/setups";
import { FAMILY_LABEL, STRATEGY, type Family } from "@/lib/signals/strategies";

const MAX = 9000;
const pct = (v: number | null | undefined) => fmtPct(v ?? null, 2, true);
const num = (v: number | null | undefined, d = 2) => (v == null || !Number.isFinite(v) ? "—" : v.toFixed(d));
const label = (v: { strategy: string; side: 1 | -1; horizon: number }) => `${STRATEGY[v.strategy as keyof typeof STRATEGY]?.label ?? v.strategy} (${v.side > 0 ? "long" : "short"}, ${v.horizon}d)`;

function variantLine(v: VariantMeta): string {
  const o = v.outSample;
  const live = v.live?.n ? ` · live since ${v.live.since}: ${v.live.n} trades, avg ${pct(v.live.avgNet)}, hit ${fmtPct(v.live.hit, 0)}` : "";
  return `${label(v)} [${FAMILY_LABEL[v.family]}] out of sample: ${o.n} trades over ${o.days} days, avg net ${pct(o.avgNet)}, vs SPY ${pct(o.avgExSpy)}, hit ${fmtPct(o.hit, 0)}, t ${num(o.t)}, deflated Sharpe ${num(v.dsr)}, max drawdown ${fmtPct(v.maxDrawdown, 1)} — ${v.passed ? "PASSES every check" : `fails: ${v.failed.join(", ") || "?"}`}${live}`;
}

export interface SetupsArgs {
  ticker?: string | null;
  family?: Family | null;
  includeWatch?: boolean;
  max?: number;
}

export function setupsText(f: SetupsFile, a: SetupsArgs = {}): string {
  const m = f.market;
  const passing = f.variants.filter((v) => v.passed);
  const out = [
    `Short-term setups engine, closing prices ${f.asOf} (${f.source === "daily" ? "nightly run" : "full-history run"} over ${f.companies.toLocaleString("en-US")} stocks). Market regime: ${f.regime}.${m ? ` VIX ${num(m.vix, 1)}${m.vixRatio != null ? `, VIX/VIX3M ${num(m.vixRatio)}${m.vixRatio > 1 ? " (inverted: stress)" : ""}` : ""}; ${fmtPct(m.breadth200, 0)} of stocks above their 200-day average; ${fmtPct(m.nearHighs, 0)} within 2% of a 52-week high; median short-sale share of volume ${fmtPct(m.shortRatio, 0)} (FINRA).` : ""}`,
    `Each strategy is a published rule judged only on trades after ${f.oosStart} (never tuned on them), after trading and borrowing costs. Gate: at least ${f.gate.minN} trades on ${f.gate.minDays} days, t ≥ ${f.gate.minT}, deflated Sharpe ≥ ${f.gate.minDsr}, false-discovery control, and positive in ${f.gate.minRegimes}+ market regimes. ${passing.length} of ${f.variants.length} strategy versions pass. Watch-only setups are positive out of sample but unproven — say so when citing them. Not investment advice. Page: /app/setups`,
  ];
  const t = a.ticker?.toUpperCase();
  let rows = f.setups.filter((s) => (!t || s.ticker === t) && (!a.family || s.family === a.family) && (a.includeWatch !== false || s.proven));
  rows = [...rows].sort((x, y) => Number(y.proven) - Number(x.proven) || y.edge - x.edge);
  const max = Math.max(1, Math.min(a.max ?? 15, 40));
  out.push(t ? `SETUPS ON ${t} (last three trading days):` : `TODAY'S SETUPS (${rows.length}${a.includeWatch === false ? ", proven only" : ", proven first, then watch-only"}):`);
  if (!rows.length) out.push(t ? `  none — no strategy fired on ${t} in the last three trading days.` : "  none.");
  for (const s of rows.slice(0, max))
    out.push(`  ${s.ticker} ${s.name} [${s.sector}] ${s.side > 0 ? "LONG" : "SHORT"} ${STRATEGY[s.strategy]?.label ?? s.strategy}, hold ${s.horizon} days, ${s.proven ? "proven" : "watch-only"}; signal ${s.firedAt}: ${s.detail}; price $${num(s.price)}, stop $${num(s.stop)}, target $${num(s.target)}; edge ${pct(s.edge)} per trade vs sector after costs <${`/app/companies/${s.ticker}`}>`);
  if (rows.length > max) out.push(`  …${rows.length - max} more`);
  if (f.pairs.length && !t) {
    out.push(`PAIRS STRETCHED APART (${f.pairsProven ? "proven strategy" : "watch-only: the pairs strategy has not passed"}):`);
    for (const p of f.pairs.slice(0, 6)) out.push(`  ${p.side > 0 ? "long" : "short"} ${p.a} / ${p.side > 0 ? "short" : "long"} ${p.b} [${p.sector}] z ${num(p.z)}, half-life ${num(p.halfLife, 0)} days, correlation ${num(p.rho)}`);
  }
  const fam = a.family ? f.variants.filter((v) => v.family === a.family) : f.variants;
  const board = [...fam].sort((x, y) => Number(y.passed) - Number(x.passed) || (y.outSample.t ?? -9) - (x.outSample.t ?? -9));
  out.push("STRATEGY SCOREBOARD (passing first, then by out-of-sample t):");
  for (const v of board.slice(0, 14)) out.push(`  ${variantLine(v)}`);
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
