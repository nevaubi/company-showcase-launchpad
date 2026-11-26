// How the IR charts write a figure: dollars in the reader's $K/$M/$B choice (the app's one formatter, fmtIr), the
// other units as printed; the tooltip adds the cell text as filed. Pure.
import { fmtIr, unitCaption } from "@/lib/ir/display";
import { fmtCompactUsd, type Scale } from "@/lib/format";
import { printedDiv } from "@/lib/ir/statements";
import { MINUS } from "@/components/alt/library/charts/primitives";
import type { VizChange, VizPoint, VizSeries, VizUnit } from "./types";

/** A figure in its unit, with the printed unit word for lines "as printed" ("51 days"). */
export function fmtValue(
  v: number,
  unit: VizUnit,
  scale: Scale,
  printedUnit?: string,
  decimals?: number,
): string {
  const keep =
    decimals != null &&
    (unit === "pct" || unit === "ratio" || unit === "other" || unit === "usdPerShare");
  const s = fmtIr(v, unit, scale, keep ? { decimals } : {}).replace(/^-/, MINUS);
  if (unit === "usd") {
    const suffix = scale === "full" ? "" : scale;
    return s.startsWith(MINUS) ? `${MINUS}$${s.slice(1)}${suffix}` : `$${s}${suffix}`;
  }
  if (unit === "other" && printedUnit) return `${s} ${printedUnit}`;
  return s;
}

const SCALE_NAME: Record<string, string> = { K: "thousand", M: "million", B: "billion", T: "trillion" };

/**
 * A headline figure for a reader (tiles, panel headlines): dollars compact with the scale in words ("$50.9 billion",
 * "−$455 million"), the same on every tile whatever the page's $K/$M/$B choice; other units as `fmtValue` writes them.
 */
export function fmtReader(v: number, unit: VizUnit, printedUnit?: string, decimals?: number): string {
  if (unit !== "usd") return fmtValue(v, unit, "full", printedUnit, decimals);
  const a = Math.abs(v);
  const step = a >= 1e12 ? 1e12 : a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 1;
  const s = fmtCompactUsd(v, step > 1 && a / step >= 100 ? 0 : 1);
  return s.replace(/^(−?\$[\d.,]+)([KMBT])$/, (_m, n: string, u: string) => `${n} ${SCALE_NAME[u]}`);
}

/** The scale a figure is printed at, in words ("in millions"), from its value and its printed text; "" when unscaled or unknown. */
export function printedScaleWords(v: number, printed?: string): string {
  const d = printedDiv({ v, x: printed });
  return d === 1e3 ? "in thousands" : d === 1e6 ? "in millions" : d === 1e9 ? "in billions" : "";
}

/** The tooltip of a headline figure: the cell as printed, with the scale it is printed at. */
export function asPrinted(v: number, printed?: string): string | undefined {
  if (!printed) return undefined;
  const w = printedScaleWords(v, printed);
  return `As filed: ${printed.trim()}${w ? ` (${w})` : ""}`;
}

/** A shorter figure for axis ticks: dollars without decimals past what the span needs. */
export function fmtTick(v: number, unit: VizUnit, scale: Scale): string {
  if (unit === "usd") {
    const div = scale === "full" ? 1 : scale === "K" ? 1e3 : scale === "M" ? 1e6 : 1e9;
    const x = v / div;
    const a = Math.abs(x);
    const t =
      a >= 100
        ? Math.round(a).toLocaleString("en-US")
        : a >= 10
          ? a.toFixed(0)
          : a === 0
            ? "0"
            : a.toFixed(1).replace(/\.0$/, "");
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
export function changeLine(label: "YoY" | "QoQ" | "MoM", c: VizChange | null): string | null {
  return c ? `${label} ${fmtChange(c)} (vs ${c.base.short})` : null;
}

/** The decimals the document prints a figure with ("2.48" has two), so a ratio is never shown rounder than filed. */
export function decimalsOf(p: VizPoint): number | undefined {
  if (!p.printed || !/\d/.test(p.printed)) return undefined;
  return p.printed.match(/\.(\d+)/)?.[1].length ?? 0;
}
