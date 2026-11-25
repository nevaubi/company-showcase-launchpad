// Presentation of the company's official records, pure. A figure is shown only in the unit its dictionary (or the
// reviewed FR Y-9C list) states; the stored string stays one hover away; nothing is added together.
import { FDIC_ZERO_IS_MISSING } from "@/lib/alt/bank";
import type { AbsSponsorLine, BankHistory, FigureRef, OfficialCell } from "./types";

const MINUS = "−";
const DASH = "–";

/** The unit as a column head states it. */
export function unitLabel(unit: string | null): string {
  if (!unit) return "as filed";
  if (unit === "Percent") return "%";
  if (unit.startsWith("USD thousands")) return "USD thousands";
  return unit;
}

/** Digits grouped, a true minus, the stored decimals kept (a trailing ".0" of a whole number dropped). */
function grouped(text: string): string {
  const m = text.trim().match(/^([+-]?)(\d+)(?:\.(\d+))?(?:[eE][+-]?\d+)?$/);
  if (!m) return text;
  const [, sign, int, frac] = m;
  const body = Number(int).toLocaleString("en-US") + (frac && /[1-9]/.test(frac) ? `.${frac}` : "");
  return (sign === "-" ? MINUS : "") + body;
}

export interface Shown {
  text: string;
  /** The cell as stored, and what it is when it is not a number. */
  title: string;
  empty: boolean;
}

/**
 * A cell for a table. Amounts in USD thousands are grouped as stored; FDIC percentages are rounded to two decimals
 * (the FDIC file stores up to 17); FR Y-9C ratios keep the four decimals they are filed with (`decimals: "stored"`).
 * A field with no established unit shows the stored string exactly.
 */
export function showCell(cell: OfficialCell | null | undefined, unit: string | null, opts: { decimals?: "stored" | 2 } = {}): Shown {
  if (!cell || cell.kind === "null") return { text: DASH, title: "No value stored", empty: true };
  if (cell.kind === "empty") return { text: "", title: "Empty in the filed report", empty: true };
  const stored = `As stored: ${cell.text}`;
  if (cell.kind !== "number" || cell.value == null) return { text: cell.text ?? "", title: stored, empty: false };
  if (unit === "Percent" && opts.decimals !== "stored") {
    const v = Math.round(cell.value * 100) / 100;
    return { text: (v < 0 ? MINUS : "") + Math.abs(v).toFixed(2), title: stored, empty: false };
  }
  if (!unit) return { text: cell.text ?? "", title: stored, empty: false };
  return { text: grouped(cell.text ?? String(cell.value)), title: stored, empty: false };
}

/** "2026-09-30" as a reader says the quarter: "Q3 2026". */
export function quarterLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return m >= 1 && m <= 12 ? `Q${Math.ceil(m / 3)} ${y}` : iso;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-30" as "30 Sep 2026" (fixed month names: locales disagree on "Sep" and "Sept"). */
export function dayLabel(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export interface SeriesPoint {
  period: string;
  value: number | null;
  cell: OfficialCell;
  ref: FigureRef;
  /** Why a stored cell is not drawn. */
  gap: "empty" | "not-reported" | "not-a-number" | null;
}

/**
 * One measure of a bank's history as points to draw. A cell that is not a plain number is a gap, and so is a
 * CET1 ratio stored as zero: the FDIC file holds 0 for quarters before the ratio was reported (src/lib/alt/bank.ts).
 */
export function historySeries(h: BankHistory, field: string): { unit: string; label: string; points: SeriesPoint[]; notReported: number } {
  const i = h.measures.findIndex(m => m.field === field);
  if (i < 0) return { unit: "", label: field, points: [], notReported: 0 };
  let notReported = 0;
  const points = h.points.map((p): SeriesPoint => {
    const cell = p.cells[i];
    const src = h.sources[p.source];
    const ref: FigureRef = { dataset: src.dataset, snapshot: src.snapshot, row: p.row, field };
    if (cell.kind !== "number" || cell.value == null) return { period: p.period, value: null, cell, ref, gap: cell.kind === "empty" || cell.kind === "null" ? "empty" : "not-a-number" };
    if (cell.value === 0 && FDIC_ZERO_IS_MISSING.has(field)) {
      notReported += 1;
      return { period: p.period, value: null, cell, ref, gap: "not-reported" };
    }
    return { period: p.period, value: cell.value, cell, ref, gap: null };
  });
  return { unit: h.measures[i].unit, label: h.measures[i].label, points, notReported };
}

/** Clean axis ticks over a domain; amounts include zero. */
export function niceDomain(values: number[], includeZero: boolean): { min: number; max: number; ticks: number[] } {
  if (!values.length) return { min: 0, max: 1, ticks: [0, 1] };
  let lo = Math.min(...values), hi = Math.max(...values);
  if (includeZero || lo < 0 !== hi < 0) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  if (lo === hi) hi = lo + (Math.abs(lo) || 1);
  const span = hi - lo;
  const raw = span / 5;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(s => s * pow).find(s => s >= raw) ?? 10 * pow;
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t / step) * step);
  return { min, max, ticks };
}

/** Axis tick text: compact for large amounts ("4.0B" on an axis titled in USD thousands), full below 10,000. */
export function tickText(v: number, unit: string): string {
  const sign = v < 0 ? MINUS : "";
  const a = Math.abs(v);
  if (unit === "Percent") return `${sign}${a % 1 === 0 ? a.toFixed(0) : a.toFixed(1)}`;
  if (a < 10_000) return sign + a.toLocaleString("en-US");
  return sign + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(a);
}

export type AssetsTie =
  | { kind: "equal"; date: string; y9cUsd: number; statementUsd: number }
  | { kind: "differs"; date: string; y9cUsd: number; statementUsd: number; difference: number }
  | { kind: "none" };

/**
 * The FR Y-9C's consolidated total assets (BHCK2170, USD thousands) against the 10-Q's total assets for the same
 * date, at the latest date both state. The difference is shown as a difference, never corrected.
 */
export function assetsTie(quarters: { reportDate: string; totalAssets: OfficialCell & { unit: string | null } }[], statement: (date: string) => number | null): AssetsTie {
  for (const q of [...quarters].sort((a, b) => b.reportDate.localeCompare(a.reportDate))) {
    if (q.totalAssets.kind !== "number" || q.totalAssets.value == null || q.totalAssets.unit !== "USD thousands") continue;
    const s = statement(q.reportDate);
    if (s == null || !Number.isFinite(s)) continue;
    const y9cUsd = q.totalAssets.value * 1000;
    return y9cUsd === s ? { kind: "equal", date: q.reportDate, y9cUsd, statementUsd: s } : { kind: "differs", date: q.reportDate, y9cUsd, statementUsd: s, difference: s - y9cUsd };
  }
  return { kind: "none" };
}

/** Section 5 of the research allows exactly this sentence, nothing about exposure or the pool. */
export function absSentence(line: AbsSponsorLine): string {
  return `The filing header of ${line.deals} asset-backed ${line.deals === 1 ? "deal" : "deals"} names ${line.sponsorName} as sponsor.`;
}

/** USD with a true minus and a scale word, for the tie line ("$2.0M", "−$64M"). */
export function usdShort(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}K` : a.toFixed(0);
  return `${v < 0 ? MINUS : ""}$${s}`;
}

type StatementSource = { statements?: { quarterly?: { balance?: Statementish }; annual?: { balance?: Statementish } } } | null | undefined;
type Statementish = { periods: { end: string }[]; rows: { key: string; cells: ({ v: number; src?: import("@/lib/financials/types").SourceRef } | null)[] }[] };

/** The company statement's total assets for a balance-sheet date (quarterly first, then annual), with its SEC source. */
export function statementTotalAssets(dataset: StatementSource, date: string): { value: number; src?: import("@/lib/financials/types").SourceRef } | null {
  for (const s of [dataset?.statements?.quarterly?.balance, dataset?.statements?.annual?.balance]) {
    if (!s) continue;
    const i = s.periods.findIndex(p => p.end === date);
    const cell = i >= 0 ? s.rows.find(r => r.key === "totalAssets")?.cells[i] : null;
    if (cell && Number.isFinite(cell.v)) return { value: cell.v, src: cell.src };
  }
  return null;
}
