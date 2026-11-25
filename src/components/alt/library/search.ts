/**
 * Search, filters and order of the Data library's table lists, and the address state that keeps them. Pure.
 *
 * Search runs in the browser over the slim rows `getLibrary()` returns: every word must occur in the title,
 * the stored name, the code, the publisher (display name, short name or the name as registered), the source id
 * or what one record is. Nothing is fuzzy: a word matches where it is written.
 */
import { z } from "zod";
import { shapeOf, type SourceShape } from "@/lib/sources/shape";
import type { SourceLibraryRow } from "@/lib/sources/read-types";

export const SHAPES: readonly SourceShape[] = ["series", "panel", "places", "table"];
export type LibrarySort = "match" | "new" | "size" | "name";

const text = (max: number) => z.string().max(max).optional().catch(undefined);

/** Address state of the library page. `view=changes` lists every table by its latest publication. */
export const librarySearch = z.object({
  q: text(200),
  shape: z.enum(["series", "panel", "places", "table"]).optional().catch(undefined),
  pub: text(80),
  sort: z.enum(["match", "new", "size", "name"]).optional().catch(undefined),
  view: z.enum(["changes"]).optional().catch(undefined),
});
export type LibrarySearch = z.infer<typeof librarySearch>;

/** Address state of a collection page: the same filters, scoped to the collection. */
export const collectionSearch = librarySearch.omit({ view: true });
export type CollectionSearch = z.infer<typeof collectionSearch>;

/** The publisher names a row can be found by. */
export type PublisherNames = (id: string) => { name: string; short: string } | undefined;

/** Lower case, accents folded, so "Société" is found by "societe". */
export function fold(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** The words of a query: at most 12, each as written (punctuation inside a word is kept: "eia-923", "z.1"). */
export function queryWords(q: string | null | undefined): string[] {
  return fold(q ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/^[,;:"'()]+|[,;:"'()]+$/g, ""))
    .filter(Boolean)
    .slice(0, 12);
}

/** What one row can be found by, folded once. Title and code are kept apart for ranking. */
export type SearchText = { title: string; other: string };

export function searchText(row: SourceLibraryRow, publisher: PublisherNames): SearchText {
  const p = publisher(row.publisherId);
  return {
    title: fold(`${row.title} ${row.code ?? ""}`),
    other: fold([row.storedName, p?.name, p?.short, row.agency, row.sourceId, row.grain, row.id].filter(Boolean).join(" ")),
  };
}

/** True when every word occurs somewhere in the row's text. */
export function matchesWords(t: SearchText, words: readonly string[]): boolean {
  return words.every((w) => t.title.includes(w) || t.other.includes(w));
}

/** Words found in the title or code count three times a word found elsewhere; a title that starts with the first word counts more. */
export function matchScore(t: SearchText, words: readonly string[]): number {
  let score = 0;
  for (const w of words) score += t.title.includes(w) ? 3 : 1;
  if (words.length && t.title.startsWith(words[0])) score += 2;
  return score;
}

/** The shape of a table from the dimensions its snapshot fills (core's rule; counts are not known here). */
export function rowShape(row: Pick<SourceLibraryRow, "dimensions" | "rows">): SourceShape {
  const d = new Set(row.dimensions);
  return shapeOf({
    dims: {
      entity: d.has("entity_id") || d.has("entity_name"),
      geography: d.has("geo_code") || d.has("geo_name"),
      period: d.has("period"),
    },
    rows: row.rows,
  });
}

export type TableFilters = {
  q?: string;
  shape?: SourceShape;
  pub?: string;
  collection?: string;
  /** Hidden tables (internal specifications, empty or quarantined tables) are left out unless asked for. */
  includeHidden?: boolean;
};

/** The rows that pass every filter, each with its match score (0 without a query). */
export function filterTables(
  rows: readonly SourceLibraryRow[],
  filters: TableFilters,
  publisher: PublisherNames,
): { row: SourceLibraryRow; score: number }[] {
  const words = queryWords(filters.q);
  const out: { row: SourceLibraryRow; score: number }[] = [];
  for (const row of rows) {
    if (row.hidden && !filters.includeHidden) continue;
    if (filters.collection && row.collectionId !== filters.collection) continue;
    if (filters.pub && row.publisherId !== filters.pub) continue;
    if (filters.shape && rowShape(row) !== filters.shape) continue;
    if (!words.length) {
      out.push({ row, score: 0 });
      continue;
    }
    const t = searchText(row, publisher);
    if (matchesWords(t, words)) out.push({ row, score: matchScore(t, words) });
  }
  return out;
}

const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);
const byTitle = (a: SourceLibraryRow, b: SourceLibraryRow) =>
  a.title.localeCompare(b.title, "en", { sensitivity: "base", numeric: true }) || a.id.localeCompare(b.id);

/** One order for every list; ties fall back to the title, then the id, so the order is stable. */
export function sortTables(items: { row: SourceLibraryRow; score: number }[], sort: LibrarySort): SourceLibraryRow[] {
  const sorted = [...items].sort((x, y) => {
    const a = x.row;
    const b = y.row;
    if (sort === "match") return y.score - x.score || b.rows - a.rows || byTitle(a, b);
    if (sort === "new") return time(b.publishedAt) - time(a.publishedAt) || byTitle(a, b);
    if (sort === "size") return b.rows - a.rows || byTitle(a, b);
    return byTitle(a, b);
  });
  return sorted.map((s) => s.row);
}

/** The order a list opens in: best match while searching, otherwise the page's own default. */
export function effectiveSort(sort: LibrarySort | undefined, q: string | undefined, fallback: Exclude<LibrarySort, "match">): LibrarySort {
  if (sort === "match" && !queryWords(q).length) return fallback;
  return sort ?? (queryWords(q).length ? "match" : fallback);
}

/** True while the library shows a result list in place of its overview. */
export function isFiltering(s: LibrarySearch): boolean {
  return !!(queryWords(s.q).length || s.shape || s.pub || s.view);
}

/** The line above a result list: "38 tables match “mortgage” from FHFA · Panels". */
export function resultsCaption(o: { count: number; q?: string; publisher?: string; shape?: string; changes?: boolean }): string {
  const n = o.count.toLocaleString("en-US");
  const tables = o.count === 1 ? "table" : "tables";
  const q = o.q?.trim();
  let s = q ? `${n} ${tables} ${o.count === 1 ? "matches" : "match"} “${q}”` : `${n} ${tables}`;
  if (o.publisher) s += ` from ${o.publisher}`;
  if (o.shape) s += ` · ${o.shape}`;
  if (o.changes) s += " · by latest publication, newest first";
  return s;
}
