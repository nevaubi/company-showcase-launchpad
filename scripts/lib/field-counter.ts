/**
 * Counts of the values of every field of one published snapshot, fed its records in file order (the worker's field
 * counts step, migration 0070). Pure: no Node or browser API. The cells are the stored strings exactly as the importer
 * projects them (`projectSourceRow`): a declared null marker is null, an empty cell is '', and nothing is trimmed,
 * folded or parsed, so the counts are those of `source_records.values` for the same snapshot.
 *
 * Per field: the records with a value, with an empty string and with a null, and the records whose value reads as a
 * plain number (`readNative`, as the app's `countFields` decides it). While a field holds at most `cap` (1,000) distinct
 * values its counts are exact: the distinct count and the most common values (at most 50, most first, ties in the
 * app's string order) with their record counts and the first record holding each. Past the cap the field is capped
 * "values": its value list is dropped and only the record counts stay.
 *
 * Memory is bounded for the whole snapshot too: at most `heldValues` distinct values and `heldChars` characters are
 * held over all fields together. When a new value would pass either bound, the field holding the most of that bound
 * is dropped first (capped "memory"; the lower position on a tie), so a wide table of long texts cannot exhaust the
 * worker. The outcome depends only on the file, so a second count of the same snapshot writes the same rows.
 */
import { readNative } from "../../src/lib/sources/numbers";

/** Distinct values a field is counted exactly for. */
export const FIELD_VALUE_CAP = 1000;
/** Values a row's list keeps at most. */
export const FIELD_TOP_VALUES = 50;
/** Characters of value text a row's list keeps at most; a list that would hold more ends sooner (the rest is "other"). */
export const FIELD_TOP_CHARS = 65_536;
/** Distinct values held over all fields of a snapshot at once. */
export const HELD_VALUES_MAX = 400_000;
/** Characters of distinct values held over all fields of a snapshot at once. */
export const HELD_CHARS_MAX = 16 * 1024 * 1024;

export type FieldCapped = "values" | "memory";

/** One row of `source_field_counts` as the worker writes it. */
export type FieldCountRow = {
  snapshot_id: string;
  position: number;
  filled: number;
  blank: number;
  missing: number;
  numeric_rows: number;
  value_cap: number;
  /** Null when the field is capped. */
  distinct_values: number | null;
  capped: FieldCapped | null;
  /** `[value, records, first record]`, most records first. */
  top: [string, number, number][];
  /** Filled records not in `top`. */
  other_rows: number;
  /** Distinct values not in `top`; null when the field is capped. */
  other_values: number | null;
};

export type FieldCounterOptions = { cap?: number; top?: number; topChars?: number; heldValues?: number; heldChars?: number };

const isNumber = (value: string) => readNative(value).kind === "number";
/** The order of `countFields` in the app: most records first, then the value by `<`. */
const byCount = (a: [string, number, number], b: [string, number, number]) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

export class FieldCounter {
  readonly width: number;
  /** Records added. */
  records = 0;
  private readonly cap: number;
  private readonly topMax: number;
  private readonly topChars: number;
  private readonly heldValuesMax: number;
  private readonly heldCharsMax: number;
  /** Per field: value to slot, null once the field is capped. */
  private readonly maps: (Map<string, number> | null)[];
  /** Per field and slot: records, first record, 1 when the value reads as a number. */
  private readonly counts: number[][];
  private readonly firsts: number[][];
  private readonly numerics: number[][];
  private readonly filled: Float64Array;
  private readonly blank: Float64Array;
  private readonly missing: Float64Array;
  private readonly numericRows: Float64Array;
  private readonly chars: Float64Array;
  private readonly capped: (FieldCapped | null)[];
  private heldValues = 0;
  private heldChars = 0;
  private last = 0;

  constructor(width: number, options: FieldCounterOptions = {}) {
    if (!Number.isSafeInteger(width) || width < 1 || width > 16384) throw new Error(`A snapshot has 1 to 16,384 fields, not ${width}`);
    this.width = width;
    this.cap = options.cap ?? FIELD_VALUE_CAP;
    this.topMax = options.top ?? FIELD_TOP_VALUES;
    this.topChars = options.topChars ?? FIELD_TOP_CHARS;
    this.heldValuesMax = options.heldValues ?? HELD_VALUES_MAX;
    this.heldCharsMax = options.heldChars ?? HELD_CHARS_MAX;
    this.maps = Array.from({ length: width }, () => new Map<string, number>());
    this.counts = Array.from({ length: width }, () => []);
    this.firsts = Array.from({ length: width }, () => []);
    this.numerics = Array.from({ length: width }, () => []);
    this.filled = new Float64Array(width);
    this.blank = new Float64Array(width);
    this.missing = new Float64Array(width);
    this.numericRows = new Float64Array(width);
    this.chars = new Float64Array(width);
    this.capped = Array.from({ length: width }, () => null);
  }

  /** What the counter holds now, over all fields: for tests and the run's account. */
  held(): { values: number; chars: number; capped: number } {
    return { values: this.heldValues, chars: this.heldChars, capped: this.capped.filter((c) => c !== null).length };
  }

  /** One record: `row` is its row number (rising, from 1), `values` its cells in field order. */
  add(row: number, values: readonly (string | null)[]): void {
    if (values.length !== this.width) throw new Error(`Record ${row} has ${values.length} cells, not ${this.width}`);
    if (!Number.isSafeInteger(row) || row <= this.last) throw new Error(`Record ${row} does not come after record ${this.last}`);
    this.last = row;
    this.records += 1;
    for (let i = 0; i < this.width; i++) {
      const value = values[i];
      if (value === null) {
        this.missing[i] += 1;
        continue;
      }
      if (value === "") {
        this.blank[i] += 1;
        continue;
      }
      this.filled[i] += 1;
      const map = this.maps[i];
      if (map === null) {
        if (isNumber(value)) this.numericRows[i] += 1;
        continue;
      }
      const slot = map.get(value);
      if (slot !== undefined) {
        this.counts[i][slot] += 1;
        this.numericRows[i] += this.numerics[i][slot];
        continue;
      }
      this.addValue(i, value, row);
    }
  }

  private addValue(i: number, value: string, row: number) {
    const numeric = isNumber(value) ? 1 : 0;
    this.numericRows[i] += numeric;
    const map = this.maps[i]!;
    if (map.size >= this.cap) {
      this.drop(i, "values");
      return;
    }
    // room within the snapshot's bounds: drop the field holding the most of the bound that would be passed
    while (this.heldValues + 1 > this.heldValuesMax || this.heldChars + value.length > this.heldCharsMax) {
      const victim = this.largest(this.heldValues + 1 > this.heldValuesMax ? "values" : "chars", i);
      this.drop(victim, "memory");
      if (victim === i) return;
    }
    map.set(value, map.size);
    this.counts[i].push(1);
    this.firsts[i].push(row);
    this.numerics[i].push(numeric);
    this.chars[i] += value.length;
    this.heldValues += 1;
    this.heldChars += value.length;
  }

  /** The uncapped field holding the most values or characters; `fallback` when none holds any. */
  private largest(by: "values" | "chars", fallback: number): number {
    let best = -1;
    let most = 0;
    for (let j = 0; j < this.width; j++) {
      const map = this.maps[j];
      if (map === null) continue;
      const held = by === "values" ? map.size : this.chars[j];
      if (held > most) {
        most = held;
        best = j;
      }
    }
    return best < 0 ? fallback : best;
  }

  private drop(i: number, reason: FieldCapped) {
    const map = this.maps[i];
    if (map === null) return;
    this.heldValues -= map.size;
    this.heldChars -= this.chars[i];
    this.maps[i] = null;
    this.counts[i] = [];
    this.firsts[i] = [];
    this.numerics[i] = [];
    this.chars[i] = 0;
    this.capped[i] = reason;
  }

  /** The rows of every field, in field order. */
  rows(snapshotId: string): FieldCountRow[] {
    const out: FieldCountRow[] = [];
    for (let i = 0; i < this.width; i++) {
      const base = {
        snapshot_id: snapshotId,
        position: i,
        filled: this.filled[i],
        blank: this.blank[i],
        missing: this.missing[i],
        numeric_rows: this.numericRows[i],
        value_cap: this.cap,
      };
      const map = this.maps[i];
      if (map === null) {
        out.push({ ...base, distinct_values: null, capped: this.capped[i], top: [], other_rows: this.filled[i], other_values: null });
        continue;
      }
      const all: [string, number, number][] = [];
      for (const [value, slot] of map) all.push([value, this.counts[i][slot], this.firsts[i][slot]]);
      all.sort(byCount);
      const top: [string, number, number][] = [];
      let chars = 0;
      let rows = 0;
      for (const entry of all) {
        if (top.length >= this.topMax || chars + entry[0].length > this.topChars) break;
        top.push(entry);
        chars += entry[0].length;
        rows += entry[1];
      }
      out.push({ ...base, distinct_values: all.length, capped: null, top, other_rows: this.filled[i] - rows, other_values: all.length - top.length });
    }
    return out;
  }
}
