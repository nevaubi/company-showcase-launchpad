/**
 * FRED series: titles from each series' own FRED page, with the store's series catalogue as the
 * fallback.
 *
 * Every single-series FRED table carries `source_id` FRED_<code>. Its title is the `og:title` of
 * https://fred.stlouisfed.org/series/<code> as FRED serves it. When that page cannot be read, the
 * title is the Metric of the store's own series catalogue (`fred-catalogue.json`, copied from the
 * five `series_catalogue` tables, whose Source URL is that same page), except where the kit cut
 * the Metric at an apostrophe: a Metric that more than two series share ("Manufacturers" for nine
 * series) or whose last part after a colon is one plural word ("...: Owners") is not used.
 */
import catalogue from "./fred-catalogue.json";
import { decodeEntities, listingTitle } from "./text";
import type { DatasetRow, Family, FamilyResult, Page } from "./types";

const PAGE = "https://fred.stlouisfed.org/series/";

export function fredCode(d: Pick<DatasetRow, "source_id">): string | null {
  const m = /^FRED_([A-Z0-9]+)$/.exec(d.source_id ?? "");
  return m ? m[1] : null;
}

export function fredPage(code: string): string {
  return `${PAGE}${code}`;
}

/** The series title FRED states in the page's `og:title`, or null. */
export function parseFredTitle(html: string): string | null {
  const m = /<meta property="og:title" content="([^"]*)"/.exec(html);
  if (!m) return null;
  const title = listingTitle(decodeEntities(m[1]));
  return title || null;
}

type CatalogueRow = [number, string, string];
type Catalogue = { catalogues: { dataset: string; snapshot: string; rows: CatalogueRow[] }[] };

/** Metric by series code, without the Metrics the kit cut short. */
export function catalogueTitles(doc: Catalogue): Map<string, string> {
  const byCode = new Map<string, Set<string>>();
  const codesByMetric = new Map<string, Set<string>>();
  for (const c of doc.catalogues) {
    for (const [, code, metric] of c.rows) {
      if (!byCode.has(code)) byCode.set(code, new Set());
      byCode.get(code)!.add(metric);
      if (!codesByMetric.has(metric)) codesByMetric.set(metric, new Set());
      codesByMetric.get(metric)!.add(code);
    }
  }
  const out = new Map<string, string>();
  for (const [code, metrics] of byCode) {
    if (metrics.size !== 1) continue;
    const metric = [...metrics][0];
    if (isCut(metric, codesByMetric.get(metric)!.size)) continue;
    out.set(code, metric);
  }
  return out;
}

export function isCut(metric: string, sharedBy: number): boolean {
  if (sharedBy > 2) return true;
  const last = metric.split(": ").pop() ?? metric;
  return /^[A-Z][a-z]+s$/.test(last.trim());
}

const CATALOGUE = catalogueTitles(catalogue as unknown as Catalogue);

export function buildFred(candidates: DatasetRow[], pages: Map<string, Page>, fallback = CATALOGUE): FamilyResult {
  const result: FamilyResult = { titles: {}, unmatched: [] };
  for (const d of candidates) {
    const code = fredCode(d)!;
    const url = fredPage(code);
    const page = pages.get(url);
    const fromPage = page && page.status === 200 ? parseFredTitle(page.body) : null;
    const title = fromPage ?? fallback.get(code) ?? null;
    if (!title) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "FRED page not read and no usable catalogue title" });
      continue;
    }
    result.titles[d.id] = { title, code, source: url };
  }
  return result;
}

export const fredFamily: Family = {
  id: "fred",
  candidates: (datasets) => datasets.filter((d) => fredCode(d) !== null),
  listings: (candidates) => [...new Set(candidates.map((d) => fredPage(fredCode(d)!)))].sort(),
  build: (candidates, pages) => buildFred(candidates, pages),
};
