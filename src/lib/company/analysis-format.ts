// How the Overview's analysis tables print a figure: bare numbers, one decimal convention per unit, a true minus
// sign, and the unit stated once (per table when every row shares it, otherwise once per row). Pure.
import type { Measure, MeasureGroup, MeasureUnit } from "./analysis";

export type UsdScale = "T" | "B" | "M" | "";
const SCALE: Record<UsdScale, number> = { T: 1e12, B: 1e9, M: 1e6, "": 1 };

/** The dollar scale a row is printed in, from its largest figure. */
export function usdScale(values: (number | null | undefined)[]): UsdScale {
  const max = Math.max(0, ...values.filter((v): v is number => v != null && Number.isFinite(v)).map(Math.abs));
  return max >= 1e12 ? "T" : max >= 1e9 ? "B" : max >= 1e6 ? "M" : "";
}

const num = (v: number, digits: number) => v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace("-", "−");
/** Never "−0.0": a change that rounds to nothing prints as 0.0. */
const tidy = (s: string) => (/^−0(\.0+)?$/.test(s) ? s.slice(1) : s);

/** Every figure of a measure that the table prints, for choosing one scale per row. */
export const rowValues = (m: Measure): (number | null)[] => [m.now?.v ?? null, m.prior?.v ?? null, m.median?.v ?? null];

/** A value in the row's unit, without the unit. `scale` applies to dollar rows. */
export function fmtValue(v: number, unit: MeasureUnit, scale: UsdScale = ""): string {
  switch (unit) {
    case "pct":
      return tidy(num(v * 100, 1));
    case "x":
      return tidy(num(v, Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2));
    case "usd": {
      const x = v / SCALE[scale];
      return tidy(num(x, scale === "" ? 0 : Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2));
    }
    case "perShare":
      return tidy(num(v, 2));
    case "days":
      return tidy(num(v, 0));
    case "quarters":
      return tidy(num(v, 1));
  }
}

/** A signed change in the row's unit ("+2.0", "−0.13"); percentages change in points. */
export function fmtChange(d: number, unit: MeasureUnit, scale: UsdScale = ""): string {
  const s = fmtValue(d, unit, scale);
  return s.startsWith("−") || /^0(\.0+)?$/.test(s) ? s : `+${s}`;
}

/** The unit as it is stated once: "%", "×", "$B", "$ per share", "days", "quarters". */
export function unitLabel(unit: MeasureUnit, scale: UsdScale = ""): string {
  switch (unit) {
    case "pct":
      return "%";
    case "x":
      return "×";
    case "usd":
      return `$${scale}`;
    case "perShare":
      return "$ per share";
    case "days":
      return "days";
    case "quarters":
      return "quarters";
  }
}

/** The one unit every row of a group shares, or null when the rows differ (then each row states its own). */
export function groupUnit(g: MeasureGroup): MeasureUnit | null {
  const units = new Set(g.measures.map((m) => m.unit));
  const only = units.size === 1 ? [...units][0] : null;
  return only && only !== "usd" ? only : null;
}

/** A figure with its unit, for a sentence, a tooltip or the source panel ("48.7%", "4.12×", "$466.8B", "25 days"). */
export function fmtWithUnit(v: number, unit: MeasureUnit): string {
  if (unit === "usd") {
    const scale = usdScale([v]);
    const s = fmtValue(Math.abs(v), "usd", scale);
    return `${v < 0 ? "−" : ""}$${s}${scale}`;
  }
  const s = fmtValue(v, unit);
  return unit === "pct" ? `${s}%` : unit === "x" ? `${s}×` : unit === "perShare" ? (s.startsWith("−") ? `−$${s.slice(1)}` : `$${s}`) : `${s} ${unit}`;
}

/** Whether a change is an improvement, a deterioration or neither, by the measure's direction. */
export function changeTone(d: number | null, better: Measure["better"], unit: MeasureUnit): "positive" | "negative" | null {
  if (d == null || !better) return null;
  // changes that print as zero carry no colour
  const eps = unit === "pct" ? 0.0005 : unit === "x" ? 0.005 : unit === "days" ? 0.5 : unit === "quarters" ? 0.05 : unit === "perShare" ? 0.005 : 0;
  if (Math.abs(d) < eps) return null;
  return d > 0 === (better === "high") ? "positive" : "negative";
}
