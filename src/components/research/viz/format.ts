// Number formatting for canvas charts: compact figures, %, $, multiples, basis points.
export type Unit = "$" | "%" | "x" | "bp" | "" | undefined;

/** Percent series may arrive as fractions (0.12) or as percents (12). Decide once per chart. */
export function pctIsFraction(values: unknown[]) {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return xs.length > 0 && xs.every((v) => Math.abs(v) <= 1.5);
}

export function compact(v: number, digits = 1) {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(digits)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(digits)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(digits)}K`;
  if (a >= 100) return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (a >= 1) return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (a === 0) return "0";
  return v.toLocaleString("en-US", { maximumSignificantDigits: 3 });
}

export function fmtValue(v: unknown, unit: Unit, opts: { fraction?: boolean; digits?: number; sign?: boolean } = {}) {
  if (typeof v !== "number" || !Number.isFinite(v)) return v == null ? "—" : String(v);
  const sign = opts.sign && v > 0 ? "+" : "";
  if (unit === "%") {
    const p = opts.fraction ?? Math.abs(v) <= 1.5 ? v * 100 : v;
    return `${sign}${p.toFixed(opts.digits ?? (Math.abs(p) >= 100 ? 0 : 1))}%`;
  }
  if (unit === "x") return `${sign}${v.toFixed(opts.digits ?? 1)}x`;
  if (unit === "bp") return `${sign}${Math.round(v)}bp`;
  if (unit === "$") return `${sign}${v < 0 ? "-" : ""}$${compact(Math.abs(v), opts.digits ?? 1)}`;
  return `${sign}${compact(v, opts.digits ?? 1)}`;
}

/** Axis tick formatter: shorter than value labels. */
export function axisFmt(unit: Unit, fraction?: boolean) {
  return (v: number) => fmtValue(v, unit, { fraction, digits: unit === "%" ? 0 : 1 });
}

export const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--muted-foreground)"];

export const AXIS = { fontSize: 10.5, fill: "var(--muted-foreground)" } as const;
export const TOOLTIP_STYLE = {
  fontSize: 11.5,
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  boxShadow: "0 4px 14px rgb(0 0 0 / 0.08)",
} as const;

/** Least-squares line through points; null if x has no spread. */
export function regression(points: { x: number; y: number }[]) {
  const n = points.length;
  if (n < 2) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  if (!sxx) return null;
  const slope = sxy / sxx;
  const r2 = syy ? (sxy * sxy) / (sxx * syy) : 1;
  return { slope, intercept: my - slope * mx, r2 };
}

/** Waterfall bars: invisible base + visible delta, running totals restart at `total` steps. */
export function waterfallBars(steps: { label: string; value: number; total?: boolean }[]) {
  let run = 0;
  return steps.map((s) => {
    if (s.total) {
      run = s.value;
      return { label: s.label, base: Math.min(0, s.value), size: Math.abs(s.value), value: s.value, kind: "total" as const, end: s.value };
    }
    const start = run;
    run += s.value;
    return { label: s.label, base: Math.min(start, run), size: Math.abs(s.value), value: s.value, kind: s.value >= 0 ? ("up" as const) : ("down" as const), end: run };
  });
}

/** Equal-width bins over [min, max]. */
export function histogramBins(values: number[], bins?: number) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!xs.length) return [];
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const k = bins ?? Math.min(40, Math.max(5, Math.ceil(Math.sqrt(xs.length))));
  const w = (hi - lo) / k || 1;
  const out = Array.from({ length: k }, (_, i) => ({ x0: lo + i * w, x1: lo + (i + 1) * w, n: 0 }));
  for (const v of xs) out[Math.min(k - 1, Math.floor((v - lo) / w))].n++;
  return out;
}

/** Normalize rows to shares of their total, for 100% stacked bars. */
export function toShares(data: Record<string, unknown>[], series: string[]) {
  return data.map((d) => {
    const total = series.reduce((s, k) => s + (typeof d[k] === "number" && (d[k] as number) > 0 ? (d[k] as number) : 0), 0);
    const row: Record<string, unknown> = { ...d };
    for (const k of series) row[k] = total && typeof d[k] === "number" ? (d[k] as number) / total : null;
    return row;
  });
}
