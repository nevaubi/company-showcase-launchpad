import { z } from "zod";

/**
 * Address state of the table page (`/app/alt-data/library/d/$dataset`). Every key is optional and validated;
 * a key that does not validate is dropped on its own, so one bad value never loses the rest of a link.
 *
 * The router parses search values as JSON (`src/router.tsx` uses the default parser), so `entity=628` arrives
 * as the number 628. Native identifiers are strings: a safe integer is turned back into its digits, anything
 * else that is not a string is refused rather than altered (rev-app M2). "01001" is not valid JSON and stays a
 * string by itself.
 */
const NATIVE_MAX = 512;
export const MAX_COLUMNS = 24;

const digitsBack = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0) ? String(value) : value;

const native = (max: number) =>
  z.preprocess(digitsBack, z.string().min(1).max(max)).optional().catch(undefined);

/** A record number (`row_number` is 1-based in every snapshot). Accepts "25" and 25. */
const rowNumber = z
  .preprocess((value) => (typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : value), z.number().int().min(1).max(Number.MAX_SAFE_INTEGER))
  .optional()
  .catch(undefined);

/** A cursor: the row number a page starts after or ends before. 0 is allowed for "after" (start of the file). */
const cursor = z
  .preprocess((value) => (typeof value === "string" && /^\d{1,16}$/.test(value) ? Number(value) : value), z.number().int().min(0).max(Number.MAX_SAFE_INTEGER))
  .optional()
  .catch(undefined);

/** Field positions as "0,3,17" (what this page writes) or an array of numbers; unique, at most 24. */
export function parseColumns(value: unknown): number[] | undefined {
  let list: unknown[];
  if (typeof value === "number") list = [value];
  else if (typeof value === "string") {
    if (!/^\d{1,5}(,\d{1,5})*$/.test(value)) return undefined;
    list = value.split(",").map(Number);
  } else if (Array.isArray(value)) list = value;
  else return undefined;
  if (!list.length || list.length > MAX_COLUMNS) return undefined;
  const out: number[] = [];
  for (const item of list) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item > 16383 || out.includes(item)) return undefined;
    out.push(item);
  }
  return out;
}

export const columnsParam = (positions: readonly number[]): string | undefined =>
  positions.length ? positions.join(",") : undefined;

/** The field positions an address asks for, or null when it asks for none (the page then uses its defaults). */
export function columnsOf(search: { cols?: string }): number[] | null {
  return search.cols ? (parseColumns(search.cols) ?? null) : null;
}

const look = z
  .object({
    /** Measure: the field label of the profile's measure. */
    m: z.preprocess(digitsBack, z.string().min(1).max(NATIVE_MAX)).optional().catch(undefined),
    /** Series: the key of the indexed dimension that picks one series (an entity id, a place code). */
    s: z.preprocess(digitsBack, z.string().min(1).max(NATIVE_MAX)).optional().catch(undefined),
    /** Chart or table view of the first look. */
    v: z.enum(["chart", "table"]).optional().catch(undefined),
    /** Time range of a series view. */
    r: z.enum(["5y", "10y", "all"]).optional().catch(undefined),
    /** Ranking length. */
    n: z.enum(["15", "40"]).optional().catch(undefined),
  })
  .optional()
  .catch(undefined);

export const datasetSearch = z.object({
  /** A pinned snapshot (64 lowercase hex). Absent: the latest published snapshot. */
  snapshot: z.string().regex(/^[0-9a-f]{64}$/).optional().catch(undefined),
  entity: native(NATIVE_MAX),
  geography: native(NATIVE_MAX),
  period: native(NATIVE_MAX),
  /** Search of entity and place names, scanned in bounded windows. */
  q: z.preprocess(digitsBack, z.string().min(1).max(200)).optional().catch(undefined),
  /** "new": newest period first (default where the snapshot has a sortable period); "file": file order. */
  order: z.enum(["new", "file"]).optional().catch(undefined),
  /** Page starts after this record (in the current order). */
  after: cursor,
  /** Page ends before this record (in the current order); set by "Previous". */
  before: rowNumber,
  /** Fields shown in the records table, by position, as "0,3,17" (read it with `columnsOf`). */
  cols: z
    .preprocess((v) => {
      if (v === undefined) return undefined;
      const list = parseColumns(v);
      return list ? list.join(",") : null;
    }, z.string().optional())
    .catch(undefined),
  /** The open record. */
  row: rowNumber,
  look,
});

export type DatasetSearch = z.infer<typeof datasetSearch>;
export type LookState = NonNullable<DatasetSearch["look"]>;

/** Keys that select records; changing one returns the table to its first page. */
export type RecordFilterPatch = Partial<Pick<DatasetSearch, "entity" | "geography" | "period" | "q" | "order">>;

/** A filter or order change: the cursor goes, the open record stays (it is addressed by number). */
export function filterPatch(patch: RecordFilterPatch): RecordFilterPatch & { after: undefined; before: undefined } {
  return { ...patch, after: undefined, before: undefined };
}

/** Another snapshot: rows, cursors and the open record belong to the old one, the field choice by position may not fit. */
export function snapshotPatch(snapshot: string | undefined): Partial<DatasetSearch> {
  return { snapshot, after: undefined, before: undefined, row: undefined, cols: undefined, look: undefined };
}

export const hasRecordFilter = (s: Pick<DatasetSearch, "entity" | "geography" | "period" | "q">): boolean =>
  !!(s.entity || s.geography || s.period || s.q);
