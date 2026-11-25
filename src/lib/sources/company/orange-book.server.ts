// Server read of a company's Orange Book rows: bounded selects by application number (the tables' entity index),
// fields found by label, every shown line pointing at its stored rows. Never throws to the page.
import { cellAt, fieldsOf, projection, select, sourceOf, Stop, text, type OfficialClient } from "./official.server";
import {
  groupExclusivity,
  groupPatents,
  OB_EXCLUSIVITY,
  OB_EXCLUSIVITY_FIELDS,
  OB_MAX_APPLICATIONS,
  OB_PATENT_FIELDS,
  OB_PATENTS,
  OB_PRODUCT_FIELDS,
  OB_PRODUCTS,
  type CompanyPatents,
  type CompanyPatentsResult,
  type ExclusivityRow,
  type ObApplication,
  type ObAsk,
  type ObProduct,
  type ObWithheld,
  type PatentRow,
} from "./orange-book";
import type { OfficialSource } from "./types";

const LIMIT = 1000;
const CACHE_TTL_MS = 10 * 60_000;
/** Applications kept at most; the oldest goes first, as `resultCache` in official.server.ts does. */
export const PATENTS_CACHE_LIMIT = 300;

type Rows = Record<string, unknown>[];
type ApplicationRows = { patents: Rows; exclusivity: Rows; products: Rows };
/**
 * The stored rows of one application, keyed by its number and the three snapshots read: all an answer depends on.
 * The sponsor each caller names is checked after the cache, so what a caller sends cannot grow it beyond the cap.
 */
const cache = new Map<string, { at: number; rows: ApplicationRows }>();

/** Forget cached reads (tests). */
export function resetPatentsCache() {
  cache.clear();
}

/** Applications in the cache (tests). */
export function patentsCacheSize(): number {
  return cache.size;
}

function remember(key: string, rows: ApplicationRows, at: number) {
  cache.delete(key);
  cache.set(key, { at, rows });
  while (cache.size > PATENTS_CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
}

type Read = { rows: Rows; partial: boolean };

async function readRows(db: OfficialClient, source: OfficialSource, wanted: readonly { label: string; hint: number }[], appls: string[]): Promise<Read> {
  if (!appls.length) return { rows: [], partial: false };
  const fields = await fieldsOf(db, source.snapshot, wanted);
  const missing = wanted.filter(w => !fields.has(w.label));
  if (missing.length) throw new Stop(`The stored Orange Book file lacks ${missing.map(m => m.label).join(", ")}.`);
  const cols = projection(fields, wanted.map(w => w.label));
  const rows = await select(db.from("source_records").select(`row_number,entity_id,${cols}`).eq("snapshot_id", source.snapshot).in("entity_id", appls).limit(LIMIT));
  // a new drug application whose number matches the row's own number field and the entity index
  const own = rows.filter(r => text(cellAt(r, "Appl_Type"))?.trim() === "N" && text(cellAt(r, "Appl_No"))?.trim() === text(r.entity_id));
  return { rows: own, partial: rows.length >= LIMIT };
}

/** The rows of each asked application: from the cache, the rest read in one select per table. */
async function applicationRows(db: OfficialClient, sources: CompanyPatents["sources"], appls: string[]): Promise<{ rows: Map<string, ApplicationRows>; partial: boolean }> {
  const keyOf = (appl: string) => `${appl}|${sources.patents.snapshot}|${sources.exclusivity.snapshot}|${sources.products.snapshot}`;
  const now = Date.now();
  const out = new Map<string, ApplicationRows>();
  for (const appl of appls) {
    const hit = cache.get(keyOf(appl));
    if (hit && now - hit.at < CACHE_TTL_MS) out.set(appl, hit.rows);
  }
  const missing = appls.filter(a => !out.has(a));
  if (!missing.length) return { rows: out, partial: false };
  const [patents, exclusivity] = await Promise.all([readRows(db, sources.patents, OB_PATENT_FIELDS, missing), readRows(db, sources.exclusivity, OB_EXCLUSIVITY_FIELDS, missing)]);
  const listed = [...new Set([...patents.rows, ...exclusivity.rows].map(r => text(r.entity_id) ?? ""))].filter(Boolean);
  const products = await readRows(db, sources.products, OB_PRODUCT_FIELDS, listed);
  const partial = patents.partial || exclusivity.partial || products.partial;
  const of = (rows: Rows, appl: string) => rows.filter(r => text(r.entity_id) === appl);
  for (const appl of missing) {
    const rows = { patents: of(patents.rows, appl), exclusivity: of(exclusivity.rows, appl), products: of(products.rows, appl) };
    out.set(appl, rows);
    if (!partial) remember(keyOf(appl), rows, now);
  }
  return { rows: out, partial };
}

const str = (r: Record<string, unknown>, label: string) => (text(cellAt(r, label)) ?? "").trim();
const flag = (r: Record<string, unknown>, label: string) => str(r, label).toUpperCase() === "Y";

/**
 * The Orange Book blocks of a company's new drug applications. `asks` come from the company's FDA panel (its
 * application numbers and the sponsor each names); an application is shown only when every Orange Book product row
 * of it names that sponsor as applicant.
 */
export async function readCompanyPatents(db: OfficialClient, ticker: string, asks: ObAsk[]): Promise<CompanyPatentsResult> {
  const clean = asks.filter(a => /^\d{6}$/.test(a.appl) && a.sponsor.trim()).slice(0, OB_MAX_APPLICATIONS);
  try {
    const [patentsSource, exclusivitySource, productsSource] = await Promise.all([sourceOf(db, OB_PATENTS), sourceOf(db, OB_EXCLUSIVITY), sourceOf(db, OB_PRODUCTS)]);
    const sources = { products: productsSource, patents: patentsSource, exclusivity: exclusivitySource };
    const read = await applicationRows(db, sources, [...new Set(clean.map(a => a.appl))]);
    const rowsOf = (appl: string) => read.rows.get(appl) ?? { patents: [], exclusivity: [], products: [] };
    const listed = [...read.rows].filter(([, r]) => r.patents.length || r.exclusivity.length).map(([appl]) => appl);
    const ref = (src: OfficialSource, r: Record<string, unknown>) => ({ dataset: src.dataset, snapshot: src.snapshot, row: Number(r.row_number) });

    const applications: ObApplication[] = [];
    const withheld: ObWithheld[] = [];
    for (const ask of clean.filter(a => listed.includes(a.appl))) {
      const prows = rowsOf(ask.appl).products;
      const applicants = [...new Set(prows.map(r => str(r, "Applicant")))].sort();
      if (!prows.length) {
        withheld.push({ appl: ask.appl, sponsor: ask.sponsor, applicants, why: "The Orange Book lists no product for it." });
        continue;
      }
      if (applicants.length !== 1 || applicants[0].toUpperCase() !== ask.sponsor.trim().toUpperCase()) {
        withheld.push({ appl: ask.appl, sponsor: ask.sponsor, applicants, why: "The Orange Book's applicant is not the firm the FDA panel names." });
        continue;
      }
      const productList: ObProduct[] = prows
        .map(r => ({ productNo: str(r, "Product_No"), trade: str(r, "Trade_Name"), ingredient: str(r, "Ingredient"), strength: str(r, "Strength"), form: str(r, "DF;Route"), approval: str(r, "Approval_Date"), applicant: str(r, "Applicant"), applicantFull: str(r, "Applicant_Full_Name"), ref: ref(productsSource, r) }))
        .sort((a, b) => a.productNo.localeCompare(b.productNo));
      const patentRows: PatentRow[] = rowsOf(ask.appl).patents
        .map(r => ({ appl: ask.appl, productNo: str(r, "Product_No"), patent: str(r, "Patent_No"), expiry: str(r, "Patent_Expire_Date_Text"), substance: flag(r, "Drug_Substance_Flag"), drugProduct: flag(r, "Drug_Product_Flag"), use: str(r, "Patent_Use_Code"), delisted: flag(r, "Delist_Flag"), ref: ref(patentsSource, r) }));
      const exclusivityRows: ExclusivityRow[] = rowsOf(ask.appl).exclusivity
        .map(r => ({ appl: ask.appl, productNo: str(r, "Product_No"), code: str(r, "Exclusivity_Code"), date: str(r, "Exclusivity_Date"), ref: ref(exclusivitySource, r) }));
      applications.push({
        appl: ask.appl,
        sponsor: ask.sponsor,
        trade: [...new Set(productList.map(p => p.trade))].sort(),
        ingredient: [...new Set(productList.map(p => p.ingredient))].sort(),
        applicant: applicants[0],
        applicantFull: [...new Set(productList.map(p => p.applicantFull))].filter(Boolean).sort(),
        products: productList,
        patents: groupPatents(patentRows),
        exclusivity: groupExclusivity(exclusivityRows),
      });
    }
    applications.sort((a, b) => (a.trade[0] ?? "").localeCompare(b.trade[0] ?? "") || a.appl.localeCompare(b.appl));
    const value: CompanyPatents = { ticker: ticker.toUpperCase(), sources, asked: clean.length, applications, withheld, partial: read.partial };
    return { ok: true, data: value };
  } catch (e) {
    return { ok: false, reason: e instanceof Stop ? e.message : "The Orange Book records could not be read." };
  }
}
