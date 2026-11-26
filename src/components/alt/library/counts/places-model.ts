/**
 * Records by place, pure: facet counts of the place dimension (its code, else its name), and whether they are US
 * states. A place field holds states only when the stored values say so plainly: at least 10 distinct values are
 * state or territory postal codes or names, they are at least 90% of the distinct values, and no two stored values
 * name the same state. FIPS numbers are never read as states (two digits are too many other things). The state
 * table itself is passed in (`StateLookup`), so this rule does not depend on how the table is kept.
 */
import type { SourceFacetValue } from "@/lib/sources/read-types";

export type StateMatch = { code: string; name: string };
/** The state or territory a stored value names (a postal code or a name), or null. */
export type StateLookup = (value: string) => StateMatch | null;

export const STATE_RULE = {
  /** Distinct values that are states, at least. */
  minStates: 10,
  /** Share of the distinct values that are states, at least. */
  minShare: 0.9,
} as const;

export type StateCount = StateMatch & { value: string; rows: number; exact: boolean };
export type PlaceCount = { value: string; label: string; rows: number; exact: boolean };
export type StateReading = { states: StateCount[]; others: PlaceCount[] };

const labelOf = (v: SourceFacetValue) => (v.label && v.label !== v.value ? v.label : v.value);

/** The states of a complete list of place values, or null when the values are not states by the rule. */
export function readStates(values: readonly SourceFacetValue[], lookup: StateLookup): StateReading | null {
  const present = values.filter((v) => v.value !== "");
  if (!present.length) return null;
  const states: StateCount[] = [];
  const others: PlaceCount[] = [];
  const codes = new Set<string>();
  for (const v of present) {
    const hit = lookup(v.value) ?? (v.label ? lookup(v.label) : null);
    if (!hit) {
      others.push({ value: v.value, label: labelOf(v), rows: v.rows, exact: v.exact });
      continue;
    }
    if (codes.has(hit.code)) return null;
    codes.add(hit.code);
    states.push({ ...hit, value: v.value, rows: v.rows, exact: v.exact });
  }
  if (states.length < STATE_RULE.minStates || states.length < present.length * STATE_RULE.minShare) return null;
  states.sort((a, b) => b.rows - a.rows || (a.code < b.code ? -1 : 1));
  others.sort((a, b) => b.rows - a.rows || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
  return { states, others };
}

const n = (v: number) => v.toLocaleString("en-US");
const records = (rows: number, exact: boolean) => `${exact ? "" : "at least "}${n(rows)} ${rows === 1 ? "record" : "records"}`;

/** "12,391 records in 56 states and territories; most in Texas, 918." plus the places that are not states. */
export function stateCaption(reading: StateReading): string {
  const total = reading.states.reduce((s, v) => s + v.rows, 0);
  const exact = reading.states.every((s) => s.exact);
  const top = reading.states[0];
  let line = `${exact ? "" : "At least "}${n(total)} records in ${n(reading.states.length)} states and territories; most in ${top.name}, ${n(top.rows)}`;
  if (reading.others.length) {
    const rows = reading.others.reduce((s, v) => s + v.rows, 0);
    line += `. ${n(reading.others.length)} other ${reading.others.length === 1 ? "place holds" : "places hold"} ${n(rows)} ${rows === 1 ? "record" : "records"}`;
  }
  return `${line}.`;
}

export type PlaceBar = { key: string; label: string; sub?: string; value: number; text: string; title: string };

/** Places by records, most first, at most `top`. The key is the stored value the records filter takes. */
export function placeBars(values: readonly SourceFacetValue[], top: number): PlaceBar[] {
  return [...values]
    .sort((a, b) => b.rows - a.rows || (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
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

/** State counts as bars, for the ranked list the grid falls back to and for the table view. */
export function stateBars(reading: StateReading): PlaceBar[] {
  return reading.states.map((s) => ({
    key: s.value,
    label: s.name,
    sub: s.value !== s.name ? s.value : undefined,
    value: s.rows,
    text: s.exact ? n(s.rows) : `${n(s.rows)} or more`,
    title: `${s.name}: ${records(s.rows, s.exact)}. Opens its records.`,
  }));
}
