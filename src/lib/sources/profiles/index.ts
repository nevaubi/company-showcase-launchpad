import type { SourceColumn } from "../schema";
import type {
  Cadence,
  FieldLocation,
  FieldMatch,
  MeasureSpec,
  PeriodSpec,
  Profile,
  ProfileDataset,
  ProfileEntry,
  ProfileField,
  ProfileStatus,
  SeriesAddress,
} from "./types";
import { PROFILE_ENTRIES } from "./registry";
import { locateField, unmatchedFields } from "./define";

export type * from "./types";
export { PROFILE_ENTRIES } from "./registry";
export { defineProfile, locateField, requiredFields, unmatchedFields } from "./define";

function sentence(family: string, unmatched: { field: string; reason: "missing" | "repeated" }[]): string {
  const missing = unmatched.filter((u) => u.reason === "missing").map((u) => u.field);
  const repeated = unmatched.filter((u) => u.reason === "repeated").map((u) => u.field);
  const parts: string[] = [];
  if (missing.length) parts.push(`${missing.length === 1 ? "field" : "fields"} ${missing.join(", ")} not found`);
  if (repeated.length)
    parts.push(`${repeated.length === 1 ? "field" : "fields"} ${repeated.join(", ")} found more than once`);
  return `Charts are off for this version: the ${family} profile reads fields this version does not carry as expected (${parts.join("; ")}).`;
}

/**
 * The profile of a dataset for one snapshot's fields, with the reason when a family claims the dataset
 * but the fields do not match. `entries` is the registry unless a test passes its own.
 */
export function profileStatus(
  dataset: ProfileDataset,
  fields: readonly ProfileField[],
  entries: readonly ProfileEntry[] = PROFILE_ENTRIES,
): ProfileStatus {
  let off: ProfileStatus | null = null;
  for (const entry of entries) {
    if (!entry.claims(dataset)) continue;
    const profile = entry.profile(dataset);
    if (profile.applies(dataset, fields)) return { state: "on", profile };
    if (!off) off = { state: "off", family: entry.family, reason: sentence(entry.family, unmatchedFields(profile.requires, fields)) };
  }
  return off ?? { state: "none" };
}

/** The profile that may draw this dataset's measures from a snapshot with these fields, or null. */
export function profileFor(
  dataset: ProfileDataset,
  fields: readonly ProfileField[],
  entries: readonly ProfileEntry[] = PROFILE_ENTRIES,
): Profile | null {
  const status = profileStatus(dataset, fields, entries);
  return status.state === "on" ? status.profile : null;
}

/** The measure of a profile by its field label. */
export function measureOf(profile: Profile, field: string): MeasureSpec | null {
  return profile.measures.find((m) => m.field === field) ?? null;
}

export type UnitReading = { ok: true; text: string } | { ok: false; reason: string };

/**
 * The unit of a measure for one record, as the source states it.
 * - dictionary: the dictionary entry of the measure's field must state exactly the text the profile expects;
 * - column: the cell of the unit column in the same record (`cellOf` returns a cell by field label);
 * - constant: the text the profile carries with its evidence.
 */
export function unitOf(
  measure: MeasureSpec,
  columns: readonly SourceColumn[],
  cellOf?: (label: string) => string | null | undefined,
): UnitReading {
  if (measure.unit.from === "constant") return { ok: true, text: measure.unit.text };
  if (measure.unit.from === "dictionary") {
    const found = locateField(columns, measure.field);
    if (!found.ok) return { ok: false, reason: `field ${measure.field} ${found.reason === "missing" ? "not found" : "found more than once"}` };
    const stated = columns[found.index].unit;
    if (stated !== measure.unit.text)
      return {
        ok: false,
        reason: `the dictionary states ${stated === undefined || stated === "" ? "no unit" : `"${stated}"`} for ${measure.field}, not "${measure.unit.text}"`,
      };
    return { ok: true, text: stated };
  }
  const cell = cellOf ? cellOf(measure.unit.column) : undefined;
  if (cell === undefined) return { ok: false, reason: `the unit field ${measure.unit.column} was not read` };
  if (cell === null || cell.trim() === "") return { ok: false, reason: `the unit field ${measure.unit.column} is empty in this record` };
  return { ok: true, text: cell };
}

/** The field matches of an address (none for a whole snapshot). */
export function addressMatches(address: SeriesAddress): readonly FieldMatch[] {
  return "where" in address && address.where ? address.where : [];
}

/** Field labels an address fixes, for checks before a read is sent. */
export function addressFields(address: SeriesAddress): string[] {
  return addressMatches(address).map((m) => m.field);
}

/** The cadence of a profile's periods: stated, or implied by the period format. */
export function cadenceOf(profile: Pick<Profile, "cadence" | "period">): Cadence {
  if (profile.cadence) return profile.cadence;
  const format = profile.period.format;
  if (format === "yyyymm" || format === "yyyy-mm" || format === "roc-yyymm") return "month";
  if (format === "quarter") return "quarter";
  if (format === "year") return "year";
  return "day";
}

/**
 * Why an address may not be drawn under a profile, or null when it may: it must fix every field value the
 * profile's unit depends on.
 */
export function addressRefusal(profile: Pick<Profile, "fixed" | "family">, address: SeriesAddress): string | null {
  const matches = addressMatches(address);
  for (const need of profile.fixed ?? []) {
    if (!matches.some((m) => m.field === need.field && m.value === need.value))
      return `The ${profile.family} profile states its unit only for series with ${need.field} "${need.value}".`;
  }
  return null;
}

/** True when two addresses pick the same series. */
export function sameAddress(a: SeriesAddress, b: SeriesAddress): boolean {
  const key = (x: SeriesAddress) =>
    JSON.stringify({
      whole: "whole" in x,
      by: "by" in x ? x.by : null,
      key: "by" in x ? x.key : null,
      where: [...addressMatches(x)].map((m) => [m.field, m.value]).sort((p, q) => (p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : 0)),
    });
  return key(a) === key(b);
}
