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

/** "1,234" → 1234, "(1,234)" → −1234, "$ 12.5" → 12.5, "12.5%" → 12.5; null for non-numbers. */
export function parseNumber(text: string): number | null {
  const t = text.replace(/[$€£\s,]/g, "").replace(/[−–]/g, "-");
  if (!t || /^[-—–]+$/.test(t)) return null;
  const m = t.match(/^(\()?(-)?(\d+(?:\.\d+)?)(\))?%?$/);
  if (!m) return null;
  const v = Number(m[3]);
  return (m[1] && m[4]) || m[2] ? -v : v;
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
