// Pure: the printed title, scale line and row headings of each table of a stored document, so the IR tab
// can name a statement section as the company prints it ("CONSOLIDATED STATEMENTS OF INCOME", "(in
// millions, except per share data)") and lay its rows out with the document's own headings and spacer
// rows. Table and row indexes are the ones every fact locator uses (`parseTables` in tables.ts:
// document order, nested tables included).
import { decodeHtml, parseNumber, parseTables, type ParsedTable } from "@/lib/ir/tables";

export interface TableCaption {
  /** table index, as in locator.t */
  t: number;
  /** the printed title, verbatim (case as printed) */
  title?: string;
  /** the printed scale line, verbatim ("(in millions, except per share data)") */
  unit?: string;
  /** label rows with no figures (block headings such as "Noninterest revenue:"), by row index */
  heads?: [number, string][];
  /** empty rows between the first and last figure rows (the document's spacer bands) */
  blank?: number[];
}

const MONTH =
  /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
const PERIODISH =
  /\b(quarter|quarterly|months?|weeks?|year|years|ended|ending|trends|fy|ytd|change|vs\.?|actual|as of)\b|\b(19|20)\d{2}\b|\b[1-4]q\b|\bq[1-4]\b/i;
const SCALE =
  /\(?\s*(\$\s*)?(in|amounts in|dollars in|\$ in)\s+(millions|thousands|billions)\b[^)]*\)?/i;
const ENTITY =
  /\b(inc|corp|corporation|co|company|ltd|plc|llc|n\.a|holdings|group|incorporated)\.?\s*$/i;
/** The company's legal name over its statements: "TEXAS INSTRUMENTS INCORPORATED AND SUBSIDIARIES". */
const SUBSIDIARIES =
  /\b(inc|corp|corporation|co|company|incorporated|ltd|plc|llc|n\.v|s\.a|ag|se)\.?,?\s+(and|&)\s+(its\s+)?(consolidated\s+)?subsidiaries\s*$/i;
const NOISE = /^\(?(unaudited|continued|in \w+)\)?$/i;
/**
 * Stamps and tags printed near a table that name nothing: a status ("Preliminary", "Subject to
 * reclassification"), a table or exhibit number ("Table", "Table 1a", "Exhibit 99.1"), an export's own words
 * ("Document", "Category: PG-IR"), a footnote legend ("N/A Not applicable."). NextEra's statements read
 * "Preliminary", Merck's "Table", Costco's balance sheet "Subject to reclassification".
 */
const STAMP =
  /^\(?(preliminary|draft|subject to reclassification|document|table(\s+\d+[a-z]?)?|exhibit(\s+\d+(\.\d+)?)?|category\s*:.*|(n\/a|n\.?m\.?)\b.*)\)?\.?$/i;
/** The company's legal name printed in one cell with the title after it ("THE PROCTER & GAMBLE COMPANY AND SUBSIDIARIES Consolidated Balance Sheets"). */
const COMPANY_PREFIX =
  /^.{2,80}?\b(inc|corp|corporation|co|company|incorporated|ltd|plc|llc|n\.v|s\.a|ag|se)\.?,?\s+(and|&)\s+(its\s+)?(consolidated\s+)?subsidiaries\b[.,:]?\s+(?=\S)/i;
/** A parenthesised scale line inside a longer cell. */
const SCALE_GROUP = /\(\s*(\$\s*)?(in|amounts in|dollars in|\$ in)\s+(millions|thousands|billions)\b[^)]*\)/i;

/**
 * A title cell without the company's name before it and the scale line inside it: Procter & Gamble prints
 * "THE PROCTER & GAMBLE COMPANY AND SUBSIDIARIES (Amounts in Millions Except Per Share Amounts) Consolidated
 * Statements of Cash Flows" in one cell. The text as it is when it holds neither.
 */
export function titleCore(s: string): string {
  const rest = s.replace(COMPANY_PREFIX, "").replace(SCALE_GROUP, " ").replace(/\s+/g, " ").trim();
  return rest.length >= 4 ? rest : s;
}

const text = (s: string) =>
  decodeHtml(
    s
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|tr|li|h\d|br)\s*>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((l) => l.replace(/[\s\u00a0\u200b]+/g, " ").trim())
    .filter(Boolean);

/** A row's non-empty cells, with currency marks and footnote digits taken as empty. */
const filled = (r: string[]) => r.map((c) => c.trim()).filter((c) => c && !/^[$€£%)(]+$/.test(c));
const hasFigure = (r: string[]) =>
  r.slice(1).some((c) => parseNumber(c) != null && !/^(19|20)\d{2}$/.test(c.trim()));

/** Whether a line reads as a title: letters, not a sentence, not a period head, not the company's name. */
function titleLike(s: string, company?: string) {
  if (s.length < 4 || s.length > 140) return false;
  // Page footers and running heads ("Honeywell Q3'26 Results - 3", "Page 4").
  if (/\s[-–]\s*\d+$|^page \d+|\bpage \d+ of \d+|^[-–(]/i.test(s)) return false;
  if (
    company &&
    s.split(" ").length <= 3 &&
    s.toLowerCase().startsWith(company.toLowerCase().split(" ")[0])
  )
    return false;
  if (!/[a-z]{3,}/i.test(s)) return false;
  if (NOISE.test(s) || STAMP.test(s) || SCALE.test(s)) return false;
  // The tail of a sentence broken over two lines ("each segment.").
  if (/^[a-z]/.test(s) && /[.,;]$/.test(s)) return false;
  if (ENTITY.test(s) || SUBSIDIARIES.test(s)) return false;
  // A sentence introducing the table ("The following table summarizes our financial results ...").
  if (/^(the following|below|the table below|this table)\b/i.test(s) || /\b(summarizes|sets forth|presents|shows)\b/i.test(s)) return false;
  // A clause ending a paragraph ("Our summary results, and forecast for Q4, are below.") is running text.
  if (/[a-z][.!?]["”’']?\s*$/.test(s) && s.split(/\s+/).length >= 4) return false;
  // A headline of the release ("Announces establishment of new class C common stock") starts with its verb.
  if (/^(announces?|reports?|declares?|completes?|launches?|names?|appoints?|expands?|raises?|delivers?|achieves?)\b/i.test(s)) return false;
  // A bullet or a sentence carrying figures names a highlight, not the table.
  if (/^[•·▪◦‣*]/.test(s) || /\d\s*%|\$\s*\d/.test(s)) return false;
  if (/[.;]\s+\S/.test(s) && s.split(" ").length > 14) return false;
  // "Third Quarter 2026 GAAP and Non-GAAP Results" names a table; "Three months ended September 30, 2026" heads columns.
  const named =
    /\b(results|statements?|highlights|summary|reconciliations?|information|data|metrics)\b/i.test(s) &&
    !/\b(ended|ending|as of)\b/i.test(s);
  if (
    !named &&
    PERIODISH.test(s) &&
    // "Quarterly Financial Results" is a title; "Three months ended" and "Quarter ended" are period heads.
    (MONTH.test(s) || /\b(19|20)\d{2}\b/.test(s) || /\b(months?|quarters?|weeks?)\s+(ended|ending)\b|^(three|six|nine|twelve)\s+months\b|\b(trailing|last|next)\s+(\d+|twelve)\s+months\b/i.test(s))
  )
    return false;
  return true;
}

/** Index of the first row that holds a figure beside a label. */
function firstFigureRow(t: ParsedTable) {
  return t.rows.findIndex((r) => filled(r).length >= 2 && hasFigure(r));
}

/** Caption of one table: title and scale from the rows above its figures, else from the text just before it. */
function captionOf(t: ParsedTable, before: string[], company?: string): TableCaption {
  const out: TableCaption = { t: t.index };
  const first = firstFigureRow(t);
  // Title rows sit above the period heads; a label row under them ("Net sales:") is a heading, not a title.
  const top = first < 0 ? t.rows : t.rows.slice(0, first);
  // Period heads: a month, a year, "months ended", a quarter mark ("Q4", "4Q", Micron's "FQ4-26"); "quarterly"
  // only beside other heads, so a title row "Quarterly Financial Results" stays a title.
  const heads0 = top.findIndex((r) =>
    filled(r).some(
      (c) =>
        MONTH.test(c) ||
        /\b(19|20)\d{2}\b/.test(c) ||
        /months? ended|\bf?q[1-4]\b|\b[1-4]q\b|\b[1-4]q\d{2}\b/i.test(c) ||
        (filled(r).length > 1 && /quarterly/i.test(c)),
    ),
  );
  for (const r of heads0 < 0 ? top : top.slice(0, heads0)) {
    const f = filled(r);
    if (f.length !== 1) continue;
    const s = f[0];
    // The company's name and the scale line printed in the title's own cell are taken off it.
    const core = titleCore(s);
    const inFirst = r.findIndex((c) => c.trim()) <= 1;
    if (core !== s) {
      const scale = s.match(SCALE_GROUP)?.[0].trim();
      if (!out.unit && scale) out.unit = scale;
      if (!out.title && inFirst && titleLike(core, company)) out.title = core;
    } else if (!out.unit && SCALE.test(s)) out.unit = s.match(SCALE)![0].trim();
    // A title sits in the first columns (the label column, or the one after an empty spacer); a lone cell over the figure columns is a
    // column head (Citigroup's "3Q26 Increase/" over "(Decrease) from").
    else if (!out.title && inFirst && titleLike(s, company)) out.title = s;
  }
  // A title printed in the label cell of the period-heads row (Texas Instruments: "Consolidated Statements of
  // Income" beside "For Three Months Ended September 30,").
  if (!out.title && heads0 >= 0) {
    const c0 = top[heads0][0]?.trim() ?? "";
    if (c0 && !SCALE.test(c0) && titleLike(c0, company)) out.title = c0;
  }
  // A title printed in the label cell of the period-heads row (Texas Instruments: "Consolidated Statements of
  // Income" beside "For Three Months Ended September 30,").
  if (!out.title && heads0 >= 0) {
    const c0 = top[heads0][0]?.trim() ?? "";
    if (c0 && !SCALE.test(c0) && titleLike(c0, company)) out.title = c0;
  }
  // Text before the table: the nearest title-like line, and a scale line beside it.
  for (let i = before.length - 1, seen = 0; i >= 0 && seen < 6; i--, seen++) {
    const s = before[i];
    if (!out.unit && SCALE.test(s) && s.length < 160) out.unit = s.match(SCALE)![0].trim();
    if (!out.title && titleLike(s, company)) {
      out.title = s.replace(/\s*\((unaudited|continued)\)\s*/gi, " ").trim();
      break;
    }
  }
  if (out.title)
    out.title = out.title
      .replace(/\s*\(unaudited\)\s*/gi, " ")
      .replace(/:\s*$/, "")
      .trim();
  if (first < 0) return out;
  let last = first;
  t.rows.forEach((r, i) => {
    if (hasFigure(r)) last = i;
  });
  const heads: [number, string][] = [];
  const blank: number[] = [];
  for (let i = Math.max(0, first - 2); i <= last; i++) {
    const r = t.rows[i];
    const f = filled(r);
    if (!f.length) blank.push(i);
    else if (
      f.length === 1 &&
      !hasFigure(r) &&
      r[0]?.trim() === f[0] &&
      !SCALE.test(f[0]) &&
      !(PERIODISH.test(f[0]) && MONTH.test(f[0])) &&
      f[0] !== out.title
    )
      heads.push([i, f[0].replace(/:\s*$/, "")]);
  }
  if (heads.length) out.heads = heads;
  if (blank.length) out.blank = blank;
  return out;
}

/** Captions of every table of an HTML document or rendition (index = locator.t); `company` is its short name, never a title. */
export function tableCaptions(html: string, company?: string): TableCaption[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const tables = parseTables(body);
  // The text between the previous table tag (open or close) and each table's opening tag.
  const opens: number[] = [];
  const re = /<(\/?)table\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  let prevEnd = 0;
  const befores: string[][] = [];
  while ((m = re.exec(body))) {
    if (m[1] !== "/") {
      opens.push(m.index);
      befores.push(text(body.slice(prevEnd, m.index)).slice(-8));
    }
    prevEnd = m.index + m[0].length;
  }
  return tables.map((t, i) => captionOf(t, befores[i] ?? [], company));
}

/**
 * The title in sentence case. A title printed in capitals is lowered word by word, except words the
 * company itself writes in capitals in its line names (`keep`: "CIB", "AWM", "U.S."); a title already
 * in mixed case is kept as printed. " - " separators stay as printed hyphens.
 */
export function sentenceCase(title: string, keep: Set<string> = new Set()): string {
  const t = title.replace(/\s+/g, " ").trim();
  const ws = t.split(" ");
  const strip = (w: string) => w.replace(/^[("'“‘]+|[)"',:;”’]+$/g, "");
  // A word in capitals is lowered unless it is the company's own acronym, holds a digit or dots, or is a short
  // capital word that is not a plain English one ("FTE", "CIB" stay; "NET", "AND", "TOTAL" go).
  const shouted = (core: string) => /^[A-Z][A-Z&'-]*$/.test(core) && core.length >= 2;
  const lowerCaps = (w: string) => {
    const core = strip(w);
    if (keep.has(core) || /\d/.test(core) || /^[A-Z]\.([A-Z]\.)+$/.test(core)) return w;
    if (!shouted(core)) return w;
    return w
      .split("-")
      .map((part) => {
        const c = strip(part);
        if (keep.has(c) || (c.length <= 3 && !COMMON.has(c))) return part;
        return part.toLowerCase();
      })
      .join("-");
  };
  const caps = ws.filter((w) => shouted(strip(w))).length;
  const titled = ws.filter((w) => /^[A-Z][a-z]/.test(w)).length;
  const longWords = ws.filter((w) => /^[a-z]/i.test(w) && w.length > 3).length;
  let out: string[];
  if (caps >= 2 || (caps === 1 && !/[a-z]/.test(t))) out = ws.map(lowerCaps);
  else if (titled >= Math.max(2, longWords * 0.6))
    // Title Case ("Consolidated Statement of Operations") is lowered too; words in capitals stay.
    out = ws.map((w, i) =>
      // A word with capitals of its own past the first ("Non-GAAP", "McDonald's") keeps them.
      i > 0 && /^[A-Z][a-z]/.test(w) && !/[A-Z]/.test(w.slice(1)) && !keep.has(strip(w)) && !/:$/.test(ws[i - 1] ?? "")
        ? w.toLowerCase()
        : w,
    );
  else out = ws;
  const first = out[0] ?? "";
  out[0] = first.charAt(0).toUpperCase() + first.slice(1);
  return out
    .map((w, i) => (i > 0 && /:$/.test(out[i - 1]) ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Plain English words of three letters or fewer, lowered even when printed in capitals. */
const COMMON = new Set([
  "A",
  "AN",
  "AND",
  "ARE",
  "AS",
  "AT",
  "BY",
  "FOR",
  "IN",
  "OF",
  "ON",
  "OR",
  "THE",
  "TO",
  "NET",
  "NEW",
  "PER",
  "ALL",
  "NON",
  "OUT",
  "OFF",
  "DUE",
  "ITS",
  "NOT",
  "NO",
]);

/** Words a company writes in capitals inside mixed-case line names ("CCB average balances" → CCB). */
export function capitalWords(labels: Iterable<string>): Set<string> {
  const out = new Set([
    "GAAP",
    "U.S.",
    "EPS",
    "CET1",
    "TLAC",
    "SLR",
    "LCR",
    "VaR",
    "AUM",
    "ROE",
    "ROTCE",
    "NII",
    "EBITDA",
    "EBIT",
    "ARPU",
    "R&D",
    "SG&A",
    "TTM",
    "LTM",
    "IT",
  ]);
  for (const l of labels) {
    if (!/[a-z]/.test(l)) continue;
    // Only names written in lower case with a few capitals ("CCB average balances"), never shouted ones.
    const ws = l.split(/\s+/);
    if (ws.filter((w) => /^[A-Z]{2,}/.test(w)).length > Math.max(1, ws.length * 0.34)) continue;
    for (const w of l.split(/[\s,;:()/]+/))
      if (/^[A-Z][A-Z0-9&.]{1,6}$/.test(w) && /[A-Z].*[A-Z]|[A-Z]\d/.test(w))
        out.add(w.replace(/[.,]$/, w.endsWith(".") && w.split(".").length > 2 ? "." : ""));
  }
  return out;
}
