// Builds the chart contract (types.ts) from the IR payload the page already holds. Pure. Lines keep the company's
// own names; held (suspect) cells are never used, because `cellsFor` leaves them out; every point carries the source
// target the table's own cell opens (openIrCell in breakdowns.tsx builds the same target).
import type { SourceTarget } from "@/components/source/source-context";
import { derivedOf, periodLabel, periodLong, printedUnit, refOf } from "@/lib/ir/display";
import { keyLines } from "@/lib/ir/highlights";
import type { IrPayload, PayloadCell, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";
import { cellsFor, periodGrids } from "@/lib/ir/periods";
import { tiedPeriods } from "./model";
import type { VizBankFigures, VizCadence, VizMarginFigures, VizParts, VizPoint, VizSeries, VizUnit } from "./types";

const UNITS = new Set<VizUnit>(["usd", "usdPerShare", "pct", "bps", "ratio", "count", "other"]);
const unitOf = (u: string): VizUnit => (UNITS.has(u as VizUnit) ? (u as VizUnit) : "other");

/** What a click on one cell opens: its formula when derived, else the stored document at the printed cell. */
export function targetOf(ticker: string, payload: IrPayload, s: PayloadSeries, end: string, cadence: VizCadence, c: PayloadCell): SourceTarget | undefined {
  const label = periodLong(c.m === 0 && c.e ? c.e : end, cadence, c.m);
  const derived = derivedOf(payload, c);
  if (derived) return { ticker, label: s.label, periodLabel: label, unit: s.unit, value: c.v, derived };
  const src = refOf(payload, { ...c, e: c.e ?? end }, s.label);
  return src ? { ticker, label: s.label, periodLabel: label, unit: s.unit, value: c.v, src } : undefined;
}

function noteOf(c: PayloadCell): string | undefined {
  const notes = [...(c.flags ?? []).map((f) => f.why), ...(c.alt ? [c.alt.kind === "restated" ? "A later document prints a restated figure" : "Another document prints a different figure"] : [])];
  return notes.length ? notes.join(". ") : undefined;
}

/** One payload line as a chart series over the cadence's columns. */
export function seriesOf(payload: IrPayload, ticker: string, s: PayloadSeries, cadence: VizCadence = "q"): VizSeries {
  const cells = cellsFor(s, cadence);
  const points: VizPoint[] = Object.keys(cells)
    .sort()
    .map((end) => {
      const c = cells[end];
      const p: VizPoint = { period: end, periodLabel: periodLong(c.m === 0 && c.e ? c.e : end, cadence, c.m), short: periodLabel(end, cadence), value: c.v };
      if (c.x) p.printed = c.x;
      const t = targetOf(ticker, payload, s, end, cadence, c);
      if (t) p.source = t;
      const n = noteOf(c);
      if (n) p.note = n;
      return p;
    });
  const unit = unitOf(s.unit);
  const out: VizSeries = { key: s.k, label: s.label, unit, cadence, points };
  if (unit === "other") out.printedUnit = printedUnit(points.map((p) => p.printed ?? ""));
  return out;
}

/** A group's lines in display order (parts first, the total last), as series. */
export function groupSeries(payload: IrPayload, ticker: string, g: PayloadGroup, cadence: VizCadence = "q"): VizSeries[] {
  const byKey = new Map(payload.series.map((s) => [s.k, s]));
  return g.rows.map((r) => byKey.get(r.k)).filter((s): s is PayloadSeries => !!s).map((s) => seriesOf(payload, ticker, s, cadence)).filter((s) => s.points.length > 0);
}

/**
 * A group's direct parts and its total, with the periods in which they tie. Null when the group has no total or
 * fewer than two parts. Lines the payload's own checks subtract (deductions printed as positives) count minus.
 */
export function partsOf(payload: IrPayload, ticker: string, g: PayloadGroup, cadence: VizCadence = "q"): VizParts | null {
  if (!g.root) return null;
  const byKey = new Map(payload.series.map((s) => [s.k, s]));
  const root = byKey.get(g.root);
  if (!root) return null;
  const kids = g.rows.map((r) => byKey.get(r.k)).filter((s): s is PayloadSeries => !!s && s.parent === root.k && s.unit === root.unit);
  if (kids.length < 2) return null;
  const kind = cadence === "y" ? "fy" : "q";
  const subtracted = [...new Set(payload.checks.filter((c) => c.k === root.k && c.kind === kind).flatMap((c) => c.sub ?? []))];
  const total = seriesOf(payload, ticker, root, cadence);
  const parts = kids.map((s) => seriesOf(payload, ticker, s, cadence)).filter((s) => s.points.length > 0);
  if (parts.length < 2 || !total.points.length) return null;
  return { key: g.id, label: g.t ?? g.label, unit: total.unit, cadence, total, parts, subtracted, ties: tiedPeriods(total, parts, subtracted) };
}

/** The standardized KPI lines of the strip: the page's own key lines (highlights.ts), at most eight. */
export function summaryTilesOf(payload: IrPayload, ticker: string, n = 8): VizSeries[] {
  const quarters = periodGrids(payload).q;
  return keyLines(payload, quarters, n).map((l) => seriesOf(payload, ticker, l.s, "q")).filter((s) => s.points.length > 0);
}

const REVENUE_ROOT = /^(total )?(net )?(revenues?|net revenue|net sales|sales)( \(.*\))?$/i;

/**
 * Revenue or net revenue by segment: the revenue group whose parts tie in the most quarters, segments first, then
 * geography, then products. Null when no revenue group ties.
 */
export function segmentMixOf(payload: IrPayload, ticker: string): VizParts | null {
  const byKey = new Map(payload.series.map((s) => [s.k, s]));
  const rank = (cat: string) => (cat === "segment" ? 0 : cat === "geography" ? 1 : cat === "product" ? 2 : 3);
  let best: { p: VizParts; r: number } | null = null;
  for (const g of payload.groups) {
    const root = g.root ? byKey.get(g.root) : undefined;
    if (!root || root.unit !== "usd" || !(root.met === "revenue" || REVENUE_ROOT.test(root.label))) continue;
    if (!REVENUE_ROOT.test(root.label) && root.met !== "revenue") continue;
    const p = partsOf(payload, ticker, g, "q");
    if (!p || p.ties.length < 2) continue;
    const r = rank(g.cat);
    if (!best || p.ties.length > best.p.ties.length + 1 || (Math.abs(p.ties.length - best.p.ties.length) <= 1 && r < best.r)) best = { p, r };
  }
  return best?.p ?? null;
}

/** The line among `cands` printed in the most quarters, the shortest label on a tie. */
function pick(cands: PayloadSeries[], cadence: VizCadence): PayloadSeries | null {
  let best: PayloadSeries | null = null;
  let n = -1;
  for (const s of cands) {
    const k = Object.keys(cellsFor(s, cadence)).length;
    if (k > n || (k === n && best && s.label.length < best.label.length)) (best = s), (n = k);
  }
  return n > 0 ? best : null;
}

/** First rule that finds any line wins: rules go from the strictest wording to looser ones. */
function find(payload: IrPayload, unit: string, rules: RegExp[], exclude?: RegExp, cadence: VizCadence = "q"): PayloadSeries | null {
  for (const re of rules) {
    const c = payload.series.filter((s) => s.unit === unit && re.test(s.label.trim()) && !(exclude && exclude.test(s.label)));
    const p = pick(c, cadence);
    if (p) return p;
  }
  return null;
}

/**
 * The bank figures of the company's own lines. Null unless the company prints net interest income and either a net
 * interest margin or deposits: a non-bank never gets a bank panel. The efficiency or overhead ratio is the printed
 * line, never computed.
 */
export function bankFiguresOf(payload: IrPayload, ticker: string, cadence: VizCadence = "q"): VizBankFigures | null {
  const viz = (s: PayloadSeries | null) => (s ? seriesOf(payload, ticker, s, cadence) : null);
  const nii = find(payload, "usd", [/^net interest income$/i, /^net interest income\b(?!.*(after|fte|taxable|tax-equivalent))/i]);
  const nim = find(payload, "pct", [/^net interest margin( \(gaap\))?$/i, /^net yield on (average )?interest-earning assets$/i, /net interest margin|net yield on (average )?interest-earning assets/i], /excluding|markets|memo|card|fte|non-gaap|managed|—/i);
  const deposits = find(payload, "usd", [/^total deposits$/i, /^deposits$/i]);
  const loans = find(payload, "usd", [/^total loans( and leases)?$/i, /^loans( and leases)?$/i]);
  if (!nii || !(nim || deposits)) return null;
  const efficiency = find(payload, "pct", [/^(efficiency|overhead) ratio$/i, /^(efficiency|overhead) ratio\b/i], /managed|adjusted|non-gaap|fte|excluding/i);
  const provision = find(payload, "usd", [/^provision( \(benefit\))? for credit losses$/i], /—/);
  const nco = find(payload, "usd", [/^(total )?net (loan )?charge-offs$/i, /^(total )?net (loan )?charge-offs\b/i], /—|ratio|acquired/i);
  const allowance = find(payload, "usd", [/^(total )?allowance for (loan|loan and lease) losses$/i, /^(total )?allowance for credit losses$/i], /—/);
  const capital = [
    find(payload, "pct", [/^(cet1|common equity tier 1)\b.*ratio/i, /^(cet1|common equity tier 1)\b/i, /(cet1|common equity tier 1)/i], /advanced|—|ratio as a|fully phased|transition/i),
    find(payload, "pct", [/^tier 1 capital ratio/i, /^tier 1 risk-based/i], /advanced|—/i),
    find(payload, "pct", [/^total capital ratio/i, /^total risk-based/i], /advanced|—/i),
    find(payload, "pct", [/^tier 1 leverage/i], /—/),
    find(payload, "pct", [/^supplementary leverage ratio/i], /—/),
  ].filter((s): s is PayloadSeries => !!s);
  const feeGroup = payload.groups.find((g) => {
    const r = g.root ? payload.series.find((s) => s.k === g.root) : undefined;
    return !!r && r.unit === "usd" && /^(total )?non-?interest (income|revenue)$/i.test(r.label.trim());
  });
  const fees = feeGroup ? partsOf(payload, ticker, feeGroup, cadence) : null;
  const tied = fees && fees.ties.length ? fees : null;
  const lines = !tied && fees ? fees.parts.slice(0, 6) : [];
  const out: VizBankFigures = {
    nii: viz(nii),
    nim: viz(nim),
    noninterest: tied,
    noninterestLines: lines,
    efficiency: viz(efficiency),
    credit: [provision, nco, allowance].map(viz).filter((s): s is VizSeries => !!s && s.points.length > 0),
    capital: capital.map((s) => seriesOf(payload, ticker, s, cadence)).filter((s) => s.points.length > 0),
    balances: [deposits, loans].map(viz).filter((s): s is VizSeries => !!s && s.points.length > 0),
  };
  return out;
}

/**
 * Margins a non-bank prints as percentages and an expense section that ties to its printed total. Null for a bank
 * (see bankFiguresOf) and when neither is printed.
 */
export function marginFiguresOf(payload: IrPayload, ticker: string, cadence: VizCadence = "q"): VizMarginFigures | null {
  if (bankFiguresOf(payload, ticker, cadence)) return null;
  const margins = [
    find(payload, "pct", [/^gross margin( percentage| %)?$/i, /^gross margin\b/i], /—|segment|products|services/i, cadence),
    find(payload, "pct", [/^operating margin( percentage| %)?$/i, /^operating (income )?margin\b/i], /—|segment/i, cadence),
    find(payload, "pct", [/^net (income )?margin\b/i], /—|interest/i, cadence),
  ]
    .filter((s): s is PayloadSeries => !!s)
    .map((s) => seriesOf(payload, ticker, s, cadence))
    .filter((s) => s.points.length > 0);
  let expenses: VizParts | null = null;
  for (const g of payload.groups) {
    const r = g.root ? payload.series.find((s) => s.k === g.root) : undefined;
    if (!r || r.unit !== "usd" || !/^(total )?(operating expenses|costs and expenses|operating costs and expenses)$/i.test(r.label.trim())) continue;
    const p = partsOf(payload, ticker, g, cadence);
    if (p && p.ties.length && (!expenses || p.ties.length > expenses.ties.length)) expenses = p;
  }
  return margins.length || expenses ? { margins, expenses } : null;
}
