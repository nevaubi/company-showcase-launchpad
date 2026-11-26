/**
 * What the reads of unit counts send, and the pure steps that pack and unpack it (shared by the server read and the
 * client, so the client never imports the server module).
 */
import type { SourceSnapshotRef } from "@/lib/sources/read-types";
import type { FieldCounts } from "./category-model";
import type { CappedField, CountBasis } from "./stored-counts";

export type CategoryCountsInput = { datasetId: string; snapshotId: string; fields: number[] };
/**
 * The counts of the fields counted value by value (`fields`), the fields the worker did not count value by value
 * (`capped`: more than 1,000 distinct values, or dropped to bound memory), and where the counts come from (`counted`).
 */
export type CategoryCounts = { snapshot: SourceSnapshotRef; fields: FieldCounts[]; capped?: CappedField[]; counted?: CountBasis };

/** One dataset: its id, the least and greatest period strings of its current snapshot, and how many periods. */
export type TablePeriod = { id: string; first: string | null; last: string | null; periods: number | null };
/**
 * As sent: `[id, first, last, periods]`, an id of the usual form `official_<rest>` as `<rest>` and any other as
 * `=<id>`. A period end longer than 40 characters is a note, not a period: both ends go as null and `periods` as -1.
 */
export type TablePeriodsWire = { rows: [string, string | null, string | null, number | null][]; builtAt: string };

const NOTE_LENGTH = 40;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN);

export const packId = (id: string) => (id.startsWith("official_") && id.length > 9 && id[9] !== "=" ? id.slice(9) : `=${id}`);
export const unpackId = (id: string) => (id.startsWith("=") ? id.slice(1) : `official_${id}`);

/** The stats row of an embedded snapshot: PostgREST gives a one-to-one embed as an object (older versions as a list). */
function statsOf(latest: unknown): Record<string, unknown> | null {
  if (!latest || typeof latest !== "object") return null;
  const s = (latest as Record<string, unknown>).stats;
  if (Array.isArray(s)) return (s[0] as Record<string, unknown> | undefined) ?? null;
  return s && typeof s === "object" ? (s as Record<string, unknown>) : null;
}

/** Packs the dataset rows of the select (pure, for tests). */
export function packTablePeriods(rows: readonly Record<string, unknown>[], builtAt: string): TablePeriodsWire {
  const out: TablePeriodsWire["rows"] = [];
  for (const r of rows) {
    const id = str(r.id);
    if (!id) continue;
    const latest = r.latest && typeof r.latest === "object" ? (r.latest as Record<string, unknown>) : null;
    // the embed must be the dataset's current snapshot; anything else is not this dataset's range
    if (!latest || str(latest.id) !== str(r.latest_snapshot_id)) continue;
    const stats = statsOf(latest);
    const first = str(stats?.period_min);
    const last = str(stats?.period_max);
    const count = num(stats?.periods);
    if ((first && first.length > NOTE_LENGTH) || (last && last.length > NOTE_LENGTH)) out.push([packId(id), null, null, -1]);
    else out.push([packId(id), first, last, Number.isSafeInteger(count) ? count : null]);
  }
  return { rows: out, builtAt };
}

export function unpackTablePeriods(wire: TablePeriodsWire): Map<string, TablePeriod & { note: boolean }> {
  return new Map(
    wire.rows.map(([id, first, last, count]) => {
      const full = unpackId(id);
      return [full, { id: full, first, last, periods: count === -1 ? null : count, note: count === -1 }];
    }),
  );
}

