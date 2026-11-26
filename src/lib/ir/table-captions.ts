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

const MONTH = /\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b/i;
const PERIODISH = /\b(quarter|quarterly|months?|weeks?|year|years|ended|ending|trends|fy|ytd|change|vs\.?|actual|as of)\b|\b(19|20)\d{2}\b|\b[1-4]q\b|\bq[1-4]\b/i;
const SCALE = /\(?\s*(\$\s*)?(in|amounts in|dollars in|\$ in)\s+(millions|thousands|billions)\b[^)]*\)?/i;
const ENTITY = /\b(inc|corp|corporation|co|company|ltd|plc|llc|n\.a|holdings|group|incorporated)\.?\s*$/i;
const NOISE = /^\(?(unaudited|continued|in \w+)\)?$/i;

const text = (s: string) =>
  decodeHtml(s.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<\/(p|div|tr|li|h\d|br)\s*>|<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
    .split("\n")
    .map((l) => l.replace(/[\s ​]+/g, " ").trim())
    .filter(Boolean);

/** A row's non-empty cells, with currency marks and footnote digits taken as empty. */
const filled = (r: string[]) => r.map((c) => c.trim()).filter((c) => c && !/^[$€£%)(]+$/.test(c));
const hasFigure = (r: string[]) => r.slice(1).some((c) => parseNumber(c) != null && !/^(19|20)\d{2}$/.test(c.trim()));

/** Whether a line reads as a title: letters, not a sentence, not a period head, not the company's name. */
function titleLike(s: string, company?: string) {
  if (s.length < 4 || s.length > 140) return false;
  // Page footers and running heads ("Honeywell Q3'26 Results - 3", "Page 4").
  if (/\s[-–]\s*\d+$|^page \d+|\bpage \d+ of \d+|^[-–(]/i.test(s)) return false;
  if (company && s.split(" ").length <= 3 && s.toLowerCase().startsWith(company.toLowerCase().split(" ")[0])) return false;
  if (!/[a-z]{3,}/i.test(s)) return false;
  if (NOISE.test(s) || SCALE.test(s)) return false;
  if (ENTITY.test(s)) return false;
  if (/[.;]\s+\S/.test(s) && s.split(" ").length > 14) return false;
  if (PERIODISH.test(s) && (MONTH.test(s) || /\b(19|20)\d{2}\b/.test(s) || /months?|quarter/i.test(s))) return false;
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
  const heads0 = top.findIndex((r) => filled(r).some((c) => MONTH.test(c) || /\b(19|20)\d{2}\b/.test(c) || /months? ended|quarterly|\bq[1-4]\b|\b[1-4]q\b/i.test(c)));
  for (const r of heads0 < 0 ? top : top.slice(0, heads0)) {
    const f = filled(r);
    if (f.length !== 1) continue;
    const s = f[0];
    if (!out.unit && SCALE.test(s)) out.unit = s.match(SCALE)![0].trim();
    else if (!out.title && titleLike(s, company)) out.title = s;
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
  if (out.title) out.title = out.title.replace(/\s*\(unaudited\)\s*/gi, " ").replace(/:\s*$/, "").trim();
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
    if (i > first && !f.length) blank.push(i);
    else if (f.length === 1 && !hasFigure(r) && r[0]?.trim() === f[0] && !SCALE.test(f[0]) && !(PERIODISH.test(f[0]) && MONTH.test(f[0])) && f[0] !== out.title) heads.push([i, f[0].replace(/:\s*$/, "")]);
  }
  if (heads.length) out.heads = heads;
  if (blank.length) out.blank = blank;
  return out;
}

/** Captions of every table of an HTML document or rendition (index = locator.t); `company` is its short name, never a title. */
export function tableCaptions(html: string, company?: string): TableCaption[] {
  const body = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
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
  if (/[a-z]/.test(t)) {
    // Title Case ("Consolidated Statement of Operations") is lowered the same way; words in capitals stay.
    const ws = t.split(" ");
    const caps = ws.filter((w) => /^[A-Z][a-z]/.test(w)).length;
    if (caps < Math.max(2, ws.filter((w) => /^[a-z]/i.test(w) && w.length > 3).length * 0.6)) return t.charAt(0).toUpperCase() + t.slice(1);
    return ws
      .map((w, i) => (i === 0 || /:$/.test(ws[i - 1] ?? "") ? w.charAt(0).toUpperCase() + w.slice(1) : /^[A-Z][a-z]/.test(w) && !keep.has(w) ? w.toLowerCase() : w))
      .join(" ");
  }
  const words = t.split(" ").map((w, i) => {
    const core = w.replace(/^[("']+|[)"',:;]+$/g, "");
    if (keep.has(core) || /^[A-Z]\.([A-Z]\.)+$/.test(core) || /\d/.test(core)) return w;
    // "NON-GAAP" → "non-GAAP": each hyphenated part on its own.
    const lower = w.split("-").map((part) => (keep.has(part.replace(/[)"',:;]+$/g, "")) ? part : part.toLowerCase())).join("-");
    return i === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return words.join(" ");
}

/** Words a company writes in capitals inside mixed-case line names ("CCB average balances" → CCB). */
export function capitalWords(labels: Iterable<string>): Set<string> {
  const out = new Set(["GAAP", "U.S.", "EPS", "CET1", "TLAC", "SLR", "LCR", "VaR", "AUM", "ROE", "ROTCE", "NII", "EBITDA", "EBIT", "ARPU", "R&D", "SG&A", "TTM", "LTM", "IT"]);
  for (const l of labels) {
    if (!/[a-z]/.test(l)) continue;
    // Only names written in lower case with a few capitals ("CCB average balances"), never shouted ones.
    const ws = l.split(/\s+/);
    if (ws.filter((w) => /^[A-Z]{2,}/.test(w)).length > Math.max(1, ws.length * 0.34)) continue;
    for (const w of l.split(/[\s,;:()/]+/)) if (/^[A-Z][A-Z0-9&.]{1,6}$/.test(w) && /[A-Z].*[A-Z]|[A-Z]\d/.test(w)) out.add(w.replace(/[.,]$/, w.endsWith(".") && w.split(".").length > 2 ? "." : ""));
  }
  return out;
}
