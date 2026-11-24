/**
 * Names on the supply page's cards and chain boxes: the short display name of a covered company, and a cut that only ever
 * falls between words. Widths are estimated from a per-character table for the app's sans (Geist), slightly on the wide
 * side, so a name the estimate says fits is not cut by the browser either; the same numbers run on the server and in the
 * browser, so the first render and hydration agree.
 */
import { coverageOf } from "@/lib/coverage";
import { boxName } from "./chain-layout";

/** Advance of a character in em, for Geist at weight 500, rounded up. */
function charEm(ch: string): number {
  if (ch === " ") return 0.28;
  if ("iljI.,:;'|!".includes(ch)) return 0.28;
  if ("frt()[]-/".includes(ch)) return 0.38;
  if ("mwMW".includes(ch)) return 0.86;
  if (ch >= "A" && ch <= "Z") return 0.7;
  if (ch >= "0" && ch <= "9") return 0.6;
  if (ch === "&" || ch === "@") return 0.72;
  return 0.57;
}

/** Headroom over the table: Inter, the fallback when Geist has not loaded, sets these names up to 9% wider (measured). */
const FALLBACK_HEADROOM = 1.1;
/** Estimated width in px of `text` at `px` font size. */
export function textWidth(text: string, px: number): number {
  let em = 0;
  for (const ch of text) em += charEm(ch);
  return em * px * FALLBACK_HEADROOM;
}

/** The name a card or box shows: a covered company's short name from the coverage list, else the filing's name without its legal tail. */
export function displayName(name: string, ticker?: string | null): string {
  const short = ticker ? coverageOf(ticker)?.shortName : undefined;
  return boxName(name, short);
}

export interface Fitted {
  /** the lines to show; the last ends with "…" when the name was cut */
  lines: string[];
  /** the name did not fit whole */
  cut: boolean;
  /** a single word is wider than a line on its own: it cannot be shown whole at this size */
  wordTooLong: boolean;
}

/**
 * Wrap `text` into at most `maxLines` lines of `width` px at `px` font size, breaking only between words. A name that does
 * not fit ends at the last whole word that leaves room for "…". A word wider than a whole line is the one case a cut
 * cannot fall between words: it is reported (`wordTooLong`) so the caller can set it smaller, and if it is still shown it
 * is cut with "…" at the end of the line.
 */
export function fitLines(text: string, width: number, maxLines: number, px: number): Fitted {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const fits = (s: string) => textWidth(s, px) <= width;
  const wordTooLong = words.some((w) => !fits(w));
  const lines: string[] = [];
  let i = 0;
  /* wrap between words; a word too wide for a line of its own ends the name there */
  while (i < words.length && lines.length < maxLines && fits(words[i])) {
    let line = words[i];
    i++;
    while (i < words.length && fits(`${line} ${words[i]}`)) { line = `${line} ${words[i]}`; i++; }
    lines.push(line);
  }
  if (i >= words.length) return { lines, cut: false, wordTooLong };
  if (!lines.length) {
    /* the first word alone is wider than the line: the only cut inside a word, at the last letter that leaves room for "…" */
    let end = words[0];
    while (end.length > 1 && !fits(`${end}…`)) end = end.slice(0, -1);
    return { lines: [`${end}…`], cut: true, wordTooLong };
  }
  /* cut: end the last line at a whole word with room for the ellipsis */
  for (;;) {
    const last = lines.length - 1, parts = lines[last].split(" ");
    while (parts.length > 1 && !fits(`${parts.join(" ")}…`)) parts.pop();
    if (fits(`${parts.join(" ")}…`) || last === 0) { lines[last] = `${parts.join(" ")}…`; break; }
    /* one word with no room for the ellipsis: the line goes and the one above ends the name */
    lines.pop();
  }
  return { lines, cut: true, wordTooLong };
}

/** Font sizes a chain box tries for a name on more than one line, largest first, so a long single word ("NBCUniversal", "Semiconductor") is set smaller rather than broken or dropped. */
export const BOX_SIZES = [11, 10, 9] as const;
/** Chain box text room: the box less its padding (4 + 4), the 20 px logo and its 4 px gap, the border, and the lock mark with its gap when shown. */
export const boxTextWidth = (w: number, lock: boolean) => w - 34 - (lock ? 16 : 0);

export interface BoxName { lines: string[]; px: number; /** the ticker line fits under the name */ ticker: boolean; cut: boolean }
/**
 * What a chain box shows: the name on one 12 px line with the ticker under it when it fits so; otherwise the name on up to
 * three lines (11 px, else 10 px for a long single word) and the ticker left to the logo, the title and the spoken label.
 */
export function boxLabel(name: string, ticker: string | null | undefined, width: number): BoxName {
  if (ticker) {
    const one = fitLines(name, width, 1, 12);
    if (!one.cut) return { lines: one.lines, px: 12, ticker: true, cut: false };
  }
  const f = fitBox(name, width, 3);
  /* a name whose first word cannot be shown whole at any size is replaced by its ticker rather than broken inside a word */
  if (ticker && f.cut && f.lines.length === 1 && !f.lines[0].slice(0, -1).includes(" ") && !name.startsWith(f.lines[0].slice(0, -1) + " ") && f.lines[0].slice(0, -1) !== name.split(/\s+/)[0]) return { lines: [ticker], px: 12, ticker: false, cut: true };
  /* a cut that keeps only the first word of a longer name ("Taiwan…" for Taiwan Semiconductor Manufacturing) says less than
     the ticker does: the box shows the ticker, and the title and the spoken label keep the whole name */
  if (ticker && f.cut) {
    const kept = f.lines.join(" ").replace(/…$/, "").trim().split(/\s+/).filter(Boolean).length;
    if (kept <= 1 && name.trim().split(/\s+/).length >= 2)
      return { lines: [ticker], px: 12, ticker: false, cut: true };
  }
  return { lines: f.lines, px: f.px, ticker: false, cut: f.cut };
}

/** The largest size from `sizes` at which no word of `text` is wider than a line, with the fitted lines at that size. */
export function fitBox(text: string, width: number, maxLines: number, sizes: readonly number[] = BOX_SIZES): Fitted & { px: number } {
  for (const px of sizes) {
    const f = fitLines(text, width, maxLines, px);
    if (!f.wordTooLong) return { ...f, px };
  }
  const px = sizes[sizes.length - 1];
  return { ...fitLines(text, width, maxLines, px), px };
}
