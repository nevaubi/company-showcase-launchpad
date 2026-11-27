// Pure: the document-only part of the table fill, reduced once per document and fill version so later rebuilds
// read it back instead of the stored HTML (`fill/<document id>.v<FILL_CACHE_VERSION>.json` in the ir-documents
// bucket, written by the worker at rebuild, rebuild.server.ts). It holds the parsed grid (tables that print a
// figure, with every cell's text, grid columns, layout marks and the text printed before each table), the printed
// captions, the document's dash convention and the first part of its text (for the supplement hint). The period
// assignment against the stored facts stays at rebuild (table-fill.ts). Bump FILL_CACHE_VERSION when the grid
// parser, the captions or this shape change, so stale copies are parsed again.
import { tableCaptions, type TableCaption } from "@/lib/ir/table-captions";
import { dashMeansZero } from "@/lib/ir/table-fill";
import { parseGrid, type GridCell, type GridTable } from "@/lib/ir/table-grid";

export const FILL_CACHE_VERSION = 1;

/** A stored document reduced to what the fill reads. */
export interface FillDoc {
  v: number;
  grid: GridTable[];
  captions: TableCaption[];
  zeroDash: boolean;
  /** plain text of the document's start (at most 3,000 characters) */
  head: string;
}

/** Storage path of a document's reduced copy. */
export const fillCachePath = (id: string) => `fill/${id}.v${FILL_CACHE_VERSION}.json`;

const NUMERIC = /\d/;

/** Reduce a stored document's text (HTML or HTML rendition) to what the fill reads. */
export function reduceDocument(html: string, company?: string): FillDoc {
  const grid = parseGrid(html).map((t) =>
    // A table printing no digit at all is kept as a place (indexes stay those of the facts' locators).
    t.rows.some((r) => r.cells.some((c) => NUMERIC.test(c.text))) ? t : { ...t, rows: [] },
  );
  const head = html
    .slice(0, 60_000)
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 3000);
  return {
    v: FILL_CACHE_VERSION,
    grid,
    captions: tableCaptions(html, company),
    zeroDash: dashMeansZero(html),
    head,
  };
}

type PackedCell =
  [string, number, number, number, number] | [string, number, number, number, number, string];
interface PackedTable {
  i: number;
  l?: string;
  r: [0 | 1, ...PackedCell[]][];
}

/** The reduced copy as stored: cells as [text, col, span, flags (1 bold, 2 rule above, 4 rule below), indent, plain?]. */
export function packFillDoc(d: FillDoc): string {
  const tables: PackedTable[] = d.grid.map((t) => ({
    i: t.index,
    ...(t.lead ? { l: t.lead } : {}),
    r: t.rows.map((row) => [
      row.hidden ? 1 : 0,
      ...row.cells.map((c): PackedCell => {
        const flags = (c.bold ? 1 : 0) | (c.ruleTop ? 2 : 0) | (c.ruleBottom ? 4 : 0);
        const base: [string, number, number, number, number] = [
          c.text,
          c.col,
          c.span,
          flags,
          c.indent,
        ];
        return c.plain === c.text ? base : [...base, c.plain];
      }),
    ]),
  }));
  return JSON.stringify({ v: d.v, t: tables, c: d.captions, z: d.zeroDash, h: d.head });
}

/** A stored reduced copy, or null when it is of another version or not one at all. */
export function unpackFillDoc(text: string): FillDoc | null {
  let o: { v?: unknown; t?: PackedTable[]; c?: TableCaption[]; z?: boolean; h?: string };
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  if (o?.v !== FILL_CACHE_VERSION || !Array.isArray(o.t)) return null;
  const grid: GridTable[] = o.t.map((t) => ({
    index: t.i,
    ...(t.l ? { lead: t.l } : {}),
    rows: t.r.map(([hidden, ...cells]) => ({
      hidden: hidden === 1,
      cells: cells.map(([text, col, span, flags, indent, plain]): GridCell => ({
        text,
        plain: plain ?? text,
        col,
        span,
        bold: (flags & 1) !== 0,
        ruleTop: (flags & 2) !== 0,
        ruleBottom: (flags & 4) !== 0,
        indent,
      })),
    })),
  }));
  return { v: FILL_CACHE_VERSION, grid, captions: o.c ?? [], zeroDash: !!o.z, head: o.h ?? "" };
}
