/**
 * USGS Historical Statistics for Mineral and Material Commodities (Data Series 140): titles from
 * the National Minerals Information Center's own listing.
 *
 * The listing is one table: commodity, a link to the workbook, the update year. The link goes to
 * the workbook itself (`.../ds140-abran.xlsx`) or to a USGS file page that links it
 * (`/media/files/copper-historical-statistics-data-series-140`, which links
 * `ds140-copper-2020.xlsx`); each file page is read once. The kit stored one table per worksheet
 * and named it "DS140 " + the file name with its marks turned into spaces + " " + the sheet name
 * ("DS140 ds140 copper 2020 Copper"). A stored table matches a workbook when its name starts with
 * that file stem; the sheet name is what follows. The title is the listing's commodity, and the
 * sheet after a colon where the sheet is not the commodity itself ("Nickel: Consumption").
 */
import { listingTitle, stripTags } from "./text";
import type { DatasetRow, Family, FamilyResult, Page } from "./types";

export const USGS_LISTING =
  "https://www.usgs.gov/centers/national-minerals-information-center/historical-statistics-mineral-commodities-united";
const USGS_HOST = "https://www.usgs.gov";

export type UsgsRow = { commodity: string; href: string; year: string };

/** "Abrasives (natural)-(discontinued- see garnet, industrial)" names the commodity "Abrasives (natural)". */
export function commodityName(raw: string): string {
  return listingTitle(raw.replace(/\s*-?\s*\(\s*discontinued[^)]*\)\s*$/i, ""));
}

export function parseUsgsListing(html: string): UsgsRow[] {
  const rows: UsgsRow[] = [];
  for (const m of html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1]);
    if (cells.length < 3) continue;
    const href = /href="([^"]+)"/.exec(cells[1])?.[1];
    const commodity = commodityName(stripTags(cells[0]));
    const year = listingTitle(stripTags(cells[2]));
    if (!href || !commodity || /^commodity$/i.test(commodity)) continue;
    rows.push({ commodity, href: href.startsWith("/") ? `${USGS_HOST}${href}` : href, year });
  }
  return rows;
}

/** The workbook a USGS file page links. */
export function parseUsgsFilePage(html: string): string | null {
  return /href="(https:\/\/[^"]+\.xlsx)"/i.exec(html)?.[1] ?? null;
}

/** "ds140-construction-sand-and%20gravel-2022.xlsx" as the kit wrote it: "ds140 construction sand and 20gravel 2022". */
export function fileStem(url: string): string {
  const file = url.split("?")[0].split("/").pop() ?? "";
  return file
    .replace(/\.xlsx$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w && w !== "statistics"),
  );
}

/**
 * The commodity alone when the sheet only restates it ("Copper" in Copper, "Lithium statistics" in
 * Lithium, "Crushed stone" in "Stone (crushed)"); otherwise the commodity and the sheet.
 */
export function usgsTitle(commodity: string, sheet: string): string {
  const named = words(commodity);
  const restates = [...words(sheet)].every((w) => named.has(w));
  return restates ? commodity : `${commodity}: ${sheet}`;
}

const isWorkbook = (href: string) => /\.xlsx(\?|$)/i.test(href);

export function buildUsgs(candidates: DatasetRow[], pages: Map<string, Page>): FamilyResult {
  const result: FamilyResult = { titles: {}, unmatched: [] };
  const listing = pages.get(USGS_LISTING);
  if (!listing || listing.status !== 200) {
    for (const d of candidates) result.unmatched.push({ id: d.id, name: d.name, reason: `listing answered ${listing?.status ?? "nothing"}` });
    return result;
  }
  const workbooks: { stem: string; row: UsgsRow }[] = [];
  for (const row of parseUsgsListing(listing.body)) {
    let file: string | null = isWorkbook(row.href) ? row.href : null;
    if (!file) {
      const page = pages.get(row.href);
      file = page && page.status === 200 ? parseUsgsFilePage(page.body) : null;
    }
    if (file) workbooks.push({ stem: fileStem(file), row });
  }
  workbooks.sort((a, b) => b.stem.length - a.stem.length);
  const matched: { id: string; commodity: string; sheet: string; stem: string }[] = [];
  for (const d of candidates) {
    const name = d.name.trim();
    const lower = name.toLowerCase();
    const hit = workbooks.find((w) => lower.startsWith(`ds140 ${w.stem} `));
    const sheet = hit ? name.slice(`ds140 ${hit.stem} `.length).trim() : "";
    if (!hit || !sheet) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "no workbook in the USGS listing has this file name" });
      continue;
    }
    matched.push({ id: d.id, commodity: hit.row.commodity, sheet: listingTitle(sheet), stem: hit.stem });
  }
  // Two sheets that both restate the commodity ("Bauxite" and "Alumina" in "Bauxite and alumina")
  // keep their sheet names, so no two tables share a title.
  const short = new Map<string, number>();
  for (const m of matched) {
    const title = usgsTitle(m.commodity, m.sheet);
    short.set(title, (short.get(title) ?? 0) + 1);
  }
  for (const m of matched) {
    const title = usgsTitle(m.commodity, m.sheet);
    result.titles[m.id] = {
      title: short.get(title)! > 1 ? `${m.commodity}: ${m.sheet}` : title,
      code: `DS140 ${m.stem.replace(/^ds140 /, "").replace(/ /g, "-")}`,
      source: USGS_LISTING,
    };
  }
  return result;
}

export const usgsFamily: Family = {
  id: "usgs-ds140",
  candidates: (datasets) => datasets.filter((d) => d.source_id === "USGS_DS140" && /^DS140 ds140 /i.test(d.name.trim())),
  listings: () => [USGS_LISTING],
  more: (_candidates, pages) => {
    const listing = pages.get(USGS_LISTING);
    if (!listing || listing.status !== 200) return [];
    return parseUsgsListing(listing.body)
      .map((row) => row.href)
      .filter((href) => !isWorkbook(href) && href.startsWith(`${USGS_HOST}/media/files/`));
  },
  build: buildUsgs,
};
