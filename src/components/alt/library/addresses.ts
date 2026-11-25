/**
 * Addresses of the Data library's own pages and where an old Alt data address now leads. Pure.
 *
 * Paths and slugs come from core's one link builder (`@/lib/sources/links`, `@/lib/sources/collections`):
 * a collection is `/app/alt-data/library/c/<slug>` ("banks"), and its stored id ("01_financials"), an older
 * alias or another letter case names the same collection. Old addresses (`/app/alt-data?view=sources...`)
 * lead to the library page that shows the same thing: a table with its pinned snapshot and filters, a
 * collection, or the library.
 */
import { COLLECTIONS, type Collection } from "@/lib/sources/catalog";
import { collectionIdFromSlug, collectionSlug } from "@/lib/sources/collections";
import { collectionHref, datasetHref, LIBRARY_PATH } from "@/lib/sources/links";

export { collectionSlug, LIBRARY_PATH };

function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The collection an address segment names (slug, alias or stored id, any letter case); null when it names none. */
export function collectionForSegment(segment: string | null | undefined): Collection | null {
  if (!segment) return null;
  const s = decoded(segment).trim();
  const id = collectionIdFromSlug(s) ?? collectionIdFromSlug(s.toLowerCase());
  return (id && COLLECTIONS.find((c) => c.id === id)) || null;
}

/** A collection's address, from its stored id (a dataset's `sector`). */
export function collectionPath(id: string): string {
  return collectionHref(id);
}

/** Filters of a table page that an old address can carry. Native identifiers stay strings. */
export type CarriedFilters = {
  snapshot?: string;
  entity?: string;
  geography?: string;
  period?: string;
  q?: string;
  after?: number;
};

export type LegacyTarget =
  | { kind: "library" }
  | { kind: "collection"; collectionId: string }
  | { kind: "dataset"; datasetId: string; filters: CarriedFilters };

/**
 * A value as the old page's router wrote it: strings that would read as JSON (628, true) were quoted, others
 * were written plainly. A hand-written link may leave a number unquoted ("entity=628"); the raw text is kept,
 * so "00123", "1e3" and "12.50" arrive exactly as typed.
 */
export function nativeParam(raw: string | null, max: number): string | undefined {
  if (raw == null) return undefined;
  let value = raw;
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "string") value = parsed;
    } catch {
      /* Not a JSON string: keep the text as written. */
    }
  }
  return value !== "" && value.length <= max ? value : undefined;
}

/**
 * Where an old `/app/alt-data` address leads, from its raw search string (`?view=sources&...`), or null when it
 * is an address of the Company signals page and stays there. A table wins over a collection; record filters
 * travel only with a table, because without one they belonged to whichever table the old page opened first.
 */
export function legacyTarget(searchStr: string): LegacyTarget | null {
  const params = new URLSearchParams(searchStr.startsWith("?") ? searchStr.slice(1) : searchStr);
  if (nativeParam(params.get("view"), 32) !== "sources") return null;
  const source = nativeParam(params.get("source"), 1024);
  if (source) {
    const filters: CarriedFilters = {};
    const snapshot = nativeParam(params.get("snapshot"), 64);
    if (snapshot && /^[0-9a-f]{64}$/.test(snapshot)) filters.snapshot = snapshot;
    for (const key of ["entity", "geography", "period"] as const) {
      const v = nativeParam(params.get(key), 512);
      if (v !== undefined) filters[key] = v;
    }
    const q = nativeParam(params.get("q"), 200);
    if (q !== undefined) filters.q = q;
    const after = nativeParam(params.get("after"), 20);
    if (after !== undefined && /^\d+$/.test(after) && Number.isSafeInteger(Number(after)) && Number(after) > 0)
      filters.after = Number(after);
    return { kind: "dataset", datasetId: source, filters };
  }
  const sector = nativeParam(params.get("sector"), 128);
  const collection = sector ? COLLECTIONS.find((c) => c.id === sector) : undefined;
  if (collection) return { kind: "collection", collectionId: collection.id };
  return { kind: "library" };
}

const FILTER_ORDER = ["snapshot", "entity", "geography", "period", "q", "after"] as const;

/** A table page's address with filters, through core's builder, in a fixed key order so one view has one address. */
export function datasetPath(datasetId: string, filters: CarriedFilters = {}): string {
  const ordered: CarriedFilters = {};
  for (const k of FILTER_ORDER) if (filters[k] !== undefined && filters[k] !== "") (ordered as Record<string, unknown>)[k] = filters[k];
  return datasetHref(datasetId, ordered);
}

/** The address an old link is sent on to. */
export function legacyHref(target: LegacyTarget): string {
  if (target.kind === "dataset") return datasetPath(target.datasetId, target.filters);
  if (target.kind === "collection") return collectionPath(target.collectionId);
  return LIBRARY_PATH;
}
