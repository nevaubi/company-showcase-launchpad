/**
 * Pure facts of the table page, decided from the stored snapshot only: which dimensions it fills, which orders
 * the records can take, the words for its refresh state and its version. Tested in `dataset-model.test.ts`.
 */
import { periodLabel } from "@/lib/sources/boards/compute";
import { detectPeriodFormat, formatPeriod, parsePeriod, type PeriodFormat } from "@/lib/sources/periods";
import { cadenceOf, locateField, unitOf, type Profile } from "@/lib/sources/profiles";
import type { FieldHint } from "@/lib/sources/fields";
import type { SourceColumn } from "@/lib/sources/schema";
import type { SourceDataset, SourceIngest, SourceSnapshot } from "@/lib/sources/schema";
import type { RecordDims, RecordOrder } from "./record-read";

/** Which record dimensions the snapshot fills: a column, a constant for every row, or a composite period. */
export function recordDims(ingest: Pick<SourceIngest, "dimensions" | "constants" | "composites"> | null | undefined): RecordDims {
  const d = ingest?.dimensions ?? {};
  const c = ingest?.constants ?? {};
  const has = (k: "entity_id" | "entity_name" | "geo_code" | "geo_name" | "period") => d[k] !== undefined || typeof c[k] === "string";
  return {
    entityId: has("entity_id"),
    entityName: has("entity_name"),
    geoCode: has("geo_code"),
    geoName: has("geo_name"),
    period: has("period") || !!ingest?.composites?.period,
  };
}

/** A dimension that varies by row (a column or a composite), not a constant for the whole file. */
export function variesByRow(ingest: Pick<SourceIngest, "dimensions" | "composites"> | null | undefined, key: "entity" | "geo" | "period"): boolean {
  const d = ingest?.dimensions ?? {};
  if (key === "entity") return d.entity_id !== undefined || d.entity_name !== undefined;
  if (key === "geo") return d.geo_code !== undefined || d.geo_name !== undefined;
  return d.period !== undefined || !!ingest?.composites?.period;
}

/**
 * The format of the snapshot's periods, from the first and last stored period (string order, two index probes).
 * "text" when they do not share one declared format: then the records are not ordered as dates.
 */
export function rangeFormat(range: { first: string; last: string } | null): PeriodFormat {
  return range ? detectPeriodFormat([range.first, range.last]) : "text";
}

/** Newest first needs a period that varies by row and sorts as a date when sorted as text. */
export const canOrderNewest = (varies: boolean, format: PeriodFormat) => varies && format !== "text";

/**
 * The order the records are read in. A cursor written without an order is a file-order cursor (old links to the
 * Source explorer carry `after` as a row number in file order), so the page always writes `order` with a cursor
 * it makes in newest order.
 */
export function effectiveOrder(search: { order?: RecordOrder; after?: number; before?: number; q?: string }, newest: boolean): RecordOrder {
  if (search.q || !newest) return "file";
  if (search.order) return search.order;
  return search.after !== undefined || search.before !== undefined ? "file" : "new";
}

export type RefreshState = { kind: "checked"; words: string } | { kind: "static"; words: string };

const CADENCE: Record<string, string> = { fred: "Checked daily", fhfa: "Checked weekly", eia_mer: "Checked weekly" };

/**
 * Refresh words only from what the snapshot itself carries: a snapshot made by the refresh worker names its
 * family in `coverage.refresh_provenance.family`. Anything else is a static copy of the file retrieved on a date.
 */
export function refreshState(coverage: Record<string, unknown> | null | undefined, retrievedDay: string): RefreshState {
  const provenance = coverage?.refresh_provenance;
  const family = provenance && typeof provenance === "object" && !Array.isArray(provenance) ? (provenance as Record<string, unknown>).family : undefined;
  if (typeof family === "string" && CADENCE[family]) return { kind: "checked", words: CADENCE[family] };
  return { kind: "static", words: retrievedDay ? `Static copy of ${retrievedDay}` : "Static copy" };
}

/** Whether the snapshot on screen is the dataset's latest published one. */
export function isLatest(dataset: Pick<SourceDataset, "latest_snapshot_id">, snapshot: Pick<SourceSnapshot, "id">): boolean {
  return dataset.latest_snapshot_id === snapshot.id;
}

/** "2 of 3": the position of a snapshot among the published versions, oldest first. Null when it is not listed. */
export function versionPosition(versions: readonly { id: string; publishedAt: string | null }[], id: string): { n: number; of: number } | null {
  const ordered = [...versions].sort((a, b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? ""));
  const at = ordered.findIndex((v) => v.id === id);
  return at < 0 ? null : { n: at + 1, of: ordered.length };
}

/** Day and time in UTC, as the app writes them: "25 Nov 2026, 12:27 UTC". */
export function utcStamp(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
  return `${day}, ${time} UTC`;
}

/** Day only, in UTC: "24 Nov 2026". */
export function utcDay(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** Grouped digits with a true minus sign. */
export function count(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  const s = Math.abs(Math.trunc(n)).toLocaleString("en-US");
  return n < 0 ? `−${s}` : s;
}

/** A signed change in records between two versions: "+1,204", "−310", "no change". */
export function rowChange(now: number, before: number | null): string {
  if (before === null) return "first";
  const d = now - before;
  if (d === 0) return "no change";
  return d > 0 ? `+${count(d)}` : count(d);
}

/** Bytes in the units a reader expects (decimal, as file managers show them). */
export function bytesText(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "–";
  if (n < 1000) return `${n} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i += 1;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}


/**
 * A period as a reader says it. Where a reviewed profile reads the period dimension, its cadence decides
 * ("2026-10-01" of a monthly FRED series is Oct 2026); otherwise the format alone does. The stored text is the title.
 */
export function periodWords(text: string, format: PeriodFormat, profile: Profile | null): { text: string; title?: string } {
  if (profile && profile.period.from === "dimension") {
    const parsed = parsePeriod(text, profile.period.format);
    if (parsed) {
      const label = periodLabel(parsed, cadenceOf(profile));
      return label === text ? { text } : { text: label, title: text };
    }
  }
  return formatPeriod(text, format);
}

/**
 * What a reviewed profile says about the fields of this snapshot: its measures are quantities, with the unit the
 * profile establishes (a dictionary entry it checked, or the publisher's documentation). A unit kept in a column
 * of the row varies by record and is not put in a column head.
 */
export function profileFields(profile: Profile | null, columns: readonly SourceColumn[]): { hints: Record<string, FieldHint>; units: Map<number, string> } {
  const hints: Record<string, FieldHint> = {};
  const units = new Map<number, string>();
  if (!profile) return { hints, units };
  for (const m of profile.measures) {
    const at = locateField(columns, m.field);
    if (!at.ok) continue;
    hints[at.key] = { role: "quantity" };
    if (m.unit.from === "column") continue;
    const unit = unitOf(m, columns);
    if (unit.ok) units.set(at.index, unit.text);
  }
  return { hints, units };
}
