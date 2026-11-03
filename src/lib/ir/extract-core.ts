// Pure core of the IR table extractor: prompt, JSON schema, chunking and validation.
// The model only *points* at table cells (table/row/cell indexes) and describes them; every value
// is re-read from the parsed cell and scaled here, so a stored fact can never carry a number that
// isn't printed in the source document.
import { decodeHtml, parseNumber, type ParsedTable } from "@/lib/ir/tables";

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

PERIODS: list each period column of a table once in "periods" (p = 0,1,2…), then map each row's number cells to a period with {c, p}. months = 3 for a quarter ("Three Months Ended", "Q3"), 6/9 for year-to-date, 12 for a full year, 0 for point-in-time values ("as of", end-of-period balances, subscribers at period end, store counts, backlog). Dates are ISO YYYY-MM-DD; period_start is the first day of the period (estimate from months and the fiscal calendar when not printed; use "" for months=0). When headers only say "Q3 FY25" or "Fiscal 2024", infer exact dates from the company's fiscal calendar and the document date.
SKIP: percent-change / growth / "% of total" / variance columns, constant-currency columns, guidance/outlook, non-GAAP reconciliation adjustments, per-share data, share counts, tax, interest, and consolidated statement lines that are not part of a breakdown.

UNITS & SCALE: scale multiplies the printed number to absolute units ("in millions" → 1000000, "in thousands" → 1000, "in billions" → 1000000000); percentages, ratios, per-share amounts and prices use scale 1. unit: "usd" money, "pct" percentages (value as printed, e.g. 45.2), "bps" basis points, "count" counts/volumes, "usdPerShare" per-unit dollar amounts like ARPU or realized price per barrel, "ratio" multiples.

LABELS: exactly as printed, without footnote markers; for indented sub-rows that only make sense with their heading, prefix the heading ("Americas — iPhone"). If no table qualifies return {"tables": []}.`;

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
  locator: { t: number; r: number; c: number; text: string };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const SCALES = new Set([1, 1e3, 1e6, 1e9]);
const cleanLabel = (s: string) =>
  s
    .replace(/\s*\((\d|[a-z])\)\s*$/i, "")
    .replace(/[*†‡]+$/, "")
    .replace(/\s+/g, " ")
    .trim();

/** Validate the model's pointers against the parsed tables and turn them into fact rows. */
export function factsFromModel(out: ModelOutput, tables: ParsedTable[], filed?: string | null): { rows: FactRow[]; rejected: number } {
  const rows: FactRow[] = [];
  const seen = new Set<string>();
  let rejected = 0;
  const latest = filed ? Date.parse(filed) + 10 * 86_400_000 : Infinity;
  for (const tb of out.tables ?? []) {
    const table = tables[tb.t];
    if (!table) {
      rejected += tb.rows.reduce((n, r) => n + r.cells.length, 0);
      continue;
    }
    const periods = new Map(tb.periods.map((p) => [p.p, p]));
    for (const row of tb.rows) {
      const label = cleanLabel(row.label);
      const unitScale = row.unit === "usd" || row.unit === "count" || row.unit === "other" ? row.scale : 1;
      for (const cell of row.cells) {
        const key = `${tb.t}:${row.r}:${cell.c}`;
        if (seen.has(key)) continue;
        const text = table.rows[row.r]?.[cell.c];
        const n = text == null ? null : parseNumber(text);
        const per = periods.get(cell.p);
        const okPeriod = !!per && [0, 3, 6, 9, 12].includes(per.months) && ISO.test(per.period_end) && Date.parse(per.period_end) <= latest;
        if (n == null || !okPeriod || !SCALES.has(unitScale) || !label) {
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
  return { rows, rejected };
}
