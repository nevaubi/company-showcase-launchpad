/**
 * What the Data library's overview says, computed from `getLibrary()`'s answer. Pure.
 *
 * Counting rules (COMMON4, "What accurate means"):
 * - Hidden tables (internal specifications, empty or quarantined tables) are not counted as library tables.
 * - Records are counted over original tables only. A view of another table (a projection or a derived table,
 *   as the catalogue marks it) repeats its parent's records, so its rows are stated apart and never added in.
 * - A snapshot's date is when the file was retrieved, not when the publisher revised it.
 */
import { defaultStringifySearch } from "@tanstack/react-router";
import { COLLECTIONS, PUBLISHERS } from "@/lib/sources/catalog";
import { publisherFor } from "@/lib/sources/catalog/publishers";
import type { SourceLibrary, SourceLibraryChange, SourceLibraryRow } from "@/lib/sources/read-types";
import type { SourceShape } from "@/lib/sources/shape";
import { collectionPath, datasetPath, LIBRARY_PATH } from "./addresses";
import { rowShape } from "./search";
import { utcMinute } from "./table-rows";

export type ShapeCounts = Record<SourceShape, number>;

const isView = (r: SourceLibraryRow) => r.kind === "projection" || r.kind === "derived";
export const visibleRows = (lib: Pick<SourceLibrary, "datasets">) => lib.datasets.filter((r) => !r.hidden);

const PUBLISHER_BY_ID = new Map(PUBLISHERS.map((p) => [p.id, p]));

/** Display names of a publisher id: the catalogue's entry, or the names the library answer carries. */
export function publisherNames(lib: Pick<SourceLibrary, "publishers">) {
  const fromLib = new Map(lib.publishers.map((p) => [p.id, { name: p.name, short: p.short || p.name }]));
  return (id: string): { name: string; short: string } | undefined => {
    const known = PUBLISHER_BY_ID.get(id);
    return known ? { name: known.name, short: known.short } : fromLib.get(id);
  };
}

/** "BLS via FRED" for a copy FRED republished, else the publisher's short name. */
export function publisherLabel(row: Pick<SourceLibraryRow, "agency" | "publisherId">, names: ReturnType<typeof publisherNames>): string {
  const short = names(row.publisherId)?.short ?? row.publisherId;
  return publisherFor(row.agency).via ? `${short} via FRED` : short;
}

export function shapeCounts(rows: readonly SourceLibraryRow[]): ShapeCounts {
  const counts: ShapeCounts = { series: 0, panel: 0, places: 0, table: 0 };
  for (const r of rows) counts[rowShape(r)] += 1;
  return counts;
}

function sumRecords(rows: readonly SourceLibraryRow[]) {
  let records = 0;
  let viewRecords = 0;
  let views = 0;
  for (const r of rows)
    if (isView(r)) {
      views += 1;
      viewRecords += r.rows;
    } else records += r.rows;
  return { records, viewRecords, views };
}

function retrievalSpan(rows: readonly SourceLibraryRow[]): { first: string | null; last: string | null } {
  let first: string | null = null;
  let last: string | null = null;
  for (const r of rows) {
    if (!r.retrievedAt) continue;
    if (!first || r.retrievedAt < first) first = r.retrievedAt;
    if (!last || r.retrievedAt > last) last = r.retrievedAt;
  }
  return { first, last };
}

export type LibraryFactsModel = {
  tables: number;
  hidden: number;
  views: number;
  records: number;
  viewRecords: number;
  publishers: number;
  /** Distinct publisher names as the store registered them. */
  registeredNames: number;
  refreshed: number;
  newest: string | null;
  newestChange: SourceLibraryChange | null;
  collected: { first: string | null; last: string | null };
};

export function libraryFacts(lib: SourceLibrary, rows: readonly SourceLibraryRow[] = visibleRows(lib)): LibraryFactsModel {
  const { records, viewRecords, views } = sumRecords(rows);
  let newest: string | null = null;
  for (const r of rows) if (r.publishedAt && (!newest || r.publishedAt > newest)) newest = r.publishedAt;
  return {
    tables: rows.length,
    hidden: lib.datasets.length - visibleRows(lib).length,
    views,
    records,
    viewRecords,
    publishers: new Set(rows.map((r) => r.publisherId)).size,
    registeredNames: new Set(rows.map((r) => r.agency.trim().toLowerCase())).size,
    refreshed: rows.filter((r) => r.refreshFamily).length,
    newest,
    newestChange: lib.changes[0] ?? null,
    collected: retrievalSpan(rows),
  };
}

export type CollectionCardModel = {
  id: string;
  name: string;
  blurb: string;
  href: string;
  tables: number;
  records: number;
  views: number;
  /** Records of the views here: repeats of their parents' records, shown apart and never added. */
  viewRecords: number;
  /** Short names of the publishers with the most tables here, at most three. */
  publishers: string[];
  morePublishers: number;
  shapes: ShapeCounts;
  collected: { first: string | null; last: string | null };
};

/** One card per collection that holds visible tables, in the catalogue's reading order; internal ones are left out. */
export function collectionCards(lib: SourceLibrary, names = publisherNames(lib)): CollectionCardModel[] {
  const rows = visibleRows(lib);
  const out: CollectionCardModel[] = [];
  for (const c of COLLECTIONS) {
    if (c.internal) continue;
    const mine = rows.filter((r) => r.collectionId === c.id);
    if (!mine.length) continue;
    const byPublisher = new Map<string, number>();
    for (const r of mine) byPublisher.set(r.publisherId, (byPublisher.get(r.publisherId) ?? 0) + 1);
    const ranked = [...byPublisher.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const { records, views, viewRecords } = sumRecords(mine);
    out.push({
      id: c.id,
      name: c.name,
      blurb: c.blurb,
      href: collectionPath(c.id),
      tables: mine.length,
      records,
      views,
      viewRecords,
      publishers: ranked.slice(0, 3).map(([id]) => names(id)?.short ?? id),
      morePublishers: Math.max(0, ranked.length - 3),
      shapes: shapeCounts(mine),
      collected: retrievalSpan(mine),
    });
  }
  return out;
}

export type PublisherRowModel = { id: string; name: string; short: string; tables: number; records: number; views: number };

/** Every publisher with visible tables, most tables first. */
export function publisherRows(lib: SourceLibrary, names = publisherNames(lib)): PublisherRowModel[] {
  const groups = new Map<string, SourceLibraryRow[]>();
  for (const r of visibleRows(lib)) {
    const list = groups.get(r.publisherId) ?? [];
    list.push(r);
    groups.set(r.publisherId, list);
  }
  return [...groups.entries()]
    .map(([id, rows]) => {
      const n = names(id);
      const { records, views } = sumRecords(rows);
      return { id, name: n?.name ?? id, short: n?.short ?? id, tables: rows.length, records, views };
    })
    .sort((a, b) => b.tables - a.tables || b.records - a.records || a.short.localeCompare(b.short));
}

export type ChangeLine = {
  key: string;
  when: string;
  publisher: string;
  text: string;
  kind: SourceLibraryChange["kind"];
  /** A group of one opens its table at the snapshot it names; a larger group opens the list of exactly its tables. */
  href: string;
};

/** How the address names one group of publications: its first time, its kind and its publisher. */
export function changeKey(c: Pick<SourceLibraryChange, "from" | "kind" | "publisherId">): string {
  return `${c.from}~${c.kind}~${c.publisherId ?? "*"}`;
}

/** The group an address names, or null when the library no longer lists it. */
export function changeForKey(lib: Pick<SourceLibrary, "changes">, key: string | undefined): SourceLibraryChange | null {
  if (!key) return null;
  return lib.changes.find((c) => changeKey(c) === key) ?? null;
}

/** The tables of one group, newest first, as the library answer lists them. */
export function changeMembers(lib: Pick<SourceLibrary, "datasets">, change: SourceLibraryChange): SourceLibraryRow[] {
  return change.members.map((i) => lib.datasets[i]).filter((r): r is SourceLibraryRow => !!r);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayMinute = (d: Date) =>
  `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
const minute = (d: Date) => `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;

/** "25 Nov 12:27", "25 Nov 05:30 to 06:36", "24 Nov 23:10 to 25 Nov 00:40" (UTC). */
export function changeWhen(from: string, to: string): string {
  const a = new Date(from);
  const b = new Date(to);
  if (Number.isNaN(a.getTime())) return "–";
  if (Number.isNaN(b.getTime()) || dayMinute(a) === dayMinute(b)) return dayMinute(a);
  const sameDay = a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
  return sameDay ? `${dayMinute(a)} to ${minute(b)}` : `${dayMinute(a)} to ${dayMinute(b)}`;
}

const n = (v: number) => v.toLocaleString("en-US");

export function changeText(c: SourceLibraryChange): string {
  if (c.single && c.datasets === 1) {
    const s = c.single;
    if (c.kind === "first") return `${s.title}, first published, ${n(s.rows)} records`;
    if (s.previousRows == null) return `${s.title}, new version, ${n(s.rows)} records`;
    if (s.previousRows === s.rows) return `${s.title}, new version, ${n(s.rows)} records as before`;
    return `${s.title}, new version, ${n(s.previousRows)} to ${n(s.rows)} records`;
  }
  return `${n(c.datasets)} tables, ${c.kind === "first" ? "first published" : "new version"}`;
}

/** Who published a group: the publisher's short name, or how many publishers a first-publication run spans. */
export function changePublisher(c: SourceLibraryChange, names: ReturnType<typeof publisherNames>): string {
  if (!c.publisherId) return `${n(c.publishers)} ${c.publishers === 1 ? "publisher" : "publishers"}`;
  return names(c.publisherId)?.short ?? c.publisherName ?? c.publisherId;
}

/** A group in the words of a list caption: "EIA, new version, 25 Nov 12:27 UTC". */
export function changeGroupLabel(c: SourceLibraryChange, names: ReturnType<typeof publisherNames>): string {
  return `${changePublisher(c, names)}, ${c.kind === "first" ? "first published" : "new version"}, ${changeWhen(c.from, c.to)} UTC`;
}

/** The newest `limit` groups as lines. */
export function changeLines(lib: SourceLibrary, names = publisherNames(lib), limit = 10): ChangeLine[] {
  return lib.changes.slice(0, limit).map((c, i) => ({
    key: `${changeKey(c)}|${i}`,
    when: changeWhen(c.from, c.to),
    publisher: changePublisher(c, names),
    text: changeText(c),
    kind: c.kind,
    href:
      c.single && c.datasets === 1
        ? datasetPath(c.single.datasetId, { snapshot: c.single.snapshotId })
        : `${LIBRARY_PATH}${defaultStringifySearch({ chg: changeKey(c) })}`,
  }));
}

/** The line under "Last published": the newest group of publications, in words. */
export function newestChangeNote(change: SourceLibraryChange | null, names: ReturnType<typeof publisherNames>): string | null {
  if (!change) return null;
  return `${changePublisher(change, names)}: ${changeText(change)}`;
}

export { utcMinute };
