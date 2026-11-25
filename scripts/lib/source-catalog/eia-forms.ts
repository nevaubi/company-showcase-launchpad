/**
 * EIA electricity forms: titles from EIA's own page for each form.
 *
 * - Form EIA-860 (https://www.eia.gov/electricity/data/eia860/) lists the files of its data
 *   package ("3_1_GeneratorYyyyy") and the tabs of each ("The Operable tab includes ..."). The kit
 *   named a stored table "EIA860 " + the file name with its marks turned into spaces + " Y2025 " +
 *   the tab. A table is titled when its file is listed and its tab is one the page names for that
 *   file (files the page lists without tabs have one sheet, kept as stored). Title: file subject,
 *   tab, year ("Generator, Operable, 2025").
 * - Form EIA-861 (https://www.eia.gov/electricity/data/eia861/) lists its data files by name
 *   ("Demand Response"). A stored "EIA861 Demand Response 2025 Demand Response States" is titled
 *   when the words between "EIA861" and the year are exactly a listed name; the sheet part follows,
 *   without the name repeated ("Demand Response, States, 2025"). Abbreviated files ("Sales Ult
 *   Cust", "Advanced Meters") match no listed name and keep their stored names.
 * - Form EIA-923's page names its schedules but no file or page of the workbook the kit read, so
 *   no EIA-923 table is titled here.
 */
import { decodeEntities, listingTitle } from "./text";
import type { DatasetRow, Family, FamilyResult, Page } from "./types";

export const EIA860_PAGE = "https://www.eia.gov/electricity/data/eia860/";
export const EIA861_PAGE = "https://www.eia.gov/electricity/data/eia861/";

export type Eia860File = { file: string; subject: string; key: string; tabs: string[] };

const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const squash = (text: string) => norm(text).replace(/ /g, "");

/** The files of the EIA-860 package as the page lists them, with the tabs it names for each. */
export function parse860(html: string): Eia860File[] {
  const start = html.indexOf("contain the following files");
  if (start < 0) return [];
  const end = html.indexOf("Superseded Form EIA-860A", start);
  const part = html.slice(start, end > start ? end : undefined);
  const files: Eia860File[] = [];
  const entries = [...part.matchAll(/<li><strong>([^<]+)<\/strong>([\s\S]*?)(?=<li><strong>|$)/g)];
  for (const m of entries) {
    const file = decodeEntities(m[1]).trim();
    const stem = /^(\d)_([\d_]*)(.+?)Yyyyy$/.exec(file);
    if (!stem) continue;
    const numbers = `${stem[1]} ${stem[2].replace(/_/g, " ")}`.replace(/\s+/g, " ").trim();
    const subject = listingTitle(stem[3].replace(/_/g, " "));
    const tabs: string[] = [];
    for (const t of m[2].matchAll(/<li>The <em>([^<]+)<\/em>/g)) tabs.push(listingTitle(decodeEntities(t[1])));
    files.push({ file, subject, key: norm(`${numbers} ${subject}`), tabs });
  }
  return files;
}

/** The data files EIA-861's page lists by name. */
export function parse861(html: string): string[] {
  return [...html.matchAll(/<li class="head">([^<]+)<\/li>/g)].map((m) => listingTitle(decodeEntities(m[1])));
}

function missing(candidates: DatasetRow[], page: Page | undefined, result: FamilyResult): boolean {
  if (page && page.status === 200) return false;
  for (const d of candidates) result.unmatched.push({ id: d.id, name: d.name, reason: `page answered ${page?.status ?? "nothing"}` });
  return true;
}

export function build860(candidates: DatasetRow[], page: Page | undefined): FamilyResult {
  const result: FamilyResult = { titles: {}, unmatched: [] };
  if (missing(candidates, page, result)) return result;
  const files = parse860(page!.body).sort((a, b) => b.key.length - a.key.length);
  for (const d of candidates) {
    const m = /^EIA860 (.+?) Y(\d{4}) (.+)$/.exec(d.name.trim());
    const file = m ? files.find((f) => f.key === norm(m[1])) : undefined;
    if (!m || !file) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "file not in EIA-860's list of data files" });
      continue;
    }
    const year = m[2];
    const stored = m[3].trim();
    // A file listed with tabs: the stored tab must be one of them, written as the page writes it.
    // A file listed without tabs has one sheet, which must be named like the file.
    let tab: string | null = null;
    if (file.tabs.length) tab = file.tabs.find((t) => squash(t) === squash(stored)) ?? null;
    else if (squash(stored) === squash(file.subject)) tab = "";
    if (tab === null) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "tab not named on EIA-860's page for this file" });
      continue;
    }
    result.titles[d.id] = {
      title: tab ? `${file.subject}, ${tab}, ${year}` : `${file.subject}, ${year}`,
      code: `EIA-860 ${file.file.replace(/Yyyyy$/, `Y${year}`)}`,
      source: page!.url,
    };
  }
  return result;
}

export function build861(candidates: DatasetRow[], page: Page | undefined): FamilyResult {
  const result: FamilyResult = { titles: {}, unmatched: [] };
  if (missing(candidates, page, result)) return result;
  const names = parse861(page!.body);
  for (const d of candidates) {
    const m = /^EIA861 (.+?) (\d{4}) (.+)$/.exec(d.name.trim());
    const listed = m ? names.find((n) => norm(n) === norm(m[1])) : undefined;
    if (!m || !listed) {
      result.unmatched.push({ id: d.id, name: d.name, reason: "file name not in EIA-861's list of data files" });
      continue;
    }
    const year = m[2];
    let rest = m[3].trim();
    if (norm(rest) === norm(listed)) rest = "";
    else if (norm(rest).startsWith(`${norm(listed)} `)) rest = rest.split(/\s+/).slice(listed.split(/[\s-]+/).length).join(" ");
    result.titles[d.id] = { title: rest ? `${listed}, ${rest}, ${year}` : `${listed}, ${year}`, source: page!.url };
  }
  return result;
}

export const eia860Family: Family = {
  id: "eia-860",
  candidates: (datasets) => datasets.filter((d) => (d.source_id ?? "").startsWith("EIA860_") && /^EIA860 /.test(d.name)),
  listings: () => [EIA860_PAGE],
  build: (candidates, pages) => build860(candidates, pages.get(EIA860_PAGE)),
};

export const eia861Family: Family = {
  id: "eia-861",
  candidates: (datasets) => datasets.filter((d) => (d.source_id ?? "").startsWith("EIA861_") && /^EIA861 /.test(d.name)),
  listings: () => [EIA861_PAGE],
  build: (candidates, pages) => build861(candidates, pages.get(EIA861_PAGE)),
};

