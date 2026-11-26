/**
 * Periods of official records, parsed only by a declared or unanimously detected format.
 *
 * A period cell is the publisher's string ("20260630", "2026-10", "2026Q2", "11510"). It gets
 * a place on a time axis only when a profile declares its format, or when every sample of the
 * snapshot's declared period field fits one format. Anything else stays a category axis in the
 * order the caller gives it. Nothing here guesses a cadence or fills a gap.
 */

export type PeriodFormat =
  | "iso-date"
  | "yyyymmdd"
  | "yyyy-mm"
  | "yyyymm"
  | "quarter"
  | "year"
  | "roc-yyymm"
  | "text";

export type ParsedPeriod = {
  /** First and last day covered, as ISO dates. */
  start: string;
  end: string;
  /** As a reader says it: "Nov 12, 2026", "Oct 2026", "Q3 2026", "2026". */
  label: string;
  /** Days from 1 Jan 1970 to `start`. Sorts periods of one format. */
  order: number;
  /** Set where the label is a conversion the reader should be able to see (the Taiwan calendar). */
  title?: string;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86_400_000;
const two = (n: number) => String(n).padStart(2, "0");
const iso = (year: number, month: number, day: number) =>
  `${String(year).padStart(4, "0")}-${two(month)}-${two(day)}`;
const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const order = (year: number, month: number, day: number) =>
  Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
const validYear = (year: number) => year >= 1000 && year <= 9999;
const validMonth = (month: number) => month >= 1 && month <= 12;

function day(year: number, month: number, date: number): ParsedPeriod | null {
  if (!validYear(year) || !validMonth(month) || date < 1 || date > daysIn(year, month)) return null;
  const text = iso(year, month, date);
  return {
    start: text,
    end: text,
    label: `${MONTHS[month - 1]} ${date}, ${year}`,
    order: order(year, month, date),
  };
}

function month(year: number, m: number): ParsedPeriod | null {
  if (!validYear(year) || !validMonth(m)) return null;
  return {
    start: iso(year, m, 1),
    end: iso(year, m, daysIn(year, m)),
    label: `${MONTHS[m - 1]} ${year}`,
    order: order(year, m, 1),
  };
}

/** Republic of China calendar years count from 1912: ROC year + 1911 is the Gregorian year. */
const ROC_OFFSET = 1911;

/**
 * One period under one format. Null when the text does not fit the format exactly: no
 * trimming, no second format tried, no impossible calendar date accepted.
 */
export function parsePeriod(text: string, format: PeriodFormat): ParsedPeriod | null {
  if (typeof text !== "string") return null;
  let m: RegExpExecArray | null;
  switch (format) {
    case "iso-date":
      m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
      return m ? day(Number(m[1]), Number(m[2]), Number(m[3])) : null;
    case "yyyymmdd":
      m = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
      return m ? day(Number(m[1]), Number(m[2]), Number(m[3])) : null;
    case "yyyy-mm":
      m = /^(\d{4})-(\d{2})$/.exec(text);
      return m ? month(Number(m[1]), Number(m[2])) : null;
    case "yyyymm":
      m = /^(\d{4})(\d{2})$/.exec(text);
      return m ? month(Number(m[1]), Number(m[2])) : null;
    case "quarter": {
      // "2026Q2" (BEA, FDIC derived tables), "2026-Q2" and "2026 Q2" (EIA), "2026:Q2" (Federal Reserve Board
      // release files such as Z.1 and the DDP packages).
      m = /^(\d{4})[-: ]?[Qq]([1-4])$/.exec(text);
      if (!m) return null;
      const year = Number(m[1]);
      const quarter = Number(m[2]);
      if (!validYear(year)) return null;
      const first = quarter * 3 - 2;
      return {
        start: iso(year, first, 1),
        end: iso(year, first + 2, daysIn(year, first + 2)),
        label: `Q${quarter} ${year}`,
        order: order(year, first, 1),
      };
    }
    case "year": {
      m = /^(\d{4})$/.exec(text);
      if (!m) return null;
      const year = Number(m[1]);
      if (!validYear(year)) return null;
      return { start: iso(year, 1, 1), end: iso(year, 12, 31), label: String(year), order: order(year, 1, 1) };
    }
    case "roc-yyymm": {
      m = /^(\d{2,3})(\d{2})$/.exec(text);
      if (!m) return null;
      const roc = Number(m[1]);
      const parsed = roc >= 1 ? month(roc + ROC_OFFSET, Number(m[2])) : null;
      if (!parsed) return null;
      return {
        ...parsed,
        title: `${text} in the source: Republic of China year ${roc} plus ${ROC_OFFSET} is ${roc + ROC_OFFSET}, month ${m[2]}`,
      };
    }
    default:
      return null;
  }
}

/**
 * Formats whose shape cannot be mistaken for another one. "roc-yyymm" is never detected (five
 * digits could be a ZIP code): it has to be declared.
 */
const DETECTABLE: readonly PeriodFormat[] = [
  "iso-date",
  "yyyymmdd",
  "yyyy-mm",
  "yyyymm",
  "quarter",
  "year",
];
/** A detected format must also fall in this window, so 99991231 or a column of four-digit codes stays text. */
const DETECT_FROM = "1500-01-01";
const DETECT_TO = "2200-12-31";

/**
 * One format only if every non-null sample fits it and none is empty; otherwise "text".
 * Pass samples of the field the snapshot declares as its period, not of an arbitrary field.
 */
export function detectPeriodFormat(samples: readonly (string | null | undefined)[]): PeriodFormat {
  const present = samples.filter((sample): sample is string => sample != null);
  if (!present.length) return "text";
  for (const format of DETECTABLE) {
    if (
      present.every((sample) => {
        const parsed = parsePeriod(sample, format);
        return parsed !== null && parsed.start >= DETECT_FROM && parsed.end <= DETECT_TO;
      })
    )
      return format;
  }
  return "text";
}

/**
 * A period for a cell, a tick or a headline: the reader's label where the format parses the
 * text, the stored text otherwise, an en dash for a missing value. The title carries the
 * stored text whenever the label differs from it, so the source string stays one hover away.
 */
export function formatPeriod(
  text: string | null | undefined,
  format: PeriodFormat,
): { text: string; title?: string } {
  if (text == null) return { text: "–", title: "missing in the source" };
  const parsed = parsePeriod(text, format);
  if (!parsed) return { text };
  if (parsed.title) return { text: parsed.label, title: parsed.title };
  return parsed.label === text ? { text } : { text: parsed.label, title: text };
}

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Ascending order for a sort. Periods that parse come first, oldest to newest; text that does
 * not parse follows in code-point order (never locale order, so every reader sees one order);
 * null is last. With format "text" everything is compared as text.
 */
export function comparePeriods(a: string | null | undefined, b: string | null | undefined, format: PeriodFormat): number {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  const pa = parsePeriod(a, format);
  const pb = parsePeriod(b, format);
  if (pa && pb) return pa.order - pb.order || byText(a, b);
  if (pa || pb) return pa ? -1 : 1;
  return byText(a, b);
}
