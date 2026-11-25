/**
 * Tier 1 of the first look, pure: pictures of a table that parse no cell. Filled share per field comes from the
 * counts stored with the snapshot; records per period and entities by record count come from facet counts when
 * migration 0069 is applied.
 */
import { fieldCode, fieldTitle } from "@/lib/sources/fields";
import { comparePeriods, formatPeriod, type PeriodFormat } from "@/lib/sources/periods";
import type { SourceFacetValue, SourceFieldFill } from "@/lib/sources/read-types";
import type { SourceColumn } from "@/lib/sources/schema";
import type { Bar } from "./ui/bar-list";

export type FillBand = { id: string; label: string; test: (share: number) => boolean };

/** Bands of filled share, from full to empty. Every field falls in exactly one. */
export const FILL_BANDS: readonly FillBand[] = [
  { id: "full", label: "Filled in every record", test: (s) => s === 1 },
  { id: "most", label: "90% or more, not all", test: (s) => s >= 0.9 && s < 1 },
  { id: "half", label: "50% to under 90%", test: (s) => s >= 0.5 && s < 0.9 },
  { id: "some", label: "Under 50%, not empty", test: (s) => s > 0 && s < 0.5 },
  { id: "empty", label: "Empty in every record", test: (s) => s === 0 },
];

export function fillBands(fills: readonly SourceFieldFill[]): { band: FillBand; fields: number }[] {
  return FILL_BANDS.map((band) => ({ band, fields: fills.filter((f) => band.test(f.share)).length }));
}

const pct = (share: number) => (share === 1 ? "100%" : share >= 0.9995 ? ">99.9%" : share > 0 && share < 0.0005 ? "<0.1%" : `${(share * 100).toFixed(1)}%`);

/** One bar per field (for small dictionaries, or the fields shown in the table). */
export function fillBars(fills: readonly SourceFieldFill[], columns: readonly SourceColumn[], positions: readonly number[]): Bar[] {
  return positions
    .filter((p) => fills[p] && columns[p])
    .map((p) => {
      const f = fills[p];
      const title = fieldTitle(columns[p]);
      const code = fieldCode(columns[p]);
      return {
        key: String(p),
        label: title,
        sub: code !== title ? code : undefined,
        value: f.share,
        text: pct(f.share),
        title: `${title}: filled in ${f.filled.toLocaleString("en-US")} of ${(f.filled + f.blank).toLocaleString("en-US")} records (${pct(f.share)})`,
      };
    });
}

/** Records per period from facet counts, oldest first; a floor is said as one. */
export function periodBars(values: readonly SourceFacetValue[], format: PeriodFormat): Bar[] {
  return [...values]
    .sort((a, b) => comparePeriods(a.value, b.value, format))
    .map((v) => {
      const label = formatPeriod(v.value, format);
      const n = v.rows.toLocaleString("en-US");
      return {
        key: v.value,
        label: label.text,
        sub: label.text !== v.value ? v.value : undefined,
        value: v.rows,
        text: v.exact ? n : `${n} or more`,
        title: `${label.text}: ${v.exact ? "" : "at least "}${n} records`,
      };
    });
}

/**
 * Records per period by year when there are many periods and they parse as dates: the count of a year is the sum of
 * its periods' counts, exact only when every one of them is exact.
 */
export function yearBars(values: readonly SourceFacetValue[], format: PeriodFormat): Bar[] | null {
  const years = new Map<string, { rows: number; exact: boolean; periods: number }>();
  for (const v of values) {
    const label = formatPeriod(v.value, format);
    if (label.text === v.value && format === "text") return null;
    const year = /(\d{4})/.exec(label.text)?.[1];
    if (!year) return null;
    const cur = years.get(year) ?? { rows: 0, exact: true, periods: 0 };
    cur.rows += v.rows;
    cur.exact = cur.exact && v.exact;
    cur.periods += 1;
    years.set(year, cur);
  }
  return [...years.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([year, y]) => {
      const n = y.rows.toLocaleString("en-US");
      return {
        key: year,
        label: year,
        sub: `${y.periods} ${y.periods === 1 ? "period" : "periods"}`,
        value: y.rows,
        text: y.exact ? n : `${n} or more`,
        title: `${year}: ${y.exact ? "" : "at least "}${n} records in ${y.periods} periods`,
      };
    });
}

/** Entities by record count from facet counts, most first, at most `top`. */
export function entityBars(values: readonly SourceFacetValue[], top: number): Bar[] {
  return [...values]
    .sort((a, b) => b.rows - a.rows || a.value.localeCompare(b.value))
    .slice(0, top)
    .map((v) => {
      const n = v.rows.toLocaleString("en-US");
      const name = v.label && v.label !== v.value ? v.label : v.value;
      return {
        key: v.value,
        label: name,
        sub: name !== v.value ? v.value : undefined,
        value: v.rows,
        text: v.exact ? n : `${n} or more`,
        title: `${name}: ${v.exact ? "" : "at least "}${n} records`,
      };
    });
}
