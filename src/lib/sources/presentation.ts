import type { SourceColumn, SourceSnapshotSummary } from "./schema";

/** Manifest keys may be positional (col0001); label retains the exact native header. */
export const nativeColumnCode = (c: SourceColumn) => c.label || c.key;
const IDENTIFIER =
  /^(CERT|ID|RSSDID|RSSDHCR|REPDTE|YEAR|FIPS|STCNTY|STNUMBR|ZIP|ZIPBR|UNINUMBR|BRNUM|STALPBR)$/i;
export const numericColumn = (c: SourceColumn) =>
  !IDENTIFIER.test(nativeColumnCode(c)) &&
  /^(number|numeric|integer|decimal|float|double)$/i.test(c.native_type || c.type);

/** Formats strings without a floating-point round trip, scaling, or treating a reported zero as absent. */
export function formatNativeValue(value: string | null | undefined, column: SourceColumn): string {
  if (value == null) return "—";
  if (value === "") return '""';
  if (!numericColumn(column)) return value;
  const match = /^([+-]?)(\d+)(\.\d+)?$/.exec(value);
  // Leading zeroes and source suppression/exponent notation remain exactly as published.
  if (!match || (match[2].length > 1 && match[2].startsWith("0"))) return value;
  const [, sign, integer, fraction = ""] = match;
  return `${sign === "-" ? "−" : sign}${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction}`;
}

const DEFAULT_KEYS = [
  "NAME",
  "CERT",
  "REPDTE",
  "ASSET",
  "DEP",
  "LNLSNET",
  "ROA",
  "NIMY",
  "YEAR",
  "STCNTY",
  "COUNTY",
  "STNAME",
  "STALPBR",
  "DEPSUMBR",
  "BRNUM",
];

/** A narrow initial table; every native column remains available in the field picker and record detail. */
export function defaultSourceColumns(columns: SourceColumn[], limit = 8): number[] {
  const selected: number[] = [];
  const hasBranchDeposits = columns.some((c) => nativeColumnCode(c).toUpperCase() === "DEPSUMBR");
  const keys = hasBranchDeposits
    ? ["NAMEFULL", "NAMEBR", "CERT", "YEAR", "STALPBR", "CNTYNAMB", "STCNTYBR", "DEPSUMBR"]
    : DEFAULT_KEYS;
  for (const key of keys) {
    const index = columns.findIndex(
      (c) => nativeColumnCode(c).toUpperCase() === key || c.key.toUpperCase() === key,
    );
    if (index >= 0 && !selected.includes(index)) selected.push(index);
  }
  for (let i = 0; i < columns.length && selected.length < limit; i++)
    if (!selected.includes(i)) selected.push(i);
  return selected.slice(0, limit);
}

export function filterSourceColumns(
  columns: SourceColumn[],
  search: string,
): { column: SourceColumn; index: number }[] {
  const needle = search.trim().toLocaleLowerCase();
  return columns
    .map((column, index) => ({ column, index }))
    .filter(
      ({ column }) =>
        !needle ||
        `${column.key} ${column.label} ${column.title ?? ""} ${column.description ?? ""} ${column.unit ?? ""}`
          .toLocaleLowerCase()
          .includes(needle),
    );
}

export function sourceAvailability(snapshot: SourceSnapshotSummary | null | undefined): {
  label: string;
  tone: "quiet" | "pending" | "warning" | "ready";
  ready: boolean;
} {
  if (!snapshot) return { label: "Registered", tone: "quiet", ready: false };
  if (snapshot.status === "failed")
    return { label: "Needs attention", tone: "warning", ready: false };
  if (snapshot.status !== "ready") return { label: "Loading", tone: "pending", ready: false };
  return { label: "Ready", tone: "ready", ready: true };
}

export function safeSourceHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

export function sourceDate(value: string | null | undefined): string {
  if (!value) return "—";
  const day = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return value;
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      });
}

const SECTOR_NAMES: Record<string, string> = {
  financials: "Financials",
  real_estate: "Real estate",
  healthcare: "Healthcare",
  health_care: "Healthcare",
  energy: "Energy",
  utilities: "Utilities",
  industrials: "Industrials",
  materials: "Materials",
  consumer_discretionary: "Consumer discretionary",
  consumer_staples: "Consumer staples",
  information_technology: "Information technology",
  technology: "Technology",
  communication_services: "Communication services",
  sec_company_financials: "Company financials",
  macro: "Macro",
  source_atlas: "Source atlas",
};
export function sourceSectorName(value: string): string {
  const key = value.replace(/^\d+[_\s-]+/, "").toLowerCase();
  return SECTOR_NAMES[key] || key.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export function nativeUnit(column: SourceColumn): string {
  return [column.unit, column.period_basis ?? column.basis].filter(Boolean).join(" · ");
}

/** Only declared, bounded facets are used; the explorer never guesses missing source periods. */
export function sourcePeriods(coverage: Record<string, unknown>): string[] {
  const periods = coverage.periods;
  return Array.isArray(periods) && periods.length <= 250
    ? periods.filter((p): p is string => typeof p === "string")
    : [];
}
