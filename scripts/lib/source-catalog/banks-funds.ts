/**
 * Banks and funds: SEC Form N-MFP and BDC data sets, the Federal Reserve's H.8 release and the
 * OFR Short-term Funding Monitor datasets, each titled from the publisher's own page or readme.
 *
 * - N-MFP: the SEC's readme (`nmfp_readme.pdf`, linked from the data sets page) lists every data
 *   file with one sentence ("12. COLLATERALISSUERS data provides details of collateral issuers and
 *   securities subjected to repurchase agreements, with each row having ..."). A stored "NMFP
 *   <FILE>" table takes what the sentence says the file holds, up to ", with each row" (and, where
 *   that runs on, up to its first comma), and the data set month the page lists.
 * - BDC: the readme's contents name the tables ("SUB (Submissions)", "SOI (Schedule of
 *   Investments)"); the kit's July to October 2026 tables join the four monthly data sets the page
 *   lists for those months.
 * - H.8: the release page's heading names the release; the kit's views of it are titled with that
 *   name and the kit's own words for the view.
 * - OFR: the Funding Monitor API's dataset listing names the five datasets; the kit's table of all
 *   their series is titled with the five names.
 * The FFIEC's National Information Center pages answer with a CAPTCHA to scripts, so the NIC files
 * keep their stored names.
 */
import { listingTitle } from "./text";
import type { DatasetRow, Family, FamilyResult, Page } from "./types";

export const NMFP_PAGE = "https://www.sec.gov/data-research/sec-markets-data/dera-form-n-mfp-data-sets";
export const NMFP_README = "https://www.sec.gov/files/nmfp_readme.pdf";
export const BDC_PAGE = "https://www.sec.gov/data-research/sec-markets-data/bdc-data-sets";
export const BDC_README = "https://www.sec.gov/files/bdc_readme.pdf";
export const H8_PAGE = "https://www.federalreserve.gov/releases/h8/current/";
export const OFR_DATASETS = "https://data.financialresearch.gov/v1/series/dataset";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const ok = (page: Page | undefined): page is Page => !!page && page.status === 200;

function unmatchedAll(candidates: DatasetRow[], reason: string): FamilyResult {
  return { titles: {}, unmatched: candidates.map((d) => ({ id: d.id, name: d.name, reason })) };
}

function sentenceCase(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** What each N-MFP data file holds, by file name, from the readme's numbered list. */
export function parseNmfpReadme(text: string): Map<string, string> {
  const flat = text.replace(/\s+/g, " ");
  const out = new Map<string, string>();
  const item = /\b\d{1,2}\. ([A-Z_]{3,}) (?:data )?(?:provides|contains|identifies|for)\b ([\s\S]+?)(?=, with (?:each row|no primary key)|\. \d{1,2}\. |$)/g;
  for (const m of flat.matchAll(item)) {
    const file = m[1];
    if (out.has(file)) continue;
    let phrase = m[2].trim().replace(/^(?:either |the |details of )+/i, "");
    if (phrase.length > 70 && phrase.includes(", ")) phrase = phrase.slice(0, phrase.indexOf(", "));
    out.set(file, sentenceCase(listingTitle(phrase)));
  }
  return out;
}

/** The data set months the page lists ("2026 October NMFP"), as "2026-10". */
export function listedMonths(html: string, suffix: "NMFP" | "BDC"): Set<string> {
  const out = new Set<string>();
  for (const m of html.matchAll(new RegExp(`>(\\d{4}) (${MONTHS.join("|")}) ${suffix}<`, "g"))) {
    out.add(`${m[1]}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, "0")}`);
  }
  return out;
}

export function buildNmfp(candidates: DatasetRow[], pages: Map<string, Page>): FamilyResult {
  const readme = pages.get(NMFP_README);
  const page = pages.get(NMFP_PAGE);
  if (!ok(readme) || !ok(page)) return unmatchedAll(candidates, "readme or data sets page not read");
  const files = parseNmfpReadme(readme.body);
  const months = listedMonths(page.body, "NMFP");
  const result: FamilyResult = { titles: {}, unmatched: [] };
  for (const d of candidates) {
    const file = /^NMFP ([A-Z]+)$/.exec(d.name.trim())?.[1];
    const ym = /_sec_nmfp_(\d{4})_(\d{2})_native_/.exec(d.id);
    const what = file ? files.get(file) : undefined;
    const month = ym ? `${ym[1]}-${ym[2]}` : "";
    if (!file || !what || !months.has(month)) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "file not in the readme or month not listed" });
      continue;
    }
    const label = `${MONTHS[Number(ym![2]) - 1]} ${ym![1]}`;
    result.titles[d.id] = { title: `${what}, ${label}`, code: `N-MFP ${file}`, source: NMFP_README };
  }
  return result;
}

/** The BDC readme's table names: "SUB" to "Submissions", "SOI" to "Schedule of Investments". */
export function parseBdcReadme(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/\b\d\.\d{2}\s+([A-Z]{2,4}) \(([A-Za-z ]+)\)/g)) if (!out.has(m[1])) out.set(m[1], m[2].trim());
  return out;
}

export function buildBdc(candidates: DatasetRow[], pages: Map<string, Page>): FamilyResult {
  const readme = pages.get(BDC_README);
  const page = pages.get(BDC_PAGE);
  if (!ok(readme) || !ok(page)) return unmatchedAll(candidates, "readme or data sets page not read");
  const tables = parseBdcReadme(readme.body);
  const months = listedMonths(page.body, "BDC");
  const result: FamilyResult = { titles: {}, unmatched: [] };
  for (const d of candidates) {
    const m = /_sec_bdc_(\d{4})_([a-z]{3})_([a-z]{3})_(all_submissions|full_schedule_of_investments)_/.exec(d.id);
    const table = m ? (m[4] === "all_submissions" ? "SUB" : "SOI") : null;
    const name = table ? tables.get(table) : undefined;
    const from = m ? SHORT.indexOf(m[2]) : -1;
    const to = m ? SHORT.indexOf(m[3]) : -1;
    const span = from >= 0 && to >= from ? Array.from({ length: to - from + 1 }, (_, i) => `${m![1]}-${String(from + i + 1).padStart(2, "0")}`) : [];
    if (!m || !name || !span.length || !span.every((ym) => months.has(ym))) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "table not in the readme or months not listed" });
      continue;
    }
    result.titles[d.id] = { title: `${name}, ${MONTHS[from]} to ${MONTHS[to]} ${m[1]}`, code: `BDC ${table}`, source: BDC_README };
  }
  return result;
}

/** The release name the H.8 page's heading states. */
export function parseH8Heading(html: string): string | null {
  const m = /<h2>([^<]+) - H\.8<\/h2>/.exec(html);
  return m ? listingTitle(m[1]) : null;
}

const H8_VIEW = /^(?:fed h8|Federal Reserve H\.8|H\.8)\s+(.+)$/i;

export function buildH8(candidates: DatasetRow[], pages: Map<string, Page>): FamilyResult {
  const page = pages.get(H8_PAGE);
  const release = ok(page) ? parseH8Heading(page.body) : null;
  if (!release) return unmatchedAll(candidates, "release page not read");
  const result: FamilyResult = { titles: {}, unmatched: [] };
  for (const d of candidates) {
    const view = H8_VIEW.exec(d.name.trim())?.[1]?.trim();
    if (!view) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "stored name does not name an H.8 table" });
      continue;
    }
    const whole = /complete native observations/i.test(view);
    result.titles[d.id] = { title: whole ? `${release} (H.8)` : `${release} (H.8): ${view}`, code: "H.8", source: H8_PAGE };
  }
  return result;
}

/** The five datasets of the OFR listing, as "short name" in listing order. */
export function parseOfrDatasets(json: string): string[] {
  try {
    const doc = JSON.parse(json) as Record<string, { short_name?: string }>;
    return Object.values(doc)
      .map((v) => (typeof v?.short_name === "string" ? listingTitle(v.short_name) : ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function buildOfr(candidates: DatasetRow[], pages: Map<string, Page>): FamilyResult {
  const page = pages.get(OFR_DATASETS);
  const names = ok(page) ? parseOfrDatasets(page.body) : [];
  if (names.length !== 5) return unmatchedAll(candidates, "dataset listing not read or not five datasets");
  const list = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const result: FamilyResult = { titles: {}, unmatched: [] };
  for (const d of candidates) result.titles[d.id] = { title: `${list}, all series`, source: OFR_DATASETS };
  return result;
}

export const nmfpFamily: Family = {
  id: "sec-nmfp",
  candidates: (datasets) => datasets.filter((d) => d.source_id === "SEC_NMFP" && /^NMFP [A-Z]+$/.test(d.name.trim())),
  listings: () => [NMFP_PAGE, NMFP_README],
  build: buildNmfp,
};

export const bdcFamily: Family = {
  id: "sec-bdc",
  candidates: (datasets) => datasets.filter((d) => d.source_id === "SEC_BDC" && /_(all_submissions|full_schedule_of_investments)_[0-9a-f]{10}$/.test(d.id)),
  listings: () => [BDC_PAGE, BDC_README],
  build: buildBdc,
};

export const h8Family: Family = {
  id: "fed-h8",
  candidates: (datasets) => datasets.filter((d) => d.source_id === "FED_H8"),
  listings: () => [H8_PAGE],
  build: buildH8,
};

export const ofrFamily: Family = {
  id: "ofr-stfm",
  candidates: (datasets) => datasets.filter((d) => d.source_id === "OFR_STFM" && /_ofr_all_five_datasets_complete_timeseries_/.test(d.id)),
  listings: () => [OFR_DATASETS],
  build: buildOfr,
};
