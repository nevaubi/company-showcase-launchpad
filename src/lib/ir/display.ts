// Labels and number formatting for investor-relations series (pure; shared by the page and tests).
import type { Scale } from "@/lib/format";
import type { IrPayload, PayloadCell, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";
import type { DerivedPart, SourceRef } from "@/lib/financials/types";

export const CATEGORY_LABEL: Record<string, string> = {
  segment: "segment",
  product: "product & service",
  geography: "geography",
  customer: "customer & end market",
  channel: "channel",
  cost: "cost & expense line",
  kpi: "operating KPI",
  balance: "balance",
  other: "other line",
};

export const METRIC_LABEL: Record<string, string> = {
  revenue: "Revenue",
  operating_income: "Operating income",
  segment_profit: "Segment profit",
  gross_profit: "Gross profit",
  net_income: "Net income",
  cost: "Costs",
  expense: "Expenses",
  margin: "Margins",
  units: "Units",
  users: "Users & subscribers",
  volume: "Volume",
  price: "Pricing",
  backlog: "Backlog",
  assets: "Assets",
  deposits: "Deposits",
  loans: "Loans",
  aum: "Assets under management",
  headcount: "Headcount",
  stores: "Locations",
  other: "Other",
};

/** Dimension filters shown above the breakdowns. */
export const DIMENSIONS: { v: string; l: string; cats: string[] }[] = [
  { v: "all", l: "All", cats: [] },
  { v: "revenue", l: "Revenue mix", cats: ["segment", "product", "geography", "customer", "channel"] },
  { v: "profit", l: "Segment profit", cats: [] },
  { v: "cost", l: "Costs", cats: ["cost"] },
  { v: "kpi", l: "KPIs", cats: ["kpi"] },
  { v: "balance", l: "Balances", cats: ["balance"] },
];

const PROFIT = new Set(["operating_income", "segment_profit", "gross_profit", "net_income"]);

export function inDimension(g: PayloadGroup, dim: string) {
  if (dim === "all") return true;
  if (dim === "revenue") return g.met === "revenue" && DIMENSIONS[1].cats.includes(g.cat);
  if (dim === "profit") return PROFIT.has(g.met) && g.cat !== "cost";
  if (dim === "cost") return g.cat === "cost" || g.met === "cost" || g.met === "expense";
  return DIMENSIONS.find((d) => d.v === dim)?.cats.includes(g.cat) ?? true;
}

const ORDER_MET = ["revenue", "gross_profit", "segment_profit", "operating_income", "net_income", "cost", "expense", "margin", "units", "users", "volume", "price", "backlog", "loans", "deposits", "assets", "aum", "stores", "headcount", "other"];
const ORDER_CAT = ["segment", "product", "geography", "customer", "channel", "cost", "kpi", "balance", "other"];

/** Worldwide breakdowns first, then their U.S. and international splits. */
const geoRank = (g: PayloadGroup) => (/(^|—\s*)U\.S\.(\s*—|$)/.test(g.label) ? 1 : /(^|—\s*)International(\s*—|$)/.test(g.label) ? 2 : 0);

export function groupOrder(a: PayloadGroup, b: PayloadGroup) {
  // Proper breakdowns (a printed total with its parts) before loose lists of other lines.
  if (!a.root !== !b.root) return a.root ? -1 : 1;
  const m = ORDER_MET.indexOf(a.met) - ORDER_MET.indexOf(b.met);
  if (a.met === "revenue" && b.met === "revenue") return ORDER_CAT.indexOf(a.cat) - ORDER_CAT.indexOf(b.cat) || geoRank(a) - geoRank(b) || b.rows.length - a.rows.length;
  if (a.met === "revenue" || b.met === "revenue") return a.met === "revenue" ? -1 : 1;
  return ORDER_CAT.indexOf(a.cat) - ORDER_CAT.indexOf(b.cat) || m || b.rows.length - a.rows.length;
}

export function groupTitle(g: PayloadGroup, root?: PayloadSeries) {
  if (!g.root) return `${METRIC_LABEL[g.met] ?? g.met} — other ${CATEGORY_LABEL[g.cat] ?? g.cat} lines`;
  if (root?.sc) return root.sc.replace(/:$/, "");
  if (g.bd && !/^(total|consolidated)/i.test(g.bd)) return g.bd.replace(/:$/, "");
  const metric = METRIC_LABEL[g.met] ?? g.met;
  if (g.cat === "cost") return root?.label ? `${root.label} — components` : "Costs & expenses";
  if (g.cat === "kpi" || g.cat === "balance") return root?.label ?? `${metric}`;
  return `${metric} by ${CATEGORY_LABEL[g.cat] ?? g.cat}`;
}

const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DIV: Record<Scale, number> = { full: 1, K: 1e3, M: 1e6, B: 1e9 };
const paren = (v: number, s: string) => (v < 0 ? `(${s})` : s);

/** Table cell text, accounting style; dollars follow the shared Full/$K/$M/$B toggle. */
export function fmtIr(v: number, unit: string, scale: Scale): string {
  const a = Math.abs(v);
  switch (unit) {
    case "usd": {
      const x = a / DIV[scale];
      return paren(v, scale === "B" ? n2.format(x) : scale === "full" ? n0.format(x) : x < 10 && x !== 0 ? n1.format(x) : n0.format(x));
    }
    case "usdPerShare":
      return paren(v, n2.format(a));
    case "pct":
      return `${n1.format(v)}%`.replace("-", "−");
    case "bps":
      return `${n0.format(v)} bps`.replace("-", "−");
    case "ratio":
      return `${n2.format(v)}×`;
    case "count": {
      if (scale === "full" || a < 1e5) return paren(v, a < 100 && !Number.isInteger(v) ? n1.format(a) : n0.format(a));
      const x = a / DIV[scale === "B" && a < 1e8 ? "M" : scale];
      const suffix = scale === "B" && a >= 1e8 ? "B" : scale === "K" ? "K" : "M";
      return paren(v, `${x < 10 ? n2.format(x) : n1.format(x)}${suffix}`);
    }
    default:
      return n2.format(v);
  }
}

export function unitCaption(unit: string, scale: Scale) {
  if (unit === "usd") return scale === "full" ? "US dollars" : scale === "K" ? "$ thousands" : scale === "M" ? "$ millions" : "$ billions";
  if (unit === "usdPerShare") return "$ per unit";
  if (unit === "pct") return "percent";
  if (unit === "bps") return "basis points";
  if (unit === "ratio") return "ratio";
  return "count";
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sep ’25" for a quarter end; "FY25" for a fiscal year end. */
export function periodLabel(end: string, kind: "q" | "y") {
  const yy = end.slice(2, 4);
  return kind === "y" ? `FY${yy}` : `${MON[Number(end.slice(5, 7)) - 1]} ’${yy}`;
}

export function periodLong(end: string, kind: "q" | "y", months?: number) {
  const d = new Date(`${end}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  return kind === "y" ? `Fiscal year ended ${d}` : months && months !== 3 ? `${months} months ended ${d}` : `Quarter ended ${d}`;
}

/** Source reference for one payload cell, pointing into the stored document or the SEC exhibit. */
export function refOf(p: IrPayload, c: { v: number; d?: number; l?: PayloadCell["l"]; x?: string; s?: string; e?: string }, label: string): SourceRef | undefined {
  if (c.d == null) return undefined;
  const doc = p.docs[c.d];
  if (!doc) return undefined;
  const l = c.l;
  return {
    accn: doc.accn ?? "",
    concept: `${l && !Array.isArray(l) ? "Slide" : "Release table"} · ${label}`,
    start: c.s,
    end: c.e ?? "",
    value: c.v,
    irDoc: doc.id,
    ...(Array.isArray(l) ? { cell: { t: l[0], r: l[1], c: l[2] } } : l ? { box: l } : {}),
  } as SourceRef;
}

export function derivedOf(p: IrPayload, c: PayloadCell): { formula: string; parts: DerivedPart[] } | undefined {
  if (!c.f) return undefined;
  const parts = c.f.parts.map((x) => ({ ...(refOf(p, x, x.label) ?? { accn: "", concept: x.label, end: x.e, value: x.v }), label: x.label, sign: x.sign }));
  return { formula: c.f.formula, parts };
}

/** CSV of one breakdown (rows × visible periods), values in full units. */
export function groupCsv(p: IrPayload, g: PayloadGroup, cols: string[], kind: "q" | "y") {
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [["Line", "Unit", ...cols.map((c) => (kind === "y" ? `FY ending ${c}` : `Quarter ending ${c}`))].join(",")];
  for (const r of g.rows) {
    const s = byKey.get(r.k);
    if (!s) continue;
    const cells = kind === "y" ? s.y : s.q;
    lines.push([esc(`${"  ".repeat(r.depth ? 0 : 0)}${s.label}`), s.unit, ...cols.map((c) => (cells[c] ? String(cells[c].v) : ""))].join(","));
  }
  return lines.join("\n");
}

/** Compare each quarter's top-line revenue total from the releases with SEC-reported revenue. */
export function secRevenueCheck(p: IrPayload, reported: { end: string; v: number }[]) {
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  const roots = p.groups
    .filter((g) => g.root && g.met === "revenue" && g.unit === "usd" && ["segment", "product", "geography"].includes(g.cat))
    .map((g) => byKey.get(g.root!)!)
    .filter(Boolean);
  const out: { label: string; period: string; ir: number; sec: number; ok: boolean }[] = [];
  for (const r of reported) {
    // A release prints the top line in several tables; the largest matching root is the consolidated one.
    const cands = roots.map((s) => ({ s, c: s.q[r.end] })).filter((x) => x.c && !x.c.f);
    if (!cands.length) continue;
    const best = cands.reduce((a, b) => (Math.abs(b.c.v - r.v) < Math.abs(a.c.v - r.v) ? b : a));
    out.push({ label: best.s.label, period: r.end, ir: best.c.v, sec: r.v, ok: Math.abs(best.c.v - r.v) <= Math.max(1e6, Math.abs(r.v) * 0.005) });
  }
  return out;
}

const GEO_TAGS = ["U.S.", "International"];
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Inside a "U.S." or "International" breakdown, rows don't need to repeat the geography. */
export function rowLabel(label: string, rootLabel?: string | null) {
  if (!rootLabel) return label;
  for (const tag of GEO_TAGS) {
    const re = new RegExp(`\\s*—\\s*${esc(tag)}$|^${esc(tag)}\\s*—\\s*`);
    if (re.test(rootLabel)) return label.replace(re, "") || label;
  }
  return label;
}
