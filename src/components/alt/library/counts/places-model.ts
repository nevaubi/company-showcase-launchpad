/**
 * Records by place, pure: facet counts of the place dimension (its code, else its name), and whether they are US
 * states. The rule is the app's one rule for states (`stateKeyKind`, `src/lib/sources/geo/us-states.ts`): every
 * distinct key that is not a national total names a state, DC or territory under one reading (postal code, two-digit
 * FIPS code or name), at least 10 do, and no two name the same place. A dimension that fails it is drawn as ranked
 * places, never as a map. The facet label (the place name on the first record of a code) is tried when the stored
 * codes are not states themselves.
 */
import { isNationalKey, placeByKey, stateKeyKind, type StateKeyKind, type UsPlace } from "@/lib/sources/geo/us-states";
import type { MapPlace } from "@/lib/sources/boards/types";
import type { SourceFacetValue } from "@/lib/sources/read-types";

export type StateCount = { place: UsPlace; value: string; rows: number; exact: boolean };
export type PlaceCount = { value: string; label: string; rows: number; exact: boolean };
export type StateReading = {
  /** How the stored keys name the states. */
  kind: StateKeyKind;
  /** Whether the stored values or their facet labels are the keys. */
  by: "value" | "label";
  states: StateCount[];
  /** Keys that name the whole country (left aside by the rule, counted in the caption). */
  national: PlaceCount[];
};

const labelOf = (v: SourceFacetValue) => (v.label && v.label !== v.value ? v.label : v.value);
const order = (a: { rows: number; value: string }, b: { rows: number; value: string }) =>
  b.rows - a.rows || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0);

/** The states of a complete list of place values, or null when the rule does not read them as states. */
export function readStates(values: readonly SourceFacetValue[]): StateReading | null {
  const present = values.filter((v) => v.value !== "");
  if (!present.length) return null;
  const tryKeys = (by: "value" | "label"): StateReading | null => {
    const keyOf = (v: SourceFacetValue) => (by === "value" ? v.value : (v.label ?? ""));
    if (by === "label" && present.some((v) => !v.label)) return null;
    const kind = stateKeyKind(present.map(keyOf));
    if (!kind) return null;
    const states: StateCount[] = [];
    const national: PlaceCount[] = [];
    for (const v of present) {
      const key = keyOf(v);
      if (isNationalKey(key)) {
        national.push({ value: v.value, label: labelOf(v), rows: v.rows, exact: v.exact });
        continue;
      }
      const place = placeByKey(key, kind);
      if (!place) return null;
      states.push({ place, value: v.value, rows: v.rows, exact: v.exact });
    }
    states.sort((a, b) => b.rows - a.rows || (a.place.code < b.place.code ? -1 : 1));
    national.sort(order);
    return { kind, by, states, national };
  };
  return tryKeys("value") ?? tryKeys("label");
}

const n = (v: number) => v.toLocaleString("en-US");
const records = (rows: number, exact: boolean) => `${exact ? "" : "at least "}${n(rows)} ${rows === 1 ? "record" : "records"}`;

/** "12,391 records in 56 states and territories; most in Texas, 918." plus the national totals beside them. */
export function stateCaption(reading: StateReading): string {
  const total = reading.states.reduce((s, v) => s + v.rows, 0);
  const exact = reading.states.every((s) => s.exact);
  const top = reading.states[0];
  const where = reading.states.some((s) => s.place.kind === "territory") ? "states and territories" : reading.states.some((s) => s.place.kind === "district") ? "states and DC" : "states";
  let line = `${exact ? "" : "At least "}${n(total)} records in ${n(reading.states.length)} ${where}; most in ${top.place.name}, ${n(top.rows)}`;
  if (reading.national.length) {
    const rows = reading.national.reduce((s, v) => s + v.rows, 0);
    line += `. ${n(rows)} more ${rows === 1 ? "record is" : "records are"} national totals`;
  }
  return `${line}.`;
}

/** Counts as the grid's places: one per state, the stored value as the records filter. */
export function stateMapPlaces(reading: StateReading): MapPlace[] {
  return reading.states.map((s) => ({
    code: s.place.code,
    name: s.place.name,
    key: s.value,
    value: s.rows,
    display: s.exact ? n(s.rows) : `at least ${n(s.rows)}`,
    text: null,
    row: null,
    filter: { geography: s.value },
  }));
}

export type PlaceBar = { key: string; label: string; sub?: string; value: number; text: string; title: string };

/** Places by records, most first, at most `top`. The key is the stored value the records filter takes. */
export function placeBars(values: readonly SourceFacetValue[], top: number): PlaceBar[] {
  return [...values]
    .sort(order)
    .slice(0, top)
    .map((v) => {
      const label = v.value === "" ? "(empty)" : labelOf(v);
      return {
        key: v.value,
        label,
        sub: label !== v.value && v.value !== "" ? v.value : undefined,
        value: v.rows,
        text: v.exact ? n(v.rows) : `${n(v.rows)} or more`,
        title: `${label}: ${records(v.rows, v.exact)}. Opens its records.`,
      };
    });
}

/** State counts as ranked bars, for the table view. */
export function stateBars(reading: StateReading): PlaceBar[] {
  return reading.states.map((s) => ({
    key: s.value,
    label: s.place.name,
    sub: s.value !== s.place.name ? s.value : undefined,
    value: s.rows,
    text: s.exact ? n(s.rows) : `${n(s.rows)} or more`,
    title: `${s.place.name}: ${records(s.rows, s.exact)}. Opens its records.`,
  }));
}
