// Orange Book patents and exclusivity of a company's own new drug applications, pure and browser-safe.
// The link is the FDA application number the company's FDA panel already carries (`alt_data` meta.application,
// stored only for a sponsor that is the company, src/lib/alt/firms.ts); the Orange Book tables carry the same
// number (`Appl_No`, also their entity index). A row is shown only while the Orange Book's applicant is the firm
// the FDA panel names. Dates are shown as the FDA prints them; nothing is forecast.
import type { OfficialSource, RecordPointer } from "./types";

export const OB_PRODUCTS = "official_03_healthcare_csv_ob_products_full_ff14d89a4b";
export const OB_PATENTS = "official_03_healthcare_csv_ob_patent_63776478d4";
export const OB_EXCLUSIVITY = "official_03_healthcare_csv_ob_exclusivity_b108a0e8e8";

/** Field labels as the stored files print them, with their positions in the 24 Nov 2026 files as hints. */
export const OB_PRODUCT_FIELDS = [
  { label: "Ingredient", hint: 0 },
  { label: "DF;Route", hint: 1 },
  { label: "Trade_Name", hint: 2 },
  { label: "Applicant", hint: 3 },
  { label: "Strength", hint: 4 },
  { label: "Appl_Type", hint: 5 },
  { label: "Appl_No", hint: 6 },
  { label: "Product_No", hint: 7 },
  { label: "Approval_Date", hint: 9 },
  { label: "Applicant_Full_Name", hint: 13 },
] as const;
export const OB_PATENT_FIELDS = [
  { label: "Appl_Type", hint: 0 },
  { label: "Appl_No", hint: 1 },
  { label: "Product_No", hint: 2 },
  { label: "Patent_No", hint: 3 },
  { label: "Patent_Expire_Date_Text", hint: 4 },
  { label: "Drug_Substance_Flag", hint: 5 },
  { label: "Drug_Product_Flag", hint: 6 },
  { label: "Patent_Use_Code", hint: 7 },
  { label: "Delist_Flag", hint: 8 },
] as const;
export const OB_EXCLUSIVITY_FIELDS = [
  { label: "Appl_Type", hint: 0 },
  { label: "Appl_No", hint: 1 },
  { label: "Product_No", hint: 2 },
  { label: "Exclusivity_Code", hint: 3 },
  { label: "Exclusivity_Date", hint: 4 },
] as const;

/** Shown on screen with every Orange Book block (research section 4.3). */
export const OB_CAVEAT =
  "New drug applications already on this panel, no biologics. Shown while the Orange Book's applicant is the firm the approvals above name. An expiry is the date the FDA lists, not a forecast of generic entry.";

/** The most applications one read takes (the largest FDA panel holds fewer). */
export const OB_MAX_APPLICATIONS = 200;

export interface ObAsk {
  /** Six digits, as the Orange Book prints the application number. */
  appl: string;
  /** The firm the FDA panel names for it (Drugs@FDA sponsor). */
  sponsor: string;
}

/** The company's new drug applications on its FDA panel, from the panel's own rows; biologics and generics left out. */
export function obAsks(rows: { dataset: string; meta?: unknown }[]): ObAsk[] {
  const out = new Map<string, ObAsk>();
  for (const r of rows) {
    if (r.dataset !== "fda" || !r.meta || typeof r.meta !== "object") continue;
    const m = r.meta as Record<string, unknown>;
    const app = typeof m.application === "string" ? m.application.trim().toUpperCase() : "";
    const sponsor = typeof m.sponsor === "string" ? m.sponsor.trim() : "";
    const hit = app.match(/^NDA(\d{6})$/);
    if (!hit || !sponsor) continue;
    if (!out.has(hit[1])) out.set(hit[1], { appl: hit[1], sponsor });
  }
  return [...out.values()].sort((a, b) => a.appl.localeCompare(b.appl)).slice(0, OB_MAX_APPLICATIONS);
}

const MONTHS: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** "Apr 1, 2026" as an ISO day, for ordering only (the page shows the printed text); null for anything else. */
export function printedDay(text: string | null | undefined): string | null {
  const m = (text ?? "").trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
  if (!m || !MONTHS[m[1]]) return null;
  const d = Number(m[2]);
  if (d < 1 || d > 31) return null;
  return `${m[3]}-${String(MONTHS[m[1]]).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export interface ObProduct {
  productNo: string;
  trade: string;
  ingredient: string;
  strength: string;
  form: string;
  approval: string;
  applicant: string;
  applicantFull: string;
  ref: RecordPointer;
}
/** One listed patent as the Orange Book prints it, with every stored row that lists it. */
export interface ObPatent {
  patent: string;
  expiry: string;
  expiryDay: string | null;
  substance: boolean;
  drugProduct: boolean;
  delisted: boolean;
  /** Product numbers and use codes across its rows. */
  products: string[];
  useCodes: string[];
  refs: RecordPointer[];
}
export interface ObExclusivity {
  code: string;
  date: string;
  dateDay: string | null;
  products: string[];
  refs: RecordPointer[];
}
export interface ObApplication {
  appl: string;
  sponsor: string;
  trade: string[];
  ingredient: string[];
  applicant: string;
  applicantFull: string[];
  products: ObProduct[];
  patents: ObPatent[];
  exclusivity: ObExclusivity[];
}
export interface ObWithheld {
  appl: string;
  sponsor: string;
  applicants: string[];
  why: string;
}
export interface CompanyPatents {
  ticker: string;
  sources: { products: OfficialSource; patents: OfficialSource; exclusivity: OfficialSource };
  /** Applications asked about (the FDA panel's new drug applications). */
  asked: number;
  applications: ObApplication[];
  /** Applications with Orange Book rows that are not shown, and why. */
  withheld: ObWithheld[];
  /** True when a table answered with as many rows as one read returns, so some rows may be missing. */
  partial: boolean;
}
export type CompanyPatentsResult = { ok: true; data: CompanyPatents } | { ok: false; reason: string };

type PatentRow = { appl: string; productNo: string; patent: string; expiry: string; substance: boolean; drugProduct: boolean; use: string; delisted: boolean; ref: RecordPointer };
type ExclusivityRow = { appl: string; productNo: string; code: string; date: string; ref: RecordPointer };

const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();

/** Rows listing the same patent with the same date and flags are one line, keeping every row's reference. */
export function groupPatents(rows: PatentRow[]): ObPatent[] {
  const by = new Map<string, ObPatent>();
  for (const r of rows) {
    const key = [r.patent, r.expiry, r.substance, r.drugProduct, r.delisted].join("|");
    const g = by.get(key) ?? { patent: r.patent, expiry: r.expiry, expiryDay: printedDay(r.expiry), substance: r.substance, drugProduct: r.drugProduct, delisted: r.delisted, products: [], useCodes: [], refs: [] };
    g.products = uniq([...g.products, r.productNo]);
    g.useCodes = uniq([...g.useCodes, r.use]);
    g.refs.push(r.ref);
    by.set(key, g);
  }
  return [...by.values()].sort((a, b) => (b.expiryDay ?? "").localeCompare(a.expiryDay ?? "") || a.patent.localeCompare(b.patent));
}

export function groupExclusivity(rows: ExclusivityRow[]): ObExclusivity[] {
  const by = new Map<string, ObExclusivity>();
  for (const r of rows) {
    const key = `${r.code}|${r.date}`;
    const g = by.get(key) ?? { code: r.code, date: r.date, dateDay: printedDay(r.date), products: [], refs: [] };
    g.products = uniq([...g.products, r.productNo]);
    g.refs.push(r.ref);
    by.set(key, g);
  }
  return [...by.values()].sort((a, b) => (b.dateDay ?? "").localeCompare(a.dateDay ?? "") || a.code.localeCompare(b.code));
}

/** The latest listed patent expiry and exclusivity date of an application, as printed (or null). */
export function lastListed(a: ObApplication): { patent: ObPatent | null; exclusivity: ObExclusivity | null } {
  const patent = a.patents.filter(p => !p.delisted && p.expiryDay).sort((x, y) => y.expiryDay!.localeCompare(x.expiryDay!))[0] ?? null;
  const exclusivity = a.exclusivity.filter(e => e.dateDay).sort((x, y) => y.dateDay!.localeCompare(x.dateDay!))[0] ?? null;
  return { patent, exclusivity };
}

export type { ExclusivityRow, PatentRow };
