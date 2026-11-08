// Zoomable "financial map" of a company's IR breakdowns (pure; shared by the page and tests).
// Company → zones (revenue, profit, costs, KPIs, balances) → breakdowns → single lines.
import { groupOrder, groupTitle, inDimension } from "@/lib/ir/display";
import type { IrPayload, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";

/** better / worse are judged per line: for costs and expenses, a fall is better. */
export type Tone = "better" | "worse" | "mixed" | "flat" | "none";

export interface MapLine {
  key: string;
  label: string;
  unit: string;
  depth: number;
  total: boolean;
  /** last quarters, oldest first; null where the quarter wasn't reported */
  values: (number | null)[];
  latest: number | null;
  qoq: number | null;
  yoy: number | null;
  tone: Tone;
}
export interface MapTile {
  id: string;
  title: string;
  unit: string;
  root: MapLine | null;
  lines: MapLine[];
  tones: Record<Tone, number>;
}
export interface MapZone {
  id: string;
  title: string;
  tiles: MapTile[];
  tones: Record<Tone, number>;
}
export interface FinancialMap {
  quarters: string[];
  zones: MapZone[];
  lines: number;
  weaker: number;
}

export const ZONES: { id: string; title: string }[] = [
  { id: "revenue", title: "Revenue" },
  { id: "profit", title: "Profit" },
  { id: "cost", title: "Costs & expenses" },
  { id: "kpi", title: "Operating KPIs" },
  { id: "balance", title: "Balances" },
];

/** Moves smaller than this (in percent, or in points for % lines) count as flat. */
export const FLAT_BAND = 2;

const lowerIsBetter = (s: PayloadSeries, g?: PayloadGroup) =>
  s.cat === "cost" || s.met === "cost" || s.met === "expense" || g?.cat === "cost" || /charge-?off|provision|non-?performing|delinquen|efficiency ratio/i.test(s.label);

function change(now: number | null, then: number | null, unit: string): number | null {
  if (now == null || then == null) return null;
  if (unit === "pct" || unit === "bps") return now - then; // points
  if (then === 0) return null;
  return ((now - then) / Math.abs(then)) * 100;
}

/** Tone of one line from its quarter-on-quarter and year-on-year change. */
export function toneOf(qoq: number | null, yoy: number | null, inverted: boolean, unit = "usd"): Tone {
  const band = unit === "bps" ? FLAT_BAND * 5 : unit === "pct" ? 0.25 : FLAT_BAND;
  const dir = (x: number | null) => (x == null || Math.abs(x) < band ? 0 : (x > 0 ? 1 : -1) * (inverted ? -1 : 1));
  if (yoy == null && qoq == null) return "none";
  const y = dir(yoy);
  const q = dir(qoq);
  if (y === 0 && q === 0) return "flat";
  if (y !== 0 && q !== 0 && y !== q) return "mixed";
  return (y || q) > 0 ? "better" : "worse";
}

const emptyTones = (): Record<Tone, number> => ({ better: 0, worse: 0, mixed: 0, flat: 0, none: 0 });

export function lineOf(s: PayloadSeries, quarters: string[], depth: number, g?: PayloadGroup): MapLine {
  const values = quarters.map((e) => s.q[e]?.v ?? null);
  const n = values.length;
  const latest = values[n - 1] ?? null;
  const qoq = change(latest, values[n - 2] ?? null, s.unit);
  const yoy = change(latest, values[n - 5] ?? null, s.unit);
  return { key: s.k, label: s.label, unit: s.unit, depth, total: s.total, values, latest, qoq, yoy, tone: toneOf(qoq, yoy, lowerIsBetter(s, g), s.unit) };
}

const PROFIT_MET = new Set(["operating_income", "segment_profit", "gross_profit", "net_income"]);
/** Zone by what the breakdown measures; banks file most tables as KPIs, so the metric decides first. */
export function zoneOf(g: Pick<PayloadGroup, "cat" | "met">) {
  if (g.cat === "cost" || g.met === "cost" || g.met === "expense") return "cost";
  if (g.met === "revenue") return "revenue";
  if (PROFIT_MET.has(g.met)) return "profit";
  if (g.cat === "balance" || ["loans", "deposits", "assets", "aum"].includes(g.met)) return "balance";
  return inDimension(g as PayloadGroup, "revenue") ? "revenue" : "kpi";
}

/**
 * Builds the map over the last `span` quarters. Breakdowns with nothing in the latest quarter are left
 * out (discontinued tables), so every tile shows the current state of the business.
 */
export function buildMap(p: IrPayload, span = 13): FinancialMap {
  const quarters = p.quarters.slice(-span);
  const last = quarters[quarters.length - 1];
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  const zones = new Map<string, MapTile[]>(ZONES.map((z) => [z.id, []]));
  for (const g of [...p.groups].sort(groupOrder)) {
    const rows = g.rows.map((r) => ({ s: byKey.get(r.k), depth: r.depth })).filter((r): r is { s: PayloadSeries; depth: number } => !!r.s && !!r.s.q[last]);
    if (!rows.length) continue;
    const rootS = g.root ? byKey.get(g.root) : undefined;
    const lines = rows.map((r) => lineOf(r.s, quarters, r.depth, g));
    const root = lines.find((l) => l.key === g.root) ?? null;
    const tones = emptyTones();
    for (const l of lines) if (l !== root) tones[l.tone]++;
    zones.get(zoneOf(g))!.push({ id: g.id, title: groupTitle(g, rootS), unit: g.unit, root, lines, tones });
  }
  const out: MapZone[] = [];
  let lines = 0;
  let weaker = 0;
  for (const z of ZONES) {
    const tiles = zones.get(z.id)!;
    if (!tiles.length) continue;
    const tones = emptyTones();
    for (const t of tiles) for (const k of Object.keys(tones) as Tone[]) tones[k] += t.tones[k];
    for (const t of tiles) {
      lines += t.lines.length;
      if (t.root && (t.root.tone === "worse" || t.root.tone === "mixed")) weaker++;
    }
    out.push({ ...z, tiles, tones });
  }
  return { quarters, zones: out, lines, weaker };
}
