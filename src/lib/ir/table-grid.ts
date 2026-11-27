// Pure: the tables of a stored HTML document or rendition with the layout the markup gives each cell
// (grid column from colspans, bold, indentation, a rule above), indexed exactly as `parseTables` in
// tables.ts indexes them, so a fact locator {t, r, c} names the same cell here. Table fill (table-fill.ts)
// reads printed rows from this grid.
import { decodeHtml } from "@/lib/ir/tables";

export interface GridCell {
  /** cell text, as `parseTables` gives it */
  text: string;
  /** the text without superscripts (footnote marks printed as <sup>1,2</sup>) */
  plain: string;
  /** first grid column the cell covers (sum of the colspans before it in its row) */
  col: number;
  /** grid columns it covers */
  span: number;
  /** printed bold (font-weight 600 or more, <b>, <strong>, <th>) */
  bold: boolean;
  /** left indentation in points (padding-left, text-indent, margin-left, leading no-break spaces) */
  indent: number;
  /** a rule drawn above the cell (its own top border) */
  ruleTop: boolean;
  /** a rule drawn under the cell (its own bottom border) */
  ruleBottom: boolean;
}
export interface GridRow {
  cells: GridCell[];
  /** the row is hidden in the printed document (display:none) */
  hidden: boolean;
}
export interface GridTable {
  index: number;
  rows: GridRow[];
  /** plain text printed just before the table (after the previous table tag), at most its last 300 characters */
  lead?: string;
}

const clean = (s: string) =>
  decodeHtml(s.replace(/<[^>]+>/g, " "))
    .replace(/[\s\u00a0\u200b]+/g, " ")
    .trim();

const UNIT_PT: Record<string, number> = {
  pt: 1,
  px: 0.75,
  em: 10,
  rem: 10,
  in: 72,
  cm: 28.35,
  mm: 2.835,
};
const toPt = (v: string): number => {
  const m = v.trim().match(/^(-?\d*\.?\d+)\s*(pt|px|em|rem|in|cm|mm|%)?$/i);
  if (!m) return 0;
  const unit = (m[2] ?? "px").toLowerCase();
  if (unit === "%") return 0;
  return Number(m[1]) * (UNIT_PT[unit] ?? 0.75);
};
const styleOf = (attrs: string) => {
  const m = attrs.match(/\bstyle\s*=\s*("([^"]*)"|'([^']*)')/i);
  return (m?.[2] ?? m?.[3] ?? "").toLowerCase();
};
const prop = (style: string, name: string) => {
  const m = style.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "i"));
  return m?.[1].trim();
};
/** Left padding from a `padding` shorthand (1 to 4 values) or `padding-left`. */
function paddingLeft(style: string): number {
  const own = prop(style, "padding-left");
  if (own) return toPt(own);
  const all = prop(style, "padding");
  if (!all) return 0;
  const v = all.split(/\s+/);
  return toPt(v.length === 4 ? v[3] : v.length >= 2 ? v[1] : v[0]);
}
const ruled = (style: string, side: "top" | "bottom") => {
  const v = prop(style, `border-${side}`) ?? prop(style, `border-${side}-style`);
  if (!v) return false;
  return !/\bnone\b|\bhidden\b|^0(px|pt)?\b/.test(v);
};
const BOLD_TAG = /<(b|strong)\b/i;
const boldStyle = (s: string) => {
  const w = prop(s, "font-weight");
  return !!w && (/bold/.test(w) || Number(w) >= 600);
};

/**
 * Tables of a document with their layout. Same tag walk as `parseTables`: tables in document order,
 * nested tables included, a `<td>` outside a `<tr>` opening a row.
 */
export function parseGrid(html: string): GridTable[] {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "");
  const tables: GridTable[] = [];
  interface Open {
    t: GridTable;
    row: GridRow | null;
    cellStart: number;
    cellAttrs: string;
    cellTag: string;
    rowAttrs: string;
    col: number;
  }
  const stack: Open[] = [];
  const re = /<(\/?)(table|tr|td|th)\b([^>]*)>/gi;
  let m: RegExpExecArray | null;
  const closeCell = (o: Open, at: number) => {
    if (!o.row || o.cellStart < 0) return;
    const inner = body.slice(o.cellStart, at);
    const style = styleOf(o.cellAttrs);
    const span = Math.max(
      1,
      Math.min(100, Number(o.cellAttrs.match(/\bcolspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1) || 1),
    );
    // Inner spans carry the font weight in most EDGAR documents; take the first text-bearing one.
    const inStyles = [
      ...inner.matchAll(
        /<(?:font|span|p|div)\b[^>]*\bstyle\s*=\s*("([^"]*)"|'([^']*)')[^>]*>\s*([^<\s])/gi,
      ),
    ].map((x) => (x[2] ?? x[3] ?? "").toLowerCase());
    const firstInner = inStyles[0] ?? "";
    const raw = decodeHtml(inner.replace(/<[^>]+>/g, ""));
    const lead = raw.match(/^[\u00a0 ]*/)?.[0].replace(/ /g, "").length ?? 0;
    const indent =
      paddingLeft(style) +
      toPt(prop(style, "text-indent") ?? "0") +
      toPt(prop(style, "margin-left") ?? "0") +
      paddingLeft(firstInner) +
      toPt(prop(firstInner, "text-indent") ?? "0") +
      toPt(prop(firstInner, "margin-left") ?? "0") +
      lead * 3;
    const text = clean(inner);
    // Superscripts: <sup>, or a raised run (EDGAR's "position:relative;top:-2pt" and "vertical-align:super").
    const plain = /<sup\b|vertical-align\s*:\s*super|top\s*:\s*-\d/i.test(inner)
      ? clean(
          inner
            .replace(/<sup\b[\s\S]*?<\/sup>/gi, " ")
            .replace(
              /<(font|span)\b[^>]*style\s*=\s*"[^"]*(?:vertical-align\s*:\s*super|top\s*:\s*-\d)[^"]*"[^>]*>[^<]*<\/\1>/gi,
              " ",
            ),
        )
      : text;
    o.row.cells.push({
      text,
      plain,
      col: o.col,
      span,
      bold:
        !!text &&
        (o.cellTag === "th" || boldStyle(style) || boldStyle(firstInner) || BOLD_TAG.test(inner)),
      indent: Math.max(0, Math.round(indent * 100) / 100),
      ruleTop: ruled(style, "top"),
      ruleBottom: ruled(style, "bottom"),
    });
    o.col += span;
    o.cellStart = -1;
  };
  const openRow = (o: Open, attrs: string) => {
    o.row = { cells: [], hidden: /display\s*:\s*none/i.test(styleOf(attrs)) };
    o.t.rows.push(o.row);
    o.col = 0;
  };
  // End of the last table tag seen: the text between it and the next table is that table's lead.
  let lastTable = 0;
  while ((m = re.exec(body))) {
    const closing = m[1] === "/";
    const tag = m[2].toLowerCase();
    const attrs = m[3] ?? "";
    const top = stack[stack.length - 1];
    if (tag === "table") {
      const lead = closing ? "" : clean(body.slice(lastTable, m.index)).slice(-300);
      lastTable = m.index + m[0].length;
      if (!closing) {
        const t: GridTable = { index: tables.length, rows: [], ...(lead ? { lead } : {}) };
        tables.push(t);
        stack.push({
          t,
          row: null,
          cellStart: -1,
          cellAttrs: "",
          cellTag: "td",
          rowAttrs: "",
          col: 0,
        });
      } else if (top) {
        closeCell(top, m.index);
        stack.pop();
      }
      continue;
    }
    if (!top) continue;
    if (tag === "tr") {
      closeCell(top, m.index);
      if (!closing) openRow(top, attrs);
      else top.row = null;
      continue;
    }
    closeCell(top, m.index);
    if (closing) continue;
    if (!top.row) openRow(top, "");
    top.cellStart = m.index + m[0].length;
    top.cellAttrs = attrs;
    top.cellTag = tag;
    // A hidden cell in a hidden row stays hidden; a row hidden by its first cell reads as hidden too.
    if (top.row && top.row.cells.length === 0 && /display\s*:\s*none/i.test(styleOf(attrs)))
      top.row.hidden = true;
  }
  // A title printed in a small table of its own right above (no text between them): that table's text leads.
  for (let i = 1; i < tables.length; i++) {
    const t = tables[i];
    if ((t.lead ?? "").length >= 10) continue;
    const prev = tables[i - 1];
    const text = prev.rows
      .flatMap((r) => r.cells.map((c) => c.text))
      .filter(Boolean)
      .join(" ");
    if (text && text.length <= 400)
      t.lead = `${prev.lead ?? ""} ${text} ${t.lead ?? ""}`.trim().slice(-300);
  }
  return tables;
}
