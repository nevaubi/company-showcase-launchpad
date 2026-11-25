/**
 * EIA Monthly Energy Review: titles from EIA's own table list on the MER page.
 *
 * The page links every table's CSV as `csv.php?tbl=T01.01` with the link title
 * "Table 1.1 Primary energy overview". A stored MER table is titled when it is one of the single
 * tables the kit read from that CSV address: its id is a `raw_mer_t...` table, its stored address
 * is the CSV link of that table, and its stored name carries the same table id. The union and
 * derived MER tables all carry the address of table 1.1 (audit M4), so they are never matched.
 */
import { listingTitle } from "./text";
import type { DatasetRow, Family, FamilyResult, Page } from "./types";

export const MER_LISTING = "https://www.eia.gov/totalenergy/data/monthly/";
const CSV_BASE = "https://www.eia.gov/totalenergy/data/browser/csv.php?tbl=";

export type MerTable = { tbl: string; number: string; title: string };

const PREFERENCE = ["csv", "xls", "index"] as const;

/**
 * One entry per table id. The title is read from the table's CSV link, or, where that link carries
 * no title (table 4.4), from its XLS or browser link on the same list entry.
 */
export function parseMerListing(html: string): MerTable[] {
  const found = new Map<string, Map<string, string>>();
  const order: string[] = [];
  const link = /<a href="\/totalenergy\/data\/browser\/(csv|xls|index)\.php\?tbl=([A-Za-z0-9.]+)[^"]*" title="([^"]*)"/g;
  for (const m of html.matchAll(link)) {
    const [, kind, tbl, title] = m;
    if (!found.has(tbl)) {
      found.set(tbl, new Map());
      order.push(tbl);
    }
    const titles = found.get(tbl)!;
    if (!titles.has(kind)) titles.set(kind, title.replace(/\s+-\s+View in Total Energy Browser\s*$/, ""));
  }
  const out: MerTable[] = [];
  for (const tbl of order) {
    const titles = found.get(tbl)!;
    const raw = PREFERENCE.map((kind) => titles.get(kind)).find((t) => t && t.trim());
    if (!raw) continue;
    const parts = /^Table ([0-9A-Z][0-9A-Za-z.]*?)\.?\s+(.+)$/.exec(listingTitle(raw));
    if (parts) out.push({ tbl, number: parts[1], title: parts[2] });
  }
  return out;
}

const RAW = /^official_04_energy_raw_mer_t[0-9a-z_]+_[0-9a-f]{10}$/;

function storedTable(d: DatasetRow): string | null {
  const m = /^MER (T[0-9A-Za-z.]+)$/.exec(d.name.trim());
  return m ? m[1] : null;
}

export function buildMer(candidates: DatasetRow[], page: Page | undefined): FamilyResult {
  const result: FamilyResult = { titles: {}, unmatched: [] };
  if (!page || page.status !== 200) {
    for (const d of candidates) result.unmatched.push({ id: d.id, name: d.name, reason: `listing answered ${page?.status ?? "nothing"}` });
    return result;
  }
  const byTbl = new Map(parseMerListing(page.body).map((t) => [t.tbl.toUpperCase(), t]));
  for (const d of candidates) {
    const named = storedTable(d);
    const url = d.source_url ?? "";
    const fromUrl = url.startsWith(CSV_BASE) ? url.slice(CSV_BASE.length) : null;
    if (!RAW.test(d.id) || !named || !fromUrl || named.toUpperCase() !== fromUrl.toUpperCase()) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "not a single MER table read from its own CSV address" });
      continue;
    }
    const table = byTbl.get(fromUrl.toUpperCase());
    if (!table) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "table id not in EIA's table list" });
      continue;
    }
    result.titles[d.id] = { title: table.title, code: `MER ${table.number}`, source: page.url };
  }
  return result;
}

export const merFamily: Family = {
  id: "eia-mer",
  candidates: (datasets) => datasets.filter((d) => d.source_id === "EIA_MER"),
  listings: () => [MER_LISTING],
  build: (candidates, pages) => buildMer(candidates, pages.get(MER_LISTING)),
};
