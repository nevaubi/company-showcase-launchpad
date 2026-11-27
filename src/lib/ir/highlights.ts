// What to show first on a company's IR page (pure; shared by the page and tests): the handful of
// lines that matter most, the biggest moves in the latest quarter, and which breakdowns are current.
import { groupTitle } from "@/lib/ir/display";
import type { IrPayload, PayloadCell, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

const MET_WEIGHT: Record<string, number> = {
  revenue: 7, users: 6, units: 5, volume: 5, aum: 5, deposits: 5, loans: 5, backlog: 5, price: 4,
  segment_profit: 4, operating_income: 4, gross_profit: 3, net_income: 3, margin: 3, stores: 3, assets: 3, headcount: 2,
  cost: 1, expense: 1, other: 1,
};
const CAT_WEIGHT: Record<string, number> = { kpi: 2, segment: 1, product: 1, geography: 0, customer: 0, channel: 0, balance: 0, cost: -1, other: -1 };
/** Plumbing lines that never belong in a headline list. */
const PLUMBING = /^(other|all other|total other)\b|eliminat|intersegment|inter-segment|reconcil|adjustment|unallocated|corporate and other|not itemized|net change|change in\b/i;
/** Measures that can't be negative: a negative "revenue" line is an elimination or a deduction. */
const NONNEG = new Set(["revenue", "units", "users", "volume", "backlog", "assets", "deposits", "loans", "aum", "headcount", "stores"]);

/** The latest quarter most lines were reported for (a stray late date with a few values doesn't count). */
export function latestQuarter(p: IrPayload, quarters: string[]): string | null {
  const count = (e: string) => p.series.reduce((n, s) => n + (s.q[e] ? 1 : 0), 0);
  const tail = quarters.slice(-4).map((e) => ({ e, n: count(e) }));
  const busiest = Math.max(0, ...tail.map((x) => x.n));
  for (let i = tail.length - 1; i >= 0; i--) if (busiest && tail[i].n >= busiest * 0.25) return tail[i].e;
  return null;
}

/** Change in percent (points for percentages and basis points). */
export function changeOf(now: number | null | undefined, then: number | null | undefined, unit: string): number | null {
  if (now == null || then == null || !Number.isFinite(now) || !Number.isFinite(then)) return null;
  if (unit === "pct" || unit === "bps" || unit === "pp") return now - then;
  if (then === 0 || Math.sign(now) !== Math.sign(then)) return null;
  return ((now - then) / Math.abs(then)) * 100;
}

/** Percentage-point and basis-point changes keep the unit in which the source reports them. */
export function formatKpiChange(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "–";
  const sign = value < 0 ? "−" : value > 0 ? "+" : "";
  const relative = unit !== "pct" && unit !== "bps" && unit !== "pp";
  const decimals = relative && Math.abs(value) >= 100 ? 0 : 1;
  const figure = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return sign + figure + (unit === "pct" || unit === "pp" ? " pts" : unit === "bps" ? " bps" : "%");
}

/** The column about one year before `end` (fiscal calendars drift a few days). */
export function yearAgo(quarters: string[], end: string): string | null {
  return quarters.find((e) => Math.abs(t(e) - (t(end) - 364 * DAY)) <= 20 * DAY) ?? null;
}

export interface KeyLine {
  s: PayloadSeries;
  group: PayloadGroup;
  groupTitle: string;
  end: string;
  cell: PayloadCell;
  prev: string | null;
  qoq: number | null;
  yoy: number | null;
  /** last eight quarters, oldest first */
  trend: (number | null)[];
  score: number;
}

// "Crypto ($M)" and "Crypto ($B)" are the same line printed in two tables.
const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, " ").replace(/^total\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
/** Opening and movement lines of a roll-forward (beginning → new / churned → ending): only the ending line is a headline. */
const ROLL_OPEN = /^(beginning|opening|balance,? beginning|start of)/i;
const ROLL_MOVE = /^(new|gross adds|resurrected|reactivated|churned|net (adds|additions|change)|additions|disconnects|attrition)\b/i;

function scored(p: IrPayload, quarters: string[]) {
  const end = latestQuarter(p, quarters);
  if (!end) return { end: null, lines: [] as KeyLine[] };
  const at = quarters.indexOf(end);
  const window = quarters.slice(Math.max(0, at - 7), at + 1);
  const prior = quarters[at - 1];
  const gapDays = prior ? (t(end) - t(prior)) / DAY : 0;
  // Fiscal quarters may contain 12–14 weeks. A missing period is not a quarterly comparison.
  const prev = gapDays >= 70 && gapDays <= 112 ? prior : null;
  const ago = yearAgo(quarters, end);
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  const groupOf = new Map<string, { g: PayloadGroup; depth: number }>();
  for (const g of p.groups) for (const r of g.rows) if (!groupOf.has(r.k)) groupOf.set(r.k, { g, depth: r.depth });
  // Size counts within one kind of measure: trading volumes dwarf revenue but aren't more important.
  const maxUsd = new Map<string, number>();
  for (const s of p.series) if (s.unit === "usd" && s.q[end]) maxUsd.set(s.met, Math.max(maxUsd.get(s.met) ?? 1, Math.abs(s.q[end].v)));
  const rollForward = new Set(p.groups.filter((g) => g.rows.some((r) => ROLL_OPEN.test(byKey.get(r.k)?.label ?? ""))).map((g) => g.id));
  const topLine = p.groups
    .filter((g) => g.root && g.met === "revenue" && g.unit === "usd" && byKey.get(g.root)?.q[end])
    .map((g) => byKey.get(g.root!)!)
    .sort((a, b) => Math.abs(b.q[end].v) - Math.abs(a.q[end].v))[0]?.k;
  const lines: KeyLine[] = [];
  for (const s of p.series) {
    const cell = s.q[end];
    const place = groupOf.get(s.k);
    if (!cell || !place || PLUMBING.test(s.label) || cell.w === "scale" || (cell.v < 0 && NONNEG.has(s.met))) continue;
    if (rollForward.has(place.g.id) && place.g.root !== s.k && (ROLL_OPEN.test(s.label) || ROLL_MOVE.test(s.label))) continue;
    const trend = window.map((e) => s.q[e]?.v ?? null);
    const present = trend.filter((v) => v != null).length;
    // Headline lines need a nearly complete recent history (six of the last eight quarters).
    if (present < Math.min(6, window.length)) continue;
    const { g, depth } = place;
    let score = (MET_WEIGHT[s.met] ?? 1) + (CAT_WEIGHT[s.cat] ?? 0) + (present / window.length) * 2;
    if (g.root === s.k) score += 2;
    else score += depth === 1 ? 1 : depth >= 2 ? -1 : 0;
    if (s.unit === "usd") score += Math.max(0, 2 * (1 + Math.log10(Math.abs(cell.v) / (maxUsd.get(s.met) ?? 1)) / 3));
    if (s.k === topLine) score += 3;
    if (!g.root) score -= 1.5;
    lines.push({
      s,
      group: g,
      groupTitle: groupTitle(g, g.root ? byKey.get(g.root) : undefined),
      end,
      cell,
      prev,
      qoq: changeOf(cell.v, prev ? s.q[prev]?.v : null, s.unit),
      yoy: changeOf(cell.v, ago ? s.q[ago]?.v : null, s.unit),
      trend,
      score,
    });
  }
  return { end, lines };
}

/** The lines that matter most this quarter: complete recent history, headline metrics, big and distinct. */
export function keyLines(p: IrPayload, quarters: string[], n = 12): KeyLine[] {
  const { lines } = scored(p, quarters);
  const seen = new Set<string>();
  const perGroup = new Map<string, number>();
  const out: KeyLine[] = [];
  const ranked = [...lines].sort((a, b) => b.score - a.score);
  // First pass: at most two lines per breakdown so the list spans the business; then fill up.
  for (const cap of [2, Infinity]) {
    for (const l of ranked) {
      if (out.length >= n) break;
      // The same number printed in several tables shows once.
      const ids = [`${norm(l.s.label)}|${l.s.unit}`, `${l.s.unit}|${l.cell.v}`];
      if (ids.some((id) => seen.has(id))) continue;
      if ((perGroup.get(l.group.id) ?? 0) >= cap) continue;
      ids.forEach((id) => seen.add(id));
      perGroup.set(l.group.id, (perGroup.get(l.group.id) ?? 0) + 1);
      out.push(l);
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Biggest year-on-year moves among sizeable lines (dollar lines of at least 1% of the largest). */
export function biggestMoves(p: IrPayload, quarters: string[], n = 6): { up: KeyLine[]; down: KeyLine[] } {
  const { lines } = scored(p, quarters);
  const maxUsd = new Map<string, number>();
  for (const l of lines) if (l.s.unit === "usd") maxUsd.set(l.s.met, Math.max(maxUsd.get(l.s.met) ?? 1, Math.abs(l.cell.v)));
  const eligible = lines.filter(
    (l) => l.yoy != null && (l.s.unit !== "usd" || Math.abs(l.cell.v) >= (maxUsd.get(l.s.met) ?? 1) * 0.02) && l.s.unit !== "pct" && l.s.unit !== "bps" && l.s.unit !== "ratio",
  );
  const pick = (list: KeyLine[]) => {
    const seen = new Set<string>();
    const out: KeyLine[] = [];
    for (const l of list) {
      const id = `${norm(l.s.label)}|${l.s.unit}`;
      if (seen.has(id) || seen.has(`${l.s.unit}|${l.cell.v}`)) continue;
      seen.add(id);
      seen.add(`${l.s.unit}|${l.cell.v}`);
      out.push(l);
      if (out.length >= n) break;
    }
    return out;
  };
  return {
    up: pick(eligible.filter((l) => l.yoy! > 0).sort((a, b) => b.yoy! - a.yoy!)),
    down: pick(eligible.filter((l) => l.yoy! < 0).sort((a, b) => a.yoy! - b.yoy!)),
  };
}

/**
 * How current a breakdown is over the columns in view: 0 = reported in the latest column and in at
 * least half the columns, 1 = in the latest column, 2 = not in the latest column (older tables).
 */
export function currency(g: PayloadGroup, cellsOf: (k: string) => Record<string, unknown> | undefined, cols: string[]) {
  if (!cols.length) return { tier: 2, filled: 0 };
  // A breakdown is as current as its printed total; loose lists count any of their lines.
  const keys = g.root ? [g.root] : g.rows.map((r) => r.k);
  const has = (e: string) => keys.some((k) => cellsOf(k)?.[e]);
  const filled = cols.filter(has).length;
  const recent = has(cols[cols.length - 1]) || (cols.length > 1 && has(cols[cols.length - 2]));
  return { tier: recent ? (filled >= cols.length / 2 ? 0 : 1) : 2, filled };
}
