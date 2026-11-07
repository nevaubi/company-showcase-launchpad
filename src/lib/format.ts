import type { Unit } from "@/lib/financials/types";

// HTML entity decoding lives in the pure redline extractor; re-exported here for callers
// that only need formatting helpers (e.g. src/lib/data.ts cleaning insider names).
export { decodeEntities } from "@/lib/redline/extract";

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
const n0 = nf(0, 0);
const n1 = nf(1, 1);
const n2 = nf(2, 2);

const UNITS: [number, string][] = [
  [1e3, "K"],
  [1e6, "M"],
  [1e9, "B"],
  [1e12, "T"],
];

/** Compact magnitude with unit, stepping up when rounding reaches 1,000 (999.96M → 1.0B). */
function compact(a: number, digits: number, tDigits: number): string | null {
  let i = UNITS.length - 1;
  while (i >= 0 && a < UNITS[i][0]) i--;
  if (i < 0) return null;
  const fmt = (k: number) => (a / UNITS[k][0]).toFixed(UNITS[k][1] === "T" ? tDigits : digits);
  let r = fmt(i);
  if (Number(r) >= 1000 && i < UNITS.length - 1) r = fmt(++i);
  return `${r}${UNITS[i][1]}`;
}

export function fmtCompactUsd(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  if (a === 0) return "$0";
  const c = compact(a, digits, digits + 1);
  return c ? `${sign}$${c}` : `${sign}$${a.toFixed(2)}`;
}

export function fmtCompact(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  const sign = v < 0 ? "−" : "";
  const c = compact(a, digits, digits);
  return c ? `${sign}${c}` : `${sign}${a.toFixed(0)}`;
}

export function fmtPrice(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `$${n2.format(v)}`;
}

export function fmtPct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = (v * 100).toFixed(digits);
  const out = signed && v > 0 ? `+${s}%` : `${s}%`;
  return out.replace("-", "−");
}

export function fmtSigned(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
}

export type Scale = "full" | "K" | "M" | "B";

export const SCALES: { v: Scale; l: string; title: string }[] = [
  { v: "full", l: "Full", title: "Exact dollar values" },
  { v: "K", l: "$K", title: "Thousands of dollars" },
  { v: "M", l: "$M", title: "Millions of dollars" },
  { v: "B", l: "$B", title: "Billions of dollars" },
];

const SCALE_DIV: Record<Scale, number> = { full: 1, K: 1e3, M: 1e6, B: 1e9 };

/** Scale a raw value for display/export: dollars and share counts follow the unit toggle. */
export function scaled(v: number, unit: Unit, scale: Scale): number {
  return unit === "usd" || unit === "shares" ? v / SCALE_DIV[scale] : v;
}

const paren = (v: number, s: string) => (v < 0 ? `(${s})` : s);

/** Statement cell formatting, accounting style (negatives in parentheses). */
export function fmtCell(v: number, unit: Unit, scale: Scale = "M"): string {
  switch (unit) {
    case "usd": {
      const x = Math.abs(v / SCALE_DIV[scale]);
      return paren(v, scale === "B" ? n1.format(x) : n0.format(x));
    }
    case "usdPerShare":
      return paren(v, n2.format(Math.abs(v)));
    case "shares": {
      const x = Math.abs(v / SCALE_DIV[scale]);
      return paren(v, scale === "B" ? n2.format(x) : n0.format(x));
    }
    case "pct":
      return `${(v * 100).toFixed(1)}%`.replace("-", "−");
    case "ratio":
      return `${v.toFixed(2)}×`.replace("-", "−");
    case "days":
      return n0.format(v);
  }
}

export function unitLabel(unit: Unit, scale: Scale = "M"): string {
  switch (unit) {
    case "usd":
      return scale === "full" ? "$" : `$${scale}`;
    case "usdPerShare":
      return "$/sh";
    case "shares":
      return scale === "full" ? "sh" : `${scale} sh`;
    case "pct":
      return "%";
    case "ratio":
      return "×";
    case "days":
      return "days";
  }
}

/** Human description of the active scale, for table captions. */
export function scaleCaption(scale: Scale) {
  return scale === "full" ? "US dollars" : scale === "K" ? "thousands of US dollars" : scale === "M" ? "millions of US dollars" : "billions of US dollars";
}

export function fmtValueLong(v: number, unit: Unit | string): string {
  if (unit === "usd") return `$${n0.format(v)}`;
  if (unit === "usdPerShare") return `$${n2.format(v)} per share`;
  if (unit === "shares") return `${n0.format(v)} shares`;
  if (unit === "pct") return fmtPct(v, 2);
  if (unit === "ratio") return `${v.toFixed(2)}×`;
  if (unit === "days") return `${n0.format(v)} days`;
  return n2.format(v);
}

export function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }) {
  if (!d) return "—";
  const date = d.length === 10 ? new Date(`${d}T12:00:00Z`) : new Date(d);
  if (Number.isNaN(date.getTime())) return d;
  return date.toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
}

export function fmtRelative(d: string | Date): string {
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(new Date(t).toISOString());
}

export function fmtInt(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  return n0.format(v);
}

export function toneOf(v: number | null | undefined): "positive" | "negative" | "neutral" {
  if (v == null || !Number.isFinite(v) || v === 0) return "neutral";
  return v > 0 ? "positive" : "negative";
}

export const toneClass = {
  positive: "text-positive",
  negative: "text-negative",
  neutral: "text-muted-foreground",
} as const;

export function fiscalYearEndLabel(mmdd: string) {
  if (!mmdd || mmdd.length !== 4) return "—";
  const m = Number(mmdd.slice(0, 2));
  const d = Number(mmdd.slice(2));
  return new Date(Date.UTC(2000, m - 1, d)).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });
}

export function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|\s|-)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}

export const SEC_FORM_LABEL: Record<string, string> = {
  "10-K": "Annual report",
  "10-K/A": "Annual report (amended)",
  "10-Q": "Quarterly report",
  "10-Q/A": "Quarterly report (amended)",
  "8-K": "Current report",
  "8-K/A": "Current report (amended)",
  "DEF 14A": "Proxy statement",
  DEFA14A: "Additional proxy materials",
  ARS: "Annual report to shareholders",
  SD: "Specialized disclosure",
  "11-K": "Employee plan annual report",
  "S-8": "Employee plan registration",
  "SC 13G": "Beneficial ownership (passive)",
  "SC 13G/A": "Beneficial ownership (passive, amended)",
  "4": "Insider transaction",
};

export const INSIDER_CODES: Record<string, string> = {
  P: "Open-market purchase",
  S: "Open-market sale",
  A: "Grant / award",
  M: "Option exercise",
  F: "Tax withholding",
  G: "Gift",
  C: "Conversion",
  D: "Disposition to issuer",
  J: "Other",
  X: "Option exercise (in-the-money)",
};
