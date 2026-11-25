/**
 * Rules that tidy a stored dataset name without adding anything to it. Each one removes a mark the
 * kit's file naming left behind, or a dash the product's typography does not use:
 *
 * 1. Underscores become spaces.
 * 2. A long dash between two words with no space around it is a range and becomes " to "
 *    (a year range written 2020, en dash, 2025 reads "2020 to 2025"); a dash set off by spaces is a
 *    separator and becomes a comma. This covers the figure dash, the en dash, the em dash and the
 *    horizontal bar (U+2012 to U+2015).
 * 3. A leading "CSV " and a trailing " FULL" or " full" are the kit's file markers and go.
 * 4. A word repeated straight after itself, whatever its capitals, is kept once
 *    ("DS140 ds140 copper" becomes "DS140 copper").
 * 5. Runs of spaces close up, and a comma or colon left hanging at the end goes.
 */

const DASH = "\u2012\u2013\u2014\u2015";
const RANGE = new RegExp(`(\\S)[${DASH}](\\S)`, "g");
const SEPARATOR = new RegExp(`\\s+[${DASH}]\\s+`, "g");
const ANY_DASH = new RegExp(`[${DASH}]`, "g");

/** Rule 2 alone, for any text that must not carry an em dash. */
export function withoutLongDashes(text: string): string {
  return text.replace(SEPARATOR, ", ").replace(RANGE, "$1 to $2").replace(ANY_DASH, "-");
}

export function cleanName(name: string): string {
  let text = withoutLongDashes((name ?? "").replace(/_/g, " "));
  text = text
    .replace(/^CSV\s+/, "")
    .replace(/\s+(FULL|full)$/, "")
    .replace(/[\s,;:]+$/, "");
  const words = text.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const word of words) {
    const last = kept[kept.length - 1];
    if (last !== undefined && last.toLowerCase() === word.toLowerCase()) continue;
    kept.push(word);
  }
  return kept.join(" ");
}

/**
 * A name that is still only a code or a file stem: one token of capitals and digits ("UNRATE",
 * "FS220"), words with no capital at all ("aircraft assets"), or a short run of file tokens
 * ("S1282 1 t", "MER T01.01"). Such a title is counted as untitled until a listing supplies one.
 */
export function isBareName(title: string): boolean {
  const text = (title ?? "").trim();
  if (!text) return true;
  if (/^[A-Z0-9.-]+$/.test(text)) return true;
  if (text === text.toLowerCase()) return true;
  if (/^[A-Z][0-9A-Za-z]*( [0-9a-z]{1,3})+$/.test(text)) return true;
  if (/^MER T[0-9A-Z.]+$/.test(text)) return true;
  return false;
}

/** "T01.01" to "1.1", "T07.02A" to "7.2a", "TA1" to "A1": the number EIA prints on the table. */
export function merTableNumber(code: string): string | null {
  const numbered = /^T(\d{2})\.(\d{2})([A-Z]?)$/.exec(code);
  if (numbered) return `${Number(numbered[1])}.${Number(numbered[2])}${numbered[3].toLowerCase()}`;
  const appendix = /^T([A-Z])(\d+)$/.exec(code);
  if (appendix) return `${appendix[1]}${appendix[2]}`;
  return null;
}

/** The publisher's own code where the stored name or `source_id` states it outright. */
export function codeByRule(name: string, sourceId: string | null): string | undefined {
  const text = (name ?? "").trim();
  if (sourceId && sourceId.startsWith("FRED_") && sourceId.slice(5) === text) return text;
  const mer = /^MER (T[0-9A-Z.]+)$/.exec(text);
  if (mer) {
    const number = merTableNumber(mer[1]);
    if (number) return `MER ${number}`;
  }
  return undefined;
}
