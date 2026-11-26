// How the IR charts write a figure: dollars in the reader's $K/$M/$B choice (the app's one formatter, fmtIr), the
// other units as printed; the tooltip adds the cell text as filed. Pure.
import { fmtIr, unitCaption } from "@/lib/ir/display";
import type { Scale } from "@/lib/format";
import { MINUS } from "@/components/alt/library/charts/primitives";
import type { VizChange, VizPoint, VizSeries, VizUnit } from "./types";

/** A figure in its unit, with the printed unit word for lines "as printed" ("51 days"). */
export function fmtValue(v: number, unit: VizUnit, scale: Scale, printedUnit?: string): string {
  const s = fmtIr(v, unit, scale).replace(/^-/, MINUS);
  if (unit === "usd") {
    const suffix = scale === "full" ? "" : scale;
    return s.startsWith(MINUS) ? `${MINUS}$${s.slice(1)}${suffix}` : `$${s}${suffix}`;
  }
  if (unit === "other" && printedUnit) return `${s} ${printedUnit}`;
  return s;
}

/** A shorter figure for axis ticks: dollars without decimals past what the span needs. */
export function fmtTick(v: number, unit: VizUnit, scale: Scale): string {
  if (unit === "usd") {
    const div = scale === "full" ? 1 : scale === "K" ? 1e3 : scale === "M" ? 1e6 : 1e9;
    const x = v / div;
    const a = Math.abs(x);
    const t = a >= 100 ? Math.round(a).toLocaleString("en-US") : a >= 10 ? a.toFixed(0) : a === 0 ? "0" : a.toFixed(1).replace(/\.0$/, "");
    return `${x < 0 ? MINUS : ""}${t}`;
  }
  if (unit === "pct") return `${Number(v.toFixed(2))}`;
  return fmtIr(v, unit, scale).replace(/^-/, MINUS);
}

/** The axis caption: "$ millions", "percent", the printed unit word. */
export function axisCaption(s: Pick<VizSeries, "unit" | "printedUnit">, scale: Scale): string {
  if (s.unit === "other") return s.printedUnit ? s.printedUnit : "as printed";
  return unitCaption(s.unit, scale);
}

/** "+3.2%", "−0.40 pts", "+12 bps": the sign written out, never colour alone. */
export function fmtChange(c: VizChange | null): string {
  if (!c) return "";
  const sign = c.value > 0 ? "+" : c.value < 0 ? MINUS : "";
  const a = Math.abs(c.value);
  if (c.kind === "pts") return `${sign}${a.toFixed(2).replace(/0$/, "")} pts`;
  if (c.kind === "bps") return `${sign}${Math.round(a)} bps`;
  return `${sign}${a >= 100 ? Math.round(a).toLocaleString("en-US") : a.toFixed(1)}%`;
}

/** The tooltip's as-filed line: the cell text exactly as the document prints it. */
export function asFiled(p: VizPoint): string {
  return p.printed ? `As filed: ${p.printed}` : "As filed: not printed as a table cell";
}

/** The change line of a tooltip: "YoY +3.2% (vs Sep ’24)". */
export function changeLine(label: "YoY" | "QoQ", c: VizChange | null): string | null {
  return c ? `${label} ${fmtChange(c)} (vs ${c.base.short})` : null;
}
