/**
 * What the library holds, pure, from the landing's own catalogue rows and the period ranges of the current snapshots:
 * records by collection, tables by the year of their latest period, the publishers with the most tables. Records of a
 * view (a projection or a derived table) repeat its parent's and are never added (the rule of `overview.ts`).
 */
import type { SourceLibrary, SourceLibraryRow } from "@/lib/sources/read-types";
import { collectionCards, publisherRows, visibleRows } from "../overview";
import type { TablePeriod } from "./wire";
import { tableRange } from "./timeline-model";

type Names = (id: string) => { name: string; short: string } | undefined;
type Periods = ReadonlyMap<string, TablePeriod & { note: boolean }>;

const n = (v: number) => v.toLocaleString("en-US");

export type StoreBar = { key: string; label: string; sub?: string; value: number; text: string; title: string; href?: string };

/** Records by collection, most first, with each collection's tables beside the name. */
export function recordsByCollection(lib: SourceLibrary, names: Names): StoreBar[] {
  return collectionCards(lib, names)
    .filter((c) => c.records > 0)
    .sort((a, b) => b.records - a.records || a.name.localeCompare(b.name, "en"))
    .map((c) => ({
      key: c.id,
      label: c.name,
      sub: `${n(c.tables)} ${c.tables === 1 ? "table" : "tables"}`,
      value: c.records,
      text: n(c.records),
      title: `${c.name}: ${n(c.records)} records in ${n(c.tables)} tables${c.views ? `; ${n(c.viewRecords)} more in ${n(c.views)} views repeat them and are not added` : ""}. Opens the collection.`,
      href: c.href,
    }));
}

/** The publishers with the most tables, at most `top`. */
export function publishersByTables(lib: SourceLibrary, names: Names, top = 10): StoreBar[] {
  return publisherRows(lib, names)
    .slice(0, top)
    .map((p) => ({
      key: p.id,
      label: p.short,
      sub: `${n(p.records)} records`,
      value: p.tables,
      text: n(p.tables),
      title: `${p.name}: ${n(p.tables)} ${p.tables === 1 ? "table" : "tables"}, ${n(p.records)} records. Shows its tables.`,
    }));
}

export type YearColumn = { key: string; label: string; value: number; tables: string[]; quiet: boolean };
export type LatestYears = {
  columns: YearColumn[];
  dated: number;
  /** Tables whose latest period is after the anchor year. */
  later: number;
  noPeriod: number;
  notDates: number;
  notCounted: number;
  tables: number;
  anchor: number;
};

/**
 * Tables by the calendar year of their latest period: the `years` years ending with `anchor` (the current year), one
 * column each, and one quiet column for every earlier year. A table whose latest period lies after the anchor
 * (projections, maturities) is counted in the caption, not drawn.
 */
export function tablesByLatestYear(rows: readonly SourceLibraryRow[], periods: Periods, anchor: number, years = 15): LatestYears {
  const first = anchor - years + 1;
  const byYear = new Map<number, SourceLibraryRow[]>();
  const earlier: SourceLibraryRow[] = [];
  let later = 0;
  let noPeriod = 0;
  let notDates = 0;
  let notCounted = 0;
  let dated = 0;
  for (const r of rows) {
    const range = tableRange(periods.get(r.id), r.dimensions.includes("period"));
    if (!range.ok) {
      if (range.reason === "no-period") noPeriod += 1;
      else if (range.reason === "not-dates") notDates += 1;
      else notCounted += 1;
      continue;
    }
    dated += 1;
    const y = Number(range.end.slice(0, 4));
    if (y > anchor) later += 1;
    else if (y < first) earlier.push(r);
    else byYear.set(y, [...(byYear.get(y) ?? []), r]);
  }
  const titles = (list: SourceLibraryRow[]) => [...list].sort((a, b) => b.rows - a.rows).map((r) => r.title);
  const columns: YearColumn[] = [];
  if (earlier.length) columns.push({ key: "earlier", label: `Before ${first}`, value: earlier.length, tables: titles(earlier), quiet: true });
  for (let y = first; y <= anchor; y++) {
    const list = byYear.get(y) ?? [];
    columns.push({ key: String(y), label: String(y), value: list.length, tables: titles(list), quiet: false });
  }
  return { columns, dated, later, noPeriod, notDates, notCounted, tables: rows.length, anchor };
}

/** "Of 1,037 tables, 803 have dated periods: 498 end in 2026. 253 have no period." */
export function latestYearsCaption(t: LatestYears): string {
  const current = t.columns.find((c) => c.key === String(t.anchor))?.value ?? 0;
  let line = `Of ${n(t.tables)} tables, ${n(t.dated)} have periods that are dates; ${n(current)} end in ${t.anchor}`;
  if (t.later) line += `, ${n(t.later)} after it`;
  const notes: string[] = [];
  if (t.noPeriod) notes.push(`${n(t.noPeriod)} ${t.noPeriod === 1 ? "has" : "have"} no period`);
  if (t.notDates) notes.push(`${n(t.notDates)} ${t.notDates === 1 ? "has" : "have"} periods that are not dates`);
  if (t.notCounted) notes.push(`${n(t.notCounted)} ${t.notCounted === 1 ? "is" : "are"} not counted yet`);
  return `${line}.${notes.length ? ` ${notes.join(", ").replace(/^./, (c) => c.toUpperCase())}.` : ""}`;
}

/** The rows a reader sees by default (hidden specification tables are not the library's figures). */
export const storeRows = (lib: SourceLibrary) => visibleRows(lib);
