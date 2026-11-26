// Pure HTML table parser for press releases and other non-XBRL exhibits.
// Indexes mirror the browser DOM the source viewer highlights:
//   document.querySelectorAll("table")[t].rows[r].cells[c]
// (tables in document order, including nested ones; rows/cells of each table only).

export interface ParsedTable {
  index: number;
  rows: string[][];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", dollar: "$", percnt: "%" };

export function decodeHtml(s: string) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const clean = (s: string) => decodeHtml(s.replace(/<[^>]+>/g, " ")).replace(/[\s\u00a0\u200b]+/g, " ").trim();

export function parseTables(html: string): ParsedTable[] {
  const body = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const tables: ParsedTable[] = [];
  interface Open {
    t: ParsedTable;
    row: string[] | null;
    cellStart: number;
  }
  const stack: Open[] = [];
  const re = /<(\/?)(table|tr|td|th)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  const closeCell = (o: Open, at: number) => {
    if (o.row && o.cellStart >= 0) {
      o.row.push(clean(body.slice(o.cellStart, at)));
      o.cellStart = -1;
    }
  };
  while ((m = re.exec(body))) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const top = stack[stack.length - 1];
    if (tag === "table") {
      if (!closing) {
        // A nested table's text belongs to the outer cell only up to here.
        const t: ParsedTable = { index: tables.length, rows: [] };
        tables.push(t);
        stack.push({ t, row: null, cellStart: -1 });
      } else if (top) {
        closeCell(top, m.index);
        stack.pop();
      }
      continue;
    }
    if (!top) continue;
    if (tag === "tr") {
      closeCell(top, m.index);
      if (!closing) {
        top.row = [];
        top.t.rows.push(top.row);
      } else top.row = null;
      continue;
    }
    // td / th
    if (closing) {
      closeCell(top, m.index);
    } else {
      closeCell(top, m.index);
      if (!top.row) {
        top.row = [];
        top.t.rows.push(top.row);
      }
      top.cellStart = m.index + m[0].length;
    }
  }
  return tables;
}

/**
 * Two numbers in one cell: digits, then space, then (after an optional currency sign or opening
 * parenthesis) more digits. A rendition that merges two columns prints "36,500 $35,082" or
 * "$115,186 68 %"; read as one number that becomes 3,650,035,082. The cell is never read: which of
 * the two belongs to the column can't be known from the text.
 */
const TWO_NUMBERS = /\d[\d,.]*\)?\s*%?\s+[$€£(]*\s*\(?[-−–]?\s*\d/;

/** "1,234" → 1234, "(1,234)" → −1234, "$ 12.5" → 12.5, "12.5%" → 12.5; null for non-numbers and cells holding two numbers. */
export function parseNumber(text: string): number | null {
  // A thousands separator followed by a stray space ("2, 386,745") is one number.
  const one = text.replace(/(\d),\s+(?=\d{3}(?!\d))/g, "$1,");
  if (TWO_NUMBERS.test(one)) return null;
  const t = one.replace(/[$€£\s,]/g, "").replace(/[−–]/g, "-");
  if (!t || /^[-—–]+$/.test(t)) return null;
  const m = t.match(/^(\()?(-)?(\d+(?:\.\d+)?)(\))?%?$/);
  if (!m) return null;
  const v = Number(m[3]);
  return (m[1] && m[4]) || m[2] ? -v : v;
}

/**
 * A cell that opens a parenthesis around one number and does not close it: "(32.5", "$ (1,234",
 * "(12.5%". Releases often print the ")" (or "%)", ")%") in the next cell. Text with letters,
 * a closed "(1)" and two numbers are never such a cell.
 */
export function opensParenthesis(text: string): boolean {
  if (text.includes(")") || /[a-z]/i.test(text)) return false;
  const t = text.replace(/(\d),\s+(?=\d{3}(?!\d))/g, "$1,");
  if (TWO_NUMBERS.test(t)) return false;
  return /^[$€£]*\([$€£]*\d+(?:\.\d+)?%?$/.test(t.replace(/[\s,]/g, ""));
}

/** A cell that only closes a parenthesis: ")", "%)", ")%", ") %". */
const CLOSES = /^%?\)%?$/;

/**
 * The number of cell `c` of a parsed row. Same as `parseNumber`, except a cell that opens a
 * parenthesis (`opensParenthesis`): it is negative when the first non-empty cell after it closes
 * the parenthesis, and null (never read as positive) when anything else, or nothing, follows.
 */
export function parseRowCell(row: string[], c: number): number | null {
  const text = row[c];
  if (text == null) return null;
  if (!opensParenthesis(text)) return parseNumber(text);
  for (let j = c + 1; j < row.length; j++) {
    const next = row[j].replace(/\s+/g, "");
    if (!next) continue;
    if (!CLOSES.test(next)) return null;
    const n = parseNumber(text.replace("(", ""));
    return n == null ? null : -Math.abs(n);
  }
  return null;
}

/** Compact text rendering of numeric tables for the extractor; cell references are exact DOM indexes. */
export function renderTablesForModel(tables: ParsedTable[], maxChars = 90_000): string {
  const out: string[] = [];
  let size = 0;
  for (const t of tables) {
    const numeric = t.rows.reduce((n, r) => n + r.filter((c) => parseNumber(c) != null).length, 0);
    if (numeric < 4) continue;
    const lines = [`## T${t.index}`];
    t.rows.forEach((r, ri) => {
      const cells = r.map((c, ci) => (c ? `c${ci}=${c}` : "")).filter(Boolean);
      if (cells.length) lines.push(`r${ri}: ${cells.join(" | ")}`);
    });
    const block = lines.join("\n");
    if (size + block.length > maxChars) break;
    out.push(block);
    size += block.length;
  }
  return out.join("\n\n");
}
