// Pure core of the IR table extractor: prompt, JSON schema, chunking and validation.
// The model only *points* at table cells (table/row/cell indexes) and describes them; every value
// is re-read from the parsed cell and scaled here, so a stored fact can never carry a number that
// isn't printed in the source document.
import { inFullUnits, printedScale, screenRows } from "@/lib/ir/scale-check";
import { decodeHtml, opensParenthesis, parseNumber, parseRowCell, tableAbove, type ParsedTable } from "@/lib/ir/tables";

export const CATEGORIES = ["segment", "product", "geography", "customer", "channel", "cost", "kpi", "balance"] as const;
export const METRICS = [
  "revenue",
  "operating_income",
  "segment_profit",
  "gross_profit",
  "net_income",
  "cost",
  "expense",
  "margin",
  "units",
  "users",
  "volume",
  "price",
  "backlog",
  "assets",
  "deposits",
  "loans",
  "aum",
  "headcount",
  "stores",
  "other",
] as const;
export const UNITS = ["usd", "pct", "count", "usdPerShare", "ratio", "bps", "other"] as const;

export interface ModelRow {
  r: number;
  label: string;
  parent: string;
  breakdown: string;
  category: (typeof CATEGORIES)[number];
  metric: (typeof METRICS)[number];
  unit: (typeof UNITS)[number];
  scale: number;
  is_total: boolean;
  cells: { c: number; p: number }[];
}
export interface ModelTable {
  t: number;
  periods: { p: number; period_start: string; period_end: string; months: number }[];
  rows: ModelRow[];
}
export interface ModelOutput {
  tables: ModelTable[];
}

export const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["tables"],
  properties: {
    tables: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["t", "periods", "rows"],
        properties: {
          t: { type: "integer" },
          periods: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["p", "period_start", "period_end", "months"],
              properties: {
                p: { type: "integer" },
                period_start: { type: "string" },
                period_end: { type: "string" },
                months: { type: "integer" },
              },
            },
          },
          rows: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["r", "label", "parent", "breakdown", "category", "metric", "unit", "scale", "is_total", "cells"],
              properties: {
                r: { type: "integer" },
                label: { type: "string" },
                parent: { type: "string" },
                breakdown: { type: "string" },
                category: { type: "string", enum: [...CATEGORIES] },
                metric: { type: "string", enum: [...METRICS] },
                unit: { type: "string", enum: [...UNITS] },
                scale: { type: "number" },
                is_total: { type: "boolean" },
                cells: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["c", "p"],
                    properties: { c: { type: "integer" }, p: { type: "integer" } },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;

export const EXTRACT_INSTRUCTIONS = `You are a meticulous sell-side data analyst reading the tables of a public company's investor-relations document (earnings release, financial supplement, presentation or data file). Point at every cell that holds disaggregated or operating data so it can be stored with an exact cell reference.

INPUT FORMAT: tables appear as "## T<t>" followed by rows "r<r>: c<c>=<text> | ...". Use those exact t / r / c indexes. The c index must be the cell that contains the number itself, never a "$" or "%" cell next to it.

WHAT TO RETURN (be comprehensive — every qualifying row in every table):
1. Every disaggregation of revenue / net sales: by reportable or operating segment, product or service line, geography, customer type or end market, sales channel.
2. Segment profit measures (operating income, segment profit, adjusted EBITDA by segment, contribution), segment margins, and segment costs.
3. Cost and expense breakdowns whose parts sum to a printed total (cost of sales by type, operating expenses by function, noninterest expense by type, etc.) — category "cost".
4. Operating KPIs the company reports: units shipped, deliveries, subscribers, paid members, MAU/DAU, ARPU, same-store sales, store counts, backlog, bookings, RPO, AUM/AUA, deposits, loans, net interest margin, production volumes, realized prices, load factor, headcount, etc. — category "kpi" (or "balance" for balance-type breakdowns such as loans or deposits by type).

TOTALS AND HIERARCHY (critical — totals are verified by adding children):
- Return the printed total row of each breakdown with is_total=true. Every child's "parent" is the exact label of the total it sums into; top-level totals use parent "".
- Subtotals are totals too: e.g. "Products" (= iPhone + Mac + iPad + Wearables) is is_total=true with parent "Total net sales", and iPhone/Mac/iPad get parent "Products".
- If a breakdown has no printed total row but its parts sum to a consolidated line printed elsewhere in the document (e.g. "Total revenues" in the income statement), return that consolidated row too as the total (is_total=true).
- Keep different breakdowns of the same total apart: a segment table and a product table that both sum to total revenue get different categories ("segment" vs "product") and different "breakdown" names. Never give one category+parent two overlapping sets of children.
- Items that are subtracted (eliminations, intersegment, corporate and other, hedging) are children too, with the value sign as printed (parentheses = negative).
- "breakdown" is a short name of the dimension, e.g. "Net sales by category", "Revenue by reportable segment", "Operating income by segment", "Noninterest expense".

PERIODS: list each period column of a table once in "periods" (p = 0,1,2…), then map each row's number cells to a period with {c, p}. months = 3 for a quarter ("Three Months Ended", "Q3"), 6/9 for year-to-date, 12 for a full year, 1 for a single month (monthly operating statistics: "October 2025", "Month ended Oct 31"), 0 for point-in-time values ("as of", end-of-period balances, subscribers at period end, store counts, backlog). A balance row stays months=0 even under a "Three Months Ended" header (period-end loans, deposits, assets, AUM, members, subscribers, stores, headcount); an average for the period ("Average loans", "average daily volume") takes the column's months and keeps "Average" in its label. Dates are ISO YYYY-MM-DD; period_start is the first day of the period (estimate from months and the fiscal calendar when not printed; use "" for months=0). When headers only say "Q3 FY25" or "Fiscal 2024", infer exact dates from the company's fiscal calendar and the document date.
SKIP: percent-change / growth / "% of total" / variance columns, constant-currency columns, guidance/outlook, non-GAAP reconciliation adjustments, per-share data, share counts, tax, interest, and consolidated statement lines that are not part of a breakdown.

UNITS & SCALE: scale multiplies the printed number to absolute units ("in millions" → 1000000, "in thousands" → 1000, "in billions" → 1000000000); percentages, ratios, per-share amounts and prices use scale 1. unit: "usd" money, "pct" percentages (value as printed, e.g. 45.2), "bps" basis points, "count" counts/volumes, "usdPerShare" per-unit dollar amounts like ARPU or realized price per barrel, "ratio" multiples.

LABELS: exactly as printed, without footnote markers; for indented sub-rows that only make sense with their heading, prefix the heading ("Americas — iPhone"). When a table or a block of rows reports one segment, region or business ("Health Care Benefits segment results", a "Pharmacy" block), prefix each row with that name as printed ("Health Care Benefits — Adjusted operating income") and use category "segment" for its revenue and profit rows, so the same segment's figures line up across releases. If no table qualifies return {"tables": []}.`;

/** Visible text before the first table: title, dates, fiscal-period wording. */
export function leadText(html: string, max = 2500) {
  const head = html.split(/<table\b/i)[0] ?? "";
  const text = decodeHtml(head.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, max);
}

function tableBlock(t: ParsedTable, rows?: number[]) {
  const lines = [`## T${t.index}`];
  t.rows.forEach((r, ri) => {
    if (rows && !rows.includes(ri)) return;
    const cells = r.map((c, ci) => (c ? `c${ci}=${c}` : "")).filter(Boolean);
    if (cells.length) lines.push(`r${ri}: ${cells.join(" | ")}`);
  });
  return lines.join("\n");
}

const numericCells = (t: ParsedTable) => t.rows.reduce((n, r) => n + r.filter((c) => parseNumber(c) != null).length, 0);

/**
 * Split the numeric tables of a document into prompt chunks of at most `maxChars`.
 * A table larger than a chunk is split by rows, repeating its first rows (the column headers)
 * in each piece; row indexes stay the real DOM indexes.
 */
export function chunkTables(tables: ParsedTable[], maxChars = 40_000): string[] {
  const chunks: string[] = [];
  let cur: string[] = [];
  let size = 0;
  const flush = () => {
    if (cur.length) chunks.push(cur.join("\n\n"));
    cur = [];
    size = 0;
  };
  for (const t of tables) {
    if (numericCells(t) < 4) continue;
    const block = tableBlock(t);
    if (block.length <= maxChars) {
      if (size + block.length > maxChars) flush();
      cur.push(block);
      size += block.length;
      continue;
    }
    flush();
    const header = [0, 1, 2, 3, 4, 5].filter((i) => i < t.rows.length);
    let piece: number[] = [];
    let pieceSize = 0;
    for (let ri = header.length; ri < t.rows.length; ri++) {
      const len = t.rows[ri].join(" ").length + 12 * t.rows[ri].length;
      if (pieceSize + len > maxChars * 0.9 && piece.length) {
        chunks.push(tableBlock(t, [...header, ...piece]));
        piece = [];
        pieceSize = 0;
      }
      piece.push(ri);
      pieceSize += len;
    }
    if (piece.length) chunks.push(tableBlock(t, [...header, ...piece]));
  }
  flush();
  return chunks;
}

export interface FactRow {
  category: string;
  metric: string;
  breakdown: string | null;
  parent: string | null;
  is_total: boolean;
  label: string;
  period_label: string;
  period_start: string | null;
  period_end: string;
  months: number;
  value: number;
  unit: string;
  /** `suspect`: why the figure's scale is doubtful (see scale-check.ts); the value is stored as read */
  locator: { t: number; r: number; c: number; text: string; suspect?: string };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Period lengths readers may store: point in time, one month (monthly operating statistics), quarter, year-to-date, year. */
export const PERIOD_MONTHS = [0, 1, 3, 6, 9, 12];
const DAY_MS = 86_400_000;
/** A one-month figure must span about a month when the start is given. */
export const monthSpanOk = (per: { months: number; period_start: string; period_end: string }) => {
  if (per.months !== 1 || !ISO.test(per.period_start)) return true;
  const d = (Date.parse(per.period_end) - Date.parse(per.period_start)) / DAY_MS + 1;
  return d >= 27 && d <= 32;
};
const SCALES = new Set([1, 1e3, 1e6, 1e9]);
/** Lines whose dollars are per share or per unit, which "except per share data" leaves unscaled. */
const PER_SHARE = /\bper\b|\beps\b|^(basic|diluted)$|dividends? declared/i;
const cleanLabel = (s: string) =>
  s
    .replace(/\s*\((\d|[a-z])\)\s*$/i, "")
    .replace(/[*†‡]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

/** A figure slot of a printed row: a number, an opened parenthesis, or a dash or mark standing for one ("—", "—%", "NP", "n/m"). */
const isFigure = (c: string) => parseNumber(c) != null || opensParenthesis(c) || /^([—–-]+\s*%?|np|n\/?a|nm|n\.m\.?|nmf|nr|n\/m)$/i.test(c.trim());
/** Cell index → ordinal among the row's figure cells: the printed column, whatever "$" or spacer cells precede it. */
export function figureSlots(row: string[]): Map<number, number> {
  const out = new Map<number, number>();
  row.forEach((c, i) => {
    if (c && isFigure(c)) out.set(i, out.size);
  });
  return out;
}
/** A column head that names a comparison, not a period: its cells are never money. */
export const CHANGE_HEAD = /\b(change|growth|variance|var\.?|vs\.?|versus|increase|decrease|inc\.?\s*\/\s*\(?dec)\b|%|\bbps\b|basis points/i;

/**
 * Head of each printed column (slot), from the table's own head rows: the last row above the first
 * figure row whose non-empty cells (after its label) are as many as the figures of a full row.
 */
export function slotHeads(table: ParsedTable, slots: number): string[] | null {
  const first = table.rows.findIndex((r) => r.some((c, i) => i > 0 && c && isFigure(c) && !/^(19|20)\d{2}$/.test(c.trim())));
  const heads = table.rows.slice(0, first < 0 ? 0 : first);
  for (let i = heads.length - 1; i >= 0; i--) {
    const cells = heads[i].filter((c) => c.trim());
    const named = heads[i][0]?.trim() ? cells.slice(1) : cells;
    if (named.length === slots) return named;
  }
  return null;
}

/**
 * Cells a model row maps against the printed grid, to reject before storing (key "r:c"):
 *   - a money row's cell under a comparison head ("Change", "%", "bps") or printed with "%";
 *   - every cell of a row whose figures map to periods in an order that contradicts the grid: where the
 *     head row prints a full date over each column, a cell dated as another column's date; otherwise a
 *     cell dated differently from what the table's other full rows map the same printed column to (at
 *     least three rows, three in four agreeing).
 * Only rows with as many figures as the table's usual full row are compared.
 */
export function gridRejects(tb: ModelTable, table: ParsedTable): Set<string> {
  const bad = new Set<string>();
  const ends = new Map(tb.periods.map((p) => [p.p, p.period_end]));
  const rowSlots = new Map(tb.rows.map((r) => [r.r, figureSlots(table.rows[r.r] ?? [])]));
  const counts = new Map<number, number>();
  for (const m of rowSlots.values()) if (m.size) counts.set(m.size, (counts.get(m.size) ?? 0) + 1);
  const full = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? 0;
  const heads = full ? slotHeads(table, full) : null;
  // Votes: printed column → period end, one per full row.
  const votes = new Map<number, Map<string, number>>();
  // Only rows that spread over two or more periods say what the columns are: a table with the periods
  // down the side (CAT's sales by region, one quarter a row) has columns that are not periods.
  const spread = (row: ModelRow) => new Set(row.cells.map((c) => ends.get(c.p))).size >= 2;
  for (const row of tb.rows) {
    const slots = rowSlots.get(row.r)!;
    if (slots.size !== full || !spread(row)) continue;
    const seen = new Set<number>();
    for (const cell of row.cells) {
      const k = slots.get(cell.c);
      const end = ends.get(cell.p);
      if (k == null || end == null || seen.has(k)) continue;
      seen.add(k);
      const v = votes.get(k) ?? new Map<string, number>();
      v.set(end, (v.get(end) ?? 0) + 1);
      votes.set(k, v);
    }
  }
  const settled = new Map<number, string>();
  // Printed dates over the columns settle them; votes only where the heads print none.
  const dated = heads?.map(headDate) ?? [];
  // Quarter heads ("Q3 2026", "3Q26") name calendar quarters only when at least half of the cells the
  // model mapped agree with them (a fiscal calendar off the calendar quarters agrees with none).
  const quarters = heads?.map(headQuarter) ?? [];
  const periodHeads = (h: (string | null)[]) => h.length > 0 && h.some(Boolean) && h.every((d, k) => d || (heads && CHANGE_HEAD.test(heads[k])));
  const agreeing = (h: (string | null)[]) => {
    let n = 0;
    let ok = 0;
    for (const row of tb.rows) {
      const slots = rowSlots.get(row.r)!;
      if (slots.size !== full) continue;
      for (const cell of row.cells) {
        const k = slots.get(cell.c);
        const want = k == null ? null : h[k];
        const end = ends.get(cell.p);
        if (!want || !end) continue;
        n++;
        if (sameDay(end, want)) ok++;
      }
    }
    return n > 0 && ok >= n / 2;
  };
  const byHead = periodHeads(dated) ? dated : periodHeads(quarters) && agreeing(quarters) ? quarters : null;
  if (byHead) {
    byHead.forEach((d, k) => d && settled.set(k, d));
  } else for (const [k, v] of votes) {
    const total = [...v.values()].reduce((a, b) => a + b, 0);
    const [end, n] = [...v].sort((a, b) => b[1] - a[1])[0];
    if (total >= 3 && n >= total * 0.75) settled.set(k, end);
  }
  for (const row of tb.rows) {
    const slots = rowSlots.get(row.r)!;
    const money = row.unit === "usd";
    for (const cell of row.cells) {
      const text = table.rows[row.r]?.[cell.c] ?? "";
      const k = slots.get(cell.c);
      if (money && (/%/.test(text) || (k != null && heads && slots.size === full && CHANGE_HEAD.test(heads[k])))) bad.add(`${row.r}:${cell.c}`);
    }
    if (slots.size !== full) continue;
    const wrong = row.cells.some((cell) => {
      const k = slots.get(cell.c);
      const want = k == null ? undefined : settled.get(k);
      const end = ends.get(cell.p);
      return want != null && end != null && !sameDay(end, want);
    });
    if (wrong) for (const cell of row.cells) bad.add(`${row.r}:${cell.c}`);
  }
  return bad;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
/** "January 31, 2025" (also "Jan. 31, 2025", "31 January 2025") in a head → "2025-01-31"; null for any other head. */
export function headDate(head: string): string | null {
  const h = head.toLowerCase().replace(/\./g, "");
  const m = h.match(/\b([a-z]{3,9}) (\d{1,2}),? (\d{4})\b/) ?? h.match(/\b(\d{1,2}) ([a-z]{3,9}),? (\d{4})\b/);
  if (!m) return null;
  const [mon, day] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
  const i = MONTHS.findIndex((x) => x.startsWith(mon) && mon.length >= 3);
  if (i < 0) return null;
  return `${m[3]}-${String(i + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
}
const ORDINALS = ["first", "second", "third", "fourth"];
/** "Q3 2026", "3Q26", "3Q 2026", "Third quarter 2026" → the calendar quarter's end ("2026-09-30"); null otherwise. */
export function headQuarter(head: string): string | null {
  const h = head.toLowerCase();
  const m = h.match(/\bq([1-4])\s*'?(\d{4}|\d{2})\b/) ?? h.match(/\b([1-4])q\s*'?(\d{4}|\d{2})\b/) ?? h.match(/\b(first|second|third|fourth) quarter,? (\d{4})\b/);
  if (!m || /\bfy|fiscal/.test(h)) return null;
  const q = /^\d$/.test(m[1]) ? Number(m[1]) : ORDINALS.indexOf(m[1]) + 1;
  const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return `${y}-${["03-31", "06-30", "09-30", "12-31"][q - 1]}`;
}
/** Period ends within a week of each other are the same column (52/53-week calendars, "as of" dates). */
const sameDay = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= 7 * DAY_MS;

/** Validate the model's pointers against the parsed tables and turn them into fact rows. */
export function factsFromModel(out: ModelOutput, tables: ParsedTable[], filed?: string | null): { rows: FactRow[]; rejected: number } {
  const rows: FactRow[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  // Nothing reported can end after the filing (or, for undated files, after today): later periods are guidance.
  const latest = Math.min(filed ? Date.parse(filed) + 10 * 86_400_000 : Infinity, Date.now() + 10 * 86_400_000);
  for (const tb of out.tables ?? []) {
    const table = tables[tb.t];
    if (!table) {
      rejected += tb.rows.reduce((n, r) => n + r.cells.length, 0);
      continue;
    }
    const periods = new Map(tb.periods.map((p) => [p.p, p]));
    const misplaced = gridRejects(tb, table);
    // The table's own evidence on its money scale: cells already in full units, else printed scale words.
    // The table's own scale words first, else the scale line printed in the title lines just above it
    // (NVDA prints "(In millions, except per share data)" above its income statement table); title
    // lines are short, a sentence of the text before the table is never one.
    const printed = printedScale(table) ?? printedScale({ index: table.index, rows: tableAbove(table).filter((l) => l.length <= 120).map((l) => [l]) });
    const usdTexts = tb.rows.filter((r) => r.unit === "usd" && (r.scale > 1 || printed)).flatMap((r) => r.cells.map((c) => table.rows[r.r]?.[c.c] ?? ""));
    const full = inFullUnits(usdTexts, Math.max(printed ?? 1, ...tb.rows.filter((r) => r.unit === "usd").map((r) => r.scale)));
    for (const row of tb.rows) {
      const label = cleanLabel(row.label);
      let unitScale = row.unit === "usd" || row.unit === "count" || row.unit === "other" ? row.scale : 1;
      // A printed scale outranks the model's row scale, also a row scale of 1 (NVDA Q3 FY27: every usd row
      // came back at scale 1 under "(In millions)"); per-share lines keep their printed value.
      if (row.unit === "usd" && (unitScale > 1 || (printed && !PER_SHARE.test(label)))) unitScale = full ? 1 : (printed ?? unitScale);
      for (const cell of row.cells) {
        const key = `${tb.t}:${row.r}:${cell.c}`;
        if (seen.has(key)) continue;
        const text = table.rows[row.r]?.[cell.c];
        // Row-aware: "(32.5" closed by "%)" in the next cell is negative; unclosed, it is rejected.
        const n = text == null ? null : parseRowCell(table.rows[row.r], cell.c);
        const per = periods.get(cell.p);
        const okPeriod = !!per && PERIOD_MONTHS.includes(per.months) && ISO.test(per.period_end) && Date.parse(per.period_end) <= latest && monthSpanOk(per);
        if (n == null || !okPeriod || !SCALES.has(unitScale) || !label || misplaced.has(`${row.r}:${cell.c}`)) {
          rejected++;
          continue;
        }
        seen.add(key);
        rows.push({
          category: row.category,
          metric: row.metric,
          breakdown: row.breakdown?.trim() || null,
          parent: cleanLabel(row.parent) || null,
          is_total: row.is_total,
          label,
          period_label: per!.months ? `${per!.months}M ending ${per!.period_end}` : `As of ${per!.period_end}`,
          period_start: per!.months && ISO.test(per!.period_start) ? per!.period_start : null,
          period_end: per!.period_end,
          months: per!.months,
          value: n * unitScale,
          unit: row.unit,
          locator: { t: tb.t, r: row.r, c: cell.c, text: text! },
        });
      }
    }
  }
  return { rows: screenRows(rows), rejected };
}
