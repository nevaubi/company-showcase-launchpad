import type { SourceRecordPage } from "./schema";
import { nativeColumnCode, safeSourceHref } from "./presentation";

// Numeric source strings are never parsed: this both retains precision and distinguishes a
// negative financial number from formula text such as -1+2 or -cmd|' /C ...'.
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const FORMULA = /^[\s\u0000-\u001f\u007f]*[=+\-@]/u;
/**
 * Published figures and markers that start with a sign but cannot be a formula: "-1,234",
 * "-0.5%", "+1.2%", "-", "--" (rev-app N2). Anything with a letter, a bracket or a second
 * operator after the sign ("-1+2", "-cmd|...") is still guarded.
 */
const SIGNED_FIGURE = /^[+-](?:\d[\d,]*(?:\.\d+)?%?|-*)$/;

export function csvSourceCell(value: string | null | undefined): string {
  if (value == null) return "";
  const guarded = FORMULA.test(value) && !NUMBER.test(value.trim()) && !SIGNED_FIGURE.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Only the currently received page is exported; source values are not formatted or rescaled. */
export function sourcePageCsv(page: SourceRecordPage, fallbackUrl?: string | null): string {
  const rows: (string | null)[][] = [
    ["Source row", "Snapshot ID", "Source URL", ...page.columns.map(nativeColumnCode)],
    ...page.rows.map((r) => [
      String(r.row_number),
      page.snapshot_id,
      safeSourceHref(r.source_url) || safeSourceHref(fallbackUrl),
      ...r.values,
    ]),
  ];
  return rows.map((r) => r.map(csvSourceCell).join(",")).join("\r\n") + "\r\n";
}
