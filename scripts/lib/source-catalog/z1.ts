/**
 * Financial Accounts of the United States (Z.1): titles from the Board's own table listing.
 *
 * The listing (`current/html/default.htm`) is a set of tables. Each row names a table ("Interbank
 * assets and liabilities") and each cell links one table file with its code in the link title
 * ("F2.1.t: Interbank assets and liabilities"). The column header says which table of the row the
 * cell is: Transactions, Stocks, Balance Sheets, Changes in Net Worth, Annual, Quarterly, or Table
 * for rows with one table. A stored table matches a cell when its file stem, as the kit wrote it
 * into the dataset id, is the cell's file name in lower case (`f2_1_t` and `F2_1_t.htm`).
 *
 * The CSV package also holds files the listing does not show: unadjusted transactions (`*_t_tu`)
 * and the annual and quarterly matrix files (`M3s_A`, `M3t_Q`). They get no title here.
 */
import { listingTitle, stripTags } from "./text";
import type { DatasetRow, Family, FamilyResult, Page } from "./types";

export const Z1_LISTING = "https://www.federalreserve.gov/releases/z1/current/html/default.htm";

export type Z1Cell = {
  /** File name without `.htm`, as linked: "F2_1_t". */
  file: string;
  /** The Board's table code: "F2.1.t". */
  code: string;
  /** The row's title as the link states it. */
  title: string;
  /** The column header of the cell: "Transactions", "Stocks", "Table", ... */
  column: string;
  /** The heading of the listing section: "Sectors", "Integrated macroeconomic accounts for the United States". */
  section: string;
};

const STEM = /^official_01_financials_data_fed_z1_native_tables_csv_(.+)_[0-9a-f]{10}$/;

export function z1Stem(id: string): string | null {
  const m = STEM.exec(id);
  return m ? m[1] : null;
}

/** Every table cell of the listing, in page order. */
export function parseZ1Listing(html: string): Z1Cell[] {
  const cells: Z1Cell[] = [];
  const sections = html.split(/<h5 class="tablehead"[^>]*>/).slice(1);
  for (const part of sections) {
    const section = listingTitle(stripTags(part.slice(0, part.indexOf("</h5>"))));
    const headers = new Map<string, string>();
    for (const m of part.matchAll(/<th id="(t\d+r0c\d+)"[^>]*>([\s\S]*?)<\/th>/g)) {
      headers.set(m[1], listingTitle(stripTags(m[2])));
    }
    const cell = /<td id="[^"]+" headers="(t\d+r0c\d+) [^"]*"[^>]*>\s*<a href="([^"/]+)\.htm" title="([^"]+)">([^<]+)<\/a>/g;
    for (const m of part.matchAll(cell)) {
      const linkTitle = m[3];
      const colon = linkTitle.indexOf(": ");
      if (colon < 0) continue;
      const code = linkTitle.slice(0, colon).trim();
      if (code !== m[4].trim()) continue;
      cells.push({
        file: m[2],
        code,
        title: listingTitle(linkTitle.slice(colon + 2)),
        column: headers.get(m[1]) ?? "",
        section,
      });
    }
  }
  return cells;
}

const INTEGRATED = /^Integrated macroeconomic accounts/i;

/** The title a reader sees: the row's title and, where a row holds several tables, which one. */
export function z1Title(cell: Z1Cell): string {
  const column = cell.column.toLowerCase();
  if (!column || column === "table") return cell.title;
  if (INTEGRATED.test(cell.section)) return `${cell.title} (integrated macroeconomic accounts, ${column})`;
  return `${cell.title}, ${column}`;
}

export function buildZ1(candidates: DatasetRow[], page: Page | undefined): FamilyResult {
  const result: FamilyResult = { titles: {}, unmatched: [] };
  if (!page || page.status !== 200) {
    for (const d of candidates) result.unmatched.push({ id: d.id, name: d.name, reason: `listing answered ${page?.status ?? "nothing"}` });
    return result;
  }
  const byFile = new Map<string, Z1Cell>();
  for (const cell of parseZ1Listing(page.body)) {
    const key = cell.file.toLowerCase();
    if (!byFile.has(key)) byFile.set(key, cell);
  }
  for (const d of candidates) {
    const stem = z1Stem(d.id);
    const cell = stem ? byFile.get(stem) : undefined;
    if (!cell) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "no table of this file name in the Board's listing" });
      continue;
    }
    result.titles[d.id] = { title: z1Title(cell), code: `Z.1 ${cell.code}`, source: page.url };
  }
  return result;
}

export const z1Family: Family = {
  id: "fed-z1",
  candidates: (datasets) => datasets.filter((d) => z1Stem(d.id) !== null),
  listings: () => [Z1_LISTING],
  build: (candidates, pages) => buildZ1(candidates, pages.get(Z1_LISTING)),
};
