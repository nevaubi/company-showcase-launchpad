/**
 * Reading a stored cell as a number, with the right to refuse.
 *
 * A cell of an official record is the publisher's own string. This module is the only place
 * that turns one into a number, and it does so only for a plain decimal. It never rescales,
 * never strips a symbol, never reads "(1,234)" as a negative and never reads a blank as zero.
 * Whether a field may be read at all is decided elsewhere (`fields.ts`, a profile): calling
 * this on a certificate number returns a number, so ask `fieldRole` first.
 */

export type NativeReading =
  /** `text` is the cell as stored; `decimals` is the count of decimal places it states. */
  | { kind: "number"; value: number; text: string; decimals: number }
  /** The importer met a value the source declares as missing (`ingest.null_values`). */
  | { kind: "null" }
  /** The cell is the empty string. Not a zero and not a missing-value mark. */
  | { kind: "empty" }
  /** A disclosure marker the caller declared, such as "NM" or "W". */
  | { kind: "marker"; text: string }
  /** Anything else, exactly as stored. */
  | { kind: "text"; text: string };

export type ReadNativeOptions = {
  /** Exact strings that are disclosure markers in this field. They win over a numeric reading. */
  markers?: readonly string[];
  /** "," also accepts "1,234,567.8" with complete groups of three. Default "none". */
  grouping?: "," | "none";
};

/** Optional sign, digits, optional fraction, optional exponent. ASCII digits only. */
const PLAIN = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/;
/**
 * The same without an exponent, the integer part written in complete groups of three. The
 * first group never starts with 0: "0,123" is a decimal comma somewhere, not 123.
 */
const GROUPED = /^([+-]?)([1-9]\d{0,2}(?:,\d{3})+)(?:\.(\d+))?$/;

/**
 * One stored cell. A number only for a plain decimal, so a chart can place it; `text` keeps
 * the stored string, because a double holds about 15 significant digits and the cell may
 * hold more. A cell whose digits are not all zero but whose value is not representable
 * ("1e999", "1e-999") is text: neither infinity nor zero is what it says.
 */
export function readNative(
  cell: string | null | undefined,
  options?: ReadNativeOptions,
): NativeReading {
  if (cell == null) return { kind: "null" };
  if (cell === "") return { kind: "empty" };
  if (options?.markers?.includes(cell)) return { kind: "marker", text: cell };
  let match = PLAIN.exec(cell);
  let plain = cell;
  if (!match && options?.grouping === ",") {
    match = GROUPED.exec(cell);
    if (match) plain = cell.replace(/,/g, "");
  }
  if (!match) return { kind: "text", text: cell };
  const value = Number(plain);
  if (!Number.isFinite(value)) return { kind: "text", text: cell };
  if (value === 0 && /[1-9]/.test(`${match[2]}${match[3] ?? ""}`)) return { kind: "text", text: cell };
  const fraction = match[3]?.length ?? 0;
  const exponent = match[4] === undefined ? 0 : Number(match[4]);
  return {
    kind: "number",
    value: value === 0 ? 0 : value,
    text: cell,
    decimals: Math.max(0, fraction - exponent),
  };
}

export type ReadingSummary = {
  numbers: number;
  nulls: number;
  empties: number;
  markers: number;
  texts: number;
  /** Distinct stored strings that were not read as numbers, in order of first appearance. */
  examples: string[];
};

/** What a run of cells holds, so a chart can say how many it could not draw and name them. */
export function summarizeReadings(
  cells: readonly (string | null | undefined)[],
  options?: ReadNativeOptions & { maxExamples?: number },
): ReadingSummary {
  const limit = options?.maxExamples ?? 5;
  const summary: ReadingSummary = {
    numbers: 0,
    nulls: 0,
    empties: 0,
    markers: 0,
    texts: 0,
    examples: [],
  };
  const seen = new Set<string>();
  for (const cell of cells) {
    const reading = readNative(cell, options);
    if (reading.kind === "number") summary.numbers++;
    else if (reading.kind === "null") summary.nulls++;
    else if (reading.kind === "empty") summary.empties++;
    else {
      if (reading.kind === "marker") summary.markers++;
      else summary.texts++;
      if (!seen.has(reading.text)) {
        seen.add(reading.text);
        if (summary.examples.length < limit) summary.examples.push(reading.text);
      }
    }
  }
  return summary;
}

/**
 * The stored digits with thousands separators and a true minus sign. No float round trip, so
 * every stored decimal survives. Null when grouping would change what the cell says: exponent
 * notation, a zero-padded integer part, or anything that is not a plain decimal.
 */
export function groupNative(cell: string): string | null {
  const match = PLAIN.exec(cell);
  if (!match || match[4] !== undefined) return null;
  const [, sign, integer, fraction] = match;
  if (integer.length > 1 && integer.startsWith("0")) return null;
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign === "-" ? "−" : sign}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

/**
 * The markers the importer counted in a snapshot's cells (`quality.source_lexical_marker_counts`,
 * on 956 of 1,056 live snapshots): "NA", "NM", "W", ".", "N/A", "--", "-", "*". They are the
 * publisher's own strings for a withheld or missing value, so a chart counts them as gaps
 * instead of reading them as text. Counted per snapshot, not per field.
 */
export function snapshotMarkers(quality: Record<string, unknown> | null | undefined): string[] {
  const counts = quality?.source_lexical_marker_counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return [];
  return Object.keys(counts).filter((marker) => marker !== "");
}
