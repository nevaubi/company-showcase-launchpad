// Labels and number formatting for investor-relations series (pure; shared by the page and tests).
import type { Scale } from "@/lib/format";
import type { IrPayload, PayloadCell, PayloadGroup, PayloadSeries } from "@/lib/ir/payload";
import type { DerivedPart, SourceRef } from "@/lib/financials/types";
import { cellsFor, heldFor } from "@/lib/ir/periods";

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
  if (g.t) return g.t;
  if (!g.root) {
    const c = CATEGORY_LABEL[g.cat] ?? g.cat;
    return `${METRIC_LABEL[g.met] ?? g.met}: other ${c.endsWith(" line") ? `${c}s` : `${c} lines`}`;
  }
  if (root?.sc) return root.sc.replace(/:$/, "");
  if (g.bd && !/^(total|consolidated)/i.test(g.bd)) return g.bd.replace(/:$/, "");
  const metric = METRIC_LABEL[g.met] ?? g.met;
  if (g.cat === "cost") return root?.label ? `${root.label}: components` : "Costs & expenses";
  if (g.cat === "kpi" || g.cat === "balance") return root?.label ?? `${metric}`;
  return `${metric} by ${CATEGORY_LABEL[g.cat] ?? g.cat}`;
}

const n0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const DIV: Record<Scale, number> = { full: 1, K: 1e3, M: 1e6, B: 1e9 };
/** True minus sign; financial tables print negatives as −1,234 rather than (1,234). */
/** A minus only on a figure that does not read as zero (never "−0"). */
const signed = (v: number, s: string) => (v < 0 && /[1-9]/.test(s) ? `−${s}` : s);
/** x with d decimals, adding decimals (up to three) so a nonzero figure never prints as zero. */
const nonzero = (x: number, d: number) => {
  for (let k = d; k <= 3; k++) {
    const out = (k < 3 ? FIXED[k] : FIXED3).format(x);
    if (!x || /[1-9]/.test(out)) return out;
  }
  return `<${FIXED3.format(0.001)}`;
};
const fixed = (d: number) => new Intl.NumberFormat("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const FIXED = [fixed(0), fixed(1), fixed(2)];
const FIXED3 = fixed(3);

export interface IrFormat {
  /** decimals for every cell of a row (see `rowDecimals`) */
  decimals?: number;
  /** one divisor for a whole table of counts (see `countScale`); the caption states it */
  countDiv?: number;
}

/** Table cell text; dollars follow the shared Full/$K/$M/$B toggle. */
export function fmtIr(v: number, unit: string, scale: Scale, f: IrFormat = {}): string {
  const a = Math.abs(v);
  const d = f.decimals;
  switch (unit) {
    case "usd": {
      const x = a / DIV[scale];
      if (d != null) return signed(v, nonzero(x, Math.min(2, d)));
      return signed(v, scale === "B" ? nonzero(x, 2) : scale === "full" ? nonzero(x, 0) : x < 10 && x !== 0 ? nonzero(x, 1) : n0.format(x));
    }
    case "usdPerShare":
      return signed(v, n2.format(a));
    case "pct":
      return signed(v, `${(d != null ? FIXED[Math.min(2, d)] : n1).format(a)}%`);
    case "bps":
      return signed(v, `${n0.format(a)} bps`);
    case "ratio":
      return signed(v, `${n2.format(a)}×`);
    case "count": {
      if (f.countDiv) return signed(v, nonzero(a / f.countDiv, Math.min(2, d ?? (f.countDiv > 1 ? 1 : 0))));
      if (scale === "full" || a < 1e5) return signed(v, a < 100 && !Number.isInteger(v) ? n1.format(a) : n0.format(a));
      const x = a / DIV[scale === "B" && a < 1e8 ? "M" : scale];
      const suffix = scale === "B" && a >= 1e8 ? "B" : scale === "K" ? "K" : "M";
      return signed(v, `${x < 10 ? n2.format(x) : n1.format(x)}${suffix}`);
    }
    default:
      return signed(v, (d != null ? FIXED[Math.min(2, d)] : n2).format(a));
  }
}

/**
 * One decimal convention per row: dollars in the chosen scale get one decimal only when every value
 * of the row is under 10 (so 9.8 and 12 never sit side by side as "9.8" and "12"); other units keep
 * their natural precision.
 */
export function rowDecimals(values: number[], unit: string, scale: Scale): number | undefined {
  if (!values.length) return undefined;
  if (unit === "usd") {
    if (scale === "full") return 0;
    if (scale === "B") return 2;
    // One decimal when any nonzero figure is under 10 in this scale, so $0.4M never reads "0".
    const small = values.some((v) => v !== 0 && Math.abs(v) / DIV[scale] < 10);
    return small ? 1 : 0;
  }
  const tenths = (v: number) => Math.abs(v * 10 - Math.round(v * 10)) < 1e-6;
  if (unit === "pct") return values.every(tenths) ? 1 : 2;
  if (unit === "other") return values.every((v) => Number.isInteger(v)) ? 0 : values.every(tenths) ? 1 : 2;
  return undefined;
}

/** One scale for a whole table of counts, so cells carry no suffix: thousands are written out. */
export function countScale(values: number[]): { div: number; caption: string } {
  const max = Math.max(0, ...values.map(Math.abs));
  // A scale only when every nonzero figure still reads with one decimal (≥ a tenth of the unit).
  const min = Math.min(Infinity, ...values.filter((v) => v !== 0).map(Math.abs));
  if (max >= 1e9 && min >= 1e8) return { div: 1e9, caption: "count, billions" };
  if (max >= 1e6 && min >= 1e5) return { div: 1e6, caption: "count, millions" };
  return { div: 1, caption: "count" };
}
const SCALE_WORD: Record<number, string> = { 1e6: "millions", 1e9: "billions" };
/**
 * Scales for a count table, one per row: rows of very different sizes (customers in millions next
 * to branches in hundreds) each keep a scale their figures read in. When every row shares one, the
 * caption states it; otherwise the caption says "count" and each scaled row names its scale.
 */
export function countScales(rows: number[][]): { caption: string; divs: number[]; note: string[] } {
  const per = rows.map((r) => countScale(r).div);
  const shared = per.every((d) => d === per[0]) ? per[0] ?? 1 : null;
  if (shared != null) return { caption: shared === 1 ? "count" : `count, ${SCALE_WORD[shared]}`, divs: per, note: per.map(() => "") };
  return { caption: "count", divs: per, note: per.map((d) => SCALE_WORD[d] ?? "") };
}
/**
 * The unit a line of mixed "as printed" values carries, read from the printed text around its number
 * ("51 days", "42,000 GPUs", "0.4x"): a short word or sign right after the number. Empty when the
 * text does not show one, or when the line's cells disagree.
 */
export function printedUnit(texts: string[]): string {
  const found = new Map<string, string>();
  for (const t of texts) {
    const m = t.match(/\d[\d,]*(?:\.\d+)?\s*(%|×|x\b|[A-Za-z]{2,12}\b)/);
    if (!m) continue;
    const u = m[1] === "x" ? "×" : m[1];
    if (/^(millions?|billions?|thousands?|in|and|or|to|of|for|the|vs|from|q\d|fy)$/i.test(u)) continue;
    if (!found.has(u.toLowerCase())) found.set(u.toLowerCase(), u);
  }
  return found.size === 1 ? [...found.values()][0] : "";
}
export function unitCaption(unit: string, scale: Scale, countCaption?: string) {
  if (unit === "count" && countCaption) return countCaption;
  if (unit === "usd") return scale === "full" ? "US dollars" : scale === "K" ? "$ thousands" : scale === "M" ? "$ millions" : "$ billions";
  if (unit === "usdPerShare") return "$ per unit";
  if (unit === "pct") return "percent";
  if (unit === "bps") return "basis points";
  if (unit === "ratio") return "ratio";
  if (unit === "other") return "as printed, unit by line";
  return "count";
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Sep ’25" for a quarter end; "FY25" for a fiscal year end. */
export function periodLabel(end: string, kind: "q" | "y" | "m") {
  const yy = end.slice(2, 4);
  return kind === "y" ? `FY${yy}` : `${MON[Number(end.slice(5, 7)) - 1]} ’${yy}`;
}

export function periodLong(end: string, kind: "q" | "y" | "m", months?: number) {
  const d = new Date(`${end}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  if (kind === "y") return `Fiscal year ended ${d}`;
  if (months === 0 || (kind === "m" && months == null)) return `As of ${d}`;
  if (months === 1) return `Month ended ${d}`;
  return months && months !== 3 ? `${months} months ended ${d}` : `Quarter ended ${d}`;
}

/** Source reference for one payload cell, pointing into the stored document or the SEC exhibit. */
/**
 * The number as printed inside a quoted line (e.g. "52,648" from "Americas $ 52,648 $ 50,430"),
 * so the viewer can find it in a table where label and value sit in separate cells.
 */
export function printedToken(quote: string, value: number): string {
  const digits = String(Math.round(Math.abs(value))).replace(/0+$/, "");
  const tokens = quote.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  const hit = tokens.find((t) => {
    const d = t.replace(/[,.]/g, "").replace(/0+$/, "");
    return d.length >= 2 && digits.startsWith(d.slice(0, Math.min(d.length, digits.length)));
  });
  return hit ?? quote;
}

export function refOf(p: IrPayload, c: { v: number; d?: number; l?: PayloadCell["l"]; x?: string; p?: number; sh?: string; s?: string; e?: string }, label: string): SourceRef | undefined {
  if (c.d == null) return undefined;
  const doc = p.docs[c.d];
  if (!doc) return undefined;
  const l = c.l;
  return {
    accn: doc.accn ?? "",
    concept: `${l && !Array.isArray(l) ? "Slide" : !l && c.x && /[a-z]{3}/i.test(c.x) && !doc.id.startsWith("x:") ? "Release text" : "Release table"} · ${label}`,
    start: c.s,
    end: c.e ?? "",
    value: c.v,
    irDoc: doc.id,
    // Partner-corpus values cite a printed line: the viewer goes to its page, finds the line, then the figure in it.
    ...(doc.id.startsWith("x:") && c.x ? { search: printedToken(c.x, c.v), quote: c.x, ...(c.p ? { page: c.p } : {}), ...(c.sh ? { sheet: c.sh } : {}) } : {}),
    // A figure stated in the release's text cites its sentence: the viewer finds it, then the figure in it.
    ...(!doc.id.startsWith("x:") && !l && c.x && /[a-z]{3}/i.test(c.x) ? { search: printedToken(c.x, c.v), quote: c.x } : {}),
    ...(Array.isArray(l) ? { cell: { t: l[0], r: l[1], c: l[2] } } : l ? { box: l } : {}),
  } as SourceRef;
}

export function derivedOf(p: IrPayload, c: PayloadCell): { formula: string; parts: DerivedPart[] } | undefined {
  if (!c.f) return undefined;
  const parts = c.f.parts.map((x) => ({ ...(refOf(p, x, x.label) ?? { accn: "", concept: x.label, end: x.e, value: x.v }), label: x.label, sign: x.sign }));
  return { formula: c.f.formula, parts };
}

/**
 * The columns of `cols` a breakdown actually fills, from its oldest to its newest value: empty columns
 * before the first or after the last value are dropped; a gap in between stays as a column.
 */
export function groupColumns(rows: { s: PayloadSeries }[], cols: string[], kind: "q" | "y" | "m") {
  let first = -1;
  let last = -1;
  cols.forEach((e, i) => {
    if (rows.some((r) => cellsFor(r.s, kind)[e] || heldFor(r.s, kind)[e])) {
      if (first < 0) first = i;
      last = i;
    }
  });
  return first < 0 ? [] : cols.slice(first, last + 1);
}

/** CSV of one breakdown (rows × visible periods), values in full units. */
export function groupCsv(p: IrPayload, g: PayloadGroup, cols: string[], kind: "q" | "y" | "m") {
  const byKey = new Map(p.series.map((s) => [s.k, s]));
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [["Line", "Unit", ...cols.map((c) => (kind === "y" ? `FY ending ${c}` : kind === "m" ? `Month ending ${c}` : `Quarter ending ${c}`))].join(",")];
  for (const r of g.rows) {
    const s = byKey.get(r.k);
    if (!s) continue;
    const cells = cellsFor(s, kind);
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

/**
 * A line name as the page shows it. The readers and the build compose "Heading — child" names
 * ("Data Center — Compute"); the page shows that separator as a colon ("Data Center: Compute"), so no
 * em dash reaches a label. Any other text stays as stored.
 */
export function shownLabel(label: string) {
  return label.replace(/\s+—\s+/g, ": ");
}

/** Inside a "U.S." or "International" breakdown (or a list titled by the lines' lead-in), rows don't repeat it. */
export function rowLabel(label: string, rootLabel?: string | null, px?: string) {
  if (px && label.toLowerCase().startsWith(px.toLowerCase())) {
    const rest = label.slice(px.length).replace(/^\s*([—–-]|:)\s*/, "");
    if (rest) return shownLabel(rest[0].toUpperCase() + rest.slice(1));
  }
  if (!rootLabel) return shownLabel(label);
  for (const tag of GEO_TAGS) {
    const re = new RegExp(`\\s*(—|:)\\s*${esc(tag)}$|^${esc(tag)}\\s*(—|:)\\s*`);
    if (re.test(rootLabel)) return shownLabel(label.replace(re, "") || label);
  }
  return shownLabel(label);
}

/** A title that starts like a document id ("0a1b2c3d-1234-…", also with spaces). */
const UUID_LIKE = /^[0-9a-f]{8}[ -][0-9a-f]{4}[ -]/i;
const squashed = (t: string) => t.split(/\s+/).some((w) => w.length >= 11 && /^[a-z0-9]+$/.test(w)) || t.split(/\s+/).some((w) => w.length >= 6 && /\d[a-z]|[a-z]\d/i.test(w) && !/^(q\d|fy\d|\d{1,2}q)/i.test(w));

/**
 * Library title of a stored document: its own title when it reads as one, else "<kind> · <period>"
 * ("Earnings release · Nov 2026") from the document's period or filing date.
 */
export function libraryTitle(d: { title: string | null; period: string | null; filed: string | null }, kindName: string): string {
  const t = d.title?.replace(/\s+/g, " ").trim() ?? "";
  // Exhibit numbers and long digit runs mark a file name only in a title without spaces or with a
  // file extension: "Exhibit 99.1 NVIDIA Announces Financial Results" is a real title.
  const spaced = /\s/.test(t) && !/\.(html?|pdf|xlsx?|pptx?)\b/i.test(t);
  const looksLikeFile = !t || !spaced || UUID_LIKE.test(t) || (t === t.toLowerCase() && squashed(t));
  if (!looksLikeFile) return t;
  const iso = (x: string | null) => (x && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);
  const at = iso(d.period) ?? iso(d.filed);
  const when = at ? new Date(`${at}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : d.period ?? "";
  return [kindName, when].filter(Boolean).join(" · ");
}
