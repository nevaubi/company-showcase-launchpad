/**
 * Reader scale for a tile's headline figure.
 *
 * A level stored in a scale unit is exact but hard to read: "24,067,204,474" in "USD thousands (monetary
 * measures)" is $24.07 trillion. For a unit on the whitelist below, a tile prints its figure in the scale a
 * reader uses, computed from the stored digits with exact decimal arithmetic and rounded once, half away from
 * zero, to four significant figures ("$24.07 trillion", "13.76 million barrels per day", "1.309 million
 * units"); under a million it is written in full ("$950,000"). Directly beneath it the tile prints the stored
 * figure and unit as filed ("24,067,204,474 USD thousands (monetary measures) as filed"). The chart's value
 * axis and its direct labels take the same scale, and the axis is titled with the scaled unit ("USD
 * trillions"). Headline sentences, tooltips and the table view keep the stored figure and unit.
 *
 * The whitelist holds only units that tiles use for a level or a ranking, matched exactly as the dictionary or
 * the profile states them, each with the multiplier the unit itself names. A unit not on it stays exactly as
 * filed. Scale units whose figures already read in a reader's scale are left off on purpose, because rescaling
 * would only round: "Millions of Units" (vehicle sales, 16.003), "Billion Kilowatthours" (449.4), "Quadrillion
 * Btu" (8.29). "Billions of Chained 2017 Dollars" is used only by a change tile, which prints a percent.
 */
import { absDecimal, formatDecimal, integerDigits, MINUS, roundDecimal, shiftDecimal, signOf, type Decimal } from "./decimal";

export type ReaderScaleName = "one" | "million" | "billion" | "trillion";

const ORDER: readonly ReaderScaleName[] = ["one", "million", "billion", "trillion"];
const EXPONENT: Record<ReaderScaleName, number> = { one: 0, million: 6, billion: 9, trillion: 12 };

/** Significant figures of a figure printed in a reader scale. */
export const SIGNIFICANT = 4;

export type ScaleUnit = {
  /** The unit exactly as stored. */
  unit: string;
  /** A stored figure times 10^exponent is the figure in the base unit. */
  exponent: number;
  /** A dollar amount takes "$" before the figure; any other base unit is named after it. */
  base: { currency: "$" } | { words: string };
  /** The value axis title at each reader scale, in the publisher's own style. */
  axis: Record<ReaderScaleName, string>;
  /** A round 6 unit that asked for the entry; its tile lands with that unit's branch. */
  requested?: string;
};

export const SCALE_UNITS: readonly ScaleUnit[] = [
  {
    // FDIC financial reports and industry summary: dollar amounts in thousands.
    unit: "USD thousands (monetary measures)",
    exponent: 3,
    base: { currency: "$" },
    axis: { one: "USD", million: "USD millions", billion: "USD billions", trillion: "USD trillions" },
  },
  {
    // FRED copies of Census series (retail sales, durable goods orders).
    unit: "Millions of Dollars",
    exponent: 6,
    base: { currency: "$" },
    axis: { one: "Dollars", million: "Millions of Dollars", billion: "Billions of Dollars", trillion: "Trillions of Dollars" },
  },
  {
    // FRED copy of Census housing starts.
    unit: "Thousands of Units",
    exponent: 3,
    base: { words: "units" },
    axis: { one: "Units", million: "Millions of Units", billion: "Billions of Units", trillion: "Trillions of Units" },
  },
  {
    // EIA Monthly Energy Review (crude oil production).
    unit: "Thousand Barrels per Day",
    exponent: 3,
    base: { words: "barrels per day" },
    axis: {
      one: "Barrels per Day",
      million: "Million Barrels per Day",
      billion: "Billion Barrels per Day",
      trillion: "Trillion Barrels per Day",
    },
  },
  {
    // CMS Medicare Part D spending by drug (CMS_PARTD_2024): whole dollars, as the dictionary of snapshot ad25a8c7 states
    // the unit of Tot_Spndng (checked on production 26 Nov 2026).
    unit: "USD nominal gross drug spending",
    exponent: 0,
    base: { currency: "$" },
    axis: { one: "USD", million: "USD millions", billion: "USD billions", trillion: "USD trillions" },
    requested: "sectors",
  },
  {
    // FRED copy of BLS manufacturing employment.
    unit: "Thousands of Persons",
    exponent: 3,
    base: { words: "persons" },
    axis: { one: "Persons", million: "Millions of Persons", billion: "Billions of Persons", trillion: "Trillions of Persons" },
  },
];

/** The whitelist entry of a unit, matched exactly; null keeps the unit as filed. */
export function scaleUnitOf(unit: string): ScaleUnit | null {
  return SCALE_UNITS.find((entry) => entry.unit === unit) ?? null;
}

/** A chart's value axis in a reader scale. */
export type ScaleAxis = {
  /** The scaled unit, the axis title ("USD trillions"). */
  title: string;
  /** Power of ten from the stored unit to the axis unit: a value on the axis is the stored figure × 10^-shift. */
  shift: number;
  /** 10^shift: a plotted value in the stored unit divided by this is read on the axis. */
  divisor: number;
  /** Decimal places of a value written on the chart: those of the headline figure. */
  decimals: number;
};

export type ReaderFigure = {
  /** The figure with its scale word, printed large: "$24.07 trillion", "13.76 million". */
  figure: string;
  /** The base unit named after it ("barrels per day"); empty for a dollar amount. */
  unit: string;
  /** The stored figure and unit, printed directly beneath: "24,067,204,474 USD thousands (monetary measures) as filed". */
  filed: string;
  axis: ScaleAxis;
};

/**
 * Rounds to four significant figures. A carry that adds a digit before the point (9.9995 to 10.000) takes one
 * decimal place less, so the figure keeps four (10.00).
 */
function significant(exact: Decimal): { lead: Decimal; decimals: number } {
  const whole = Math.max(1, integerDigits(exact));
  let decimals = Math.max(0, SIGNIFICANT - whole);
  let lead = roundDecimal(exact, decimals);
  if (integerDigits(lead) > whole && decimals > 0) {
    decimals -= 1;
    lead = roundDecimal(exact, decimals);
  }
  return { lead, decimals };
}

/**
 * A stored level in reader scale, or null when its unit is not on the whitelist (it then stays as filed).
 * `filedFigure` is the stored figure as the tile prints it ("24,067,204,474").
 */
export function readerFigure(unit: string, stored: Decimal, filedFigure: string): ReaderFigure | null {
  const entry = scaleUnitOf(unit);
  if (!entry) return null;
  const base = shiftDecimal(stored, entry.exponent);
  const digits = integerDigits(base);
  let scale: ReaderScaleName = digits > EXPONENT.trillion ? "trillion" : digits > EXPONENT.billion ? "billion" : digits > EXPONENT.million ? "million" : "one";
  let lead = base;
  let decimals = base.scale;
  if (scale !== "one") {
    ({ lead, decimals } = significant(shiftDecimal(base, -EXPONENT[scale])));
    // 999.95 million rounds to 1,000.0 million: it is written one scale up, as 1.000 billion.
    if (integerDigits(lead) > 3 && scale !== "trillion") {
      scale = ORDER[ORDER.indexOf(scale) + 1];
      ({ lead, decimals } = significant(shiftDecimal(base, -EXPONENT[scale])));
    }
  }
  const sign = signOf(lead) < 0 ? MINUS : "";
  const digitsText = formatDecimal(absDecimal(lead), { decimals });
  const number = "currency" in entry.base ? `${sign}${entry.base.currency}${digitsText}` : `${sign}${digitsText}`;
  const shift = EXPONENT[scale] - entry.exponent;
  return {
    figure: scale === "one" ? number : `${number} ${scale}`,
    unit: "words" in entry.base ? entry.base.words : "",
    filed: `${filedFigure} ${unit} as filed`,
    axis: { title: entry.axis[scale], shift, divisor: 10 ** shift, decimals },
  };
}

/** A stored figure as the chart writes it on a reader-scale axis: the axis unit, the headline's decimal places. */
export function axisLabel(stored: Decimal, axis: ScaleAxis): string {
  return formatDecimal(shiftDecimal(stored, -axis.shift), { decimals: axis.decimals });
}
