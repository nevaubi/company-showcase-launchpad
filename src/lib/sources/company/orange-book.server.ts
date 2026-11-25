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
const cache = new Map<string, { at: number; value: CompanyPatents }>();

/** Forget cached reads (tests). */
export function resetPatentsCache() {
  cache.clear();
}

type Read = { source: OfficialSource; rows: Record<string, unknown>[]; partial: boolean };

async function readTable(db: OfficialClient, dataset: string, wanted: readonly { label: string; hint: number }[], appls: string[]): Promise<Read> {
  const source = await sourceOf(db, dataset);
  if (!appls.length) return { source, rows: [], partial: false };
  const fields = await fieldsOf(db, source.snapshot, wanted);
  const missing = wanted.filter(w => !fields.has(w.label));
  if (missing.length) throw new Stop(`The stored Orange Book file lacks ${missing.map(m => m.label).join(", ")}.`);
  const cols = projection(fields, wanted.map(w => w.label));
  const rows = await select(db.from("source_records").select(`row_number,entity_id,${cols}`).eq("snapshot_id", source.snapshot).in("entity_id", appls).limit(LIMIT));
  // a new drug application whose number matches the row's own number field and the entity index
  const own = rows.filter(r => text(cellAt(r, "Appl_Type"))?.trim() === "N" && text(cellAt(r, "Appl_No"))?.trim() === text(r.entity_id));
  return { source, rows: own, partial: rows.length >= LIMIT };
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
  const key = `${ticker.toUpperCase()}|${clean.map(a => `${a.appl}:${a.sponsor}`).join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return { ok: true, data: hit.value };
  try {
    const appls = clean.map(a => a.appl);
    const [patents, exclusivity] = await Promise.all([readTable(db, OB_PATENTS, OB_PATENT_FIELDS, appls), readTable(db, OB_EXCLUSIVITY, OB_EXCLUSIVITY_FIELDS, appls)]);
    const listed = [...new Set([...patents.rows, ...exclusivity.rows].map(r => text(r.entity_id) ?? ""))].filter(Boolean);
    const products = await readTable(db, OB_PRODUCTS, OB_PRODUCT_FIELDS, listed);
    const ref = (src: OfficialSource, r: Record<string, unknown>) => ({ dataset: src.dataset, snapshot: src.snapshot, row: Number(r.row_number) });

    const applications: ObApplication[] = [];
    const withheld: ObWithheld[] = [];
    for (const ask of clean.filter(a => listed.includes(a.appl))) {
      const prows = products.rows.filter(r => text(r.entity_id) === ask.appl);
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
        .map(r => ({ productNo: str(r, "Product_No"), trade: str(r, "Trade_Name"), ingredient: str(r, "Ingredient"), strength: str(r, "Strength"), form: str(r, "DF;Route"), approval: str(r, "Approval_Date"), applicant: str(r, "Applicant"), applicantFull: str(r, "Applicant_Full_Name"), ref: ref(products.source, r) }))
        .sort((a, b) => a.productNo.localeCompare(b.productNo));
      const patentRows: PatentRow[] = patents.rows
        .filter(r => text(r.entity_id) === ask.appl)
        .map(r => ({ appl: ask.appl, productNo: str(r, "Product_No"), patent: str(r, "Patent_No"), expiry: str(r, "Patent_Expire_Date_Text"), substance: flag(r, "Drug_Substance_Flag"), drugProduct: flag(r, "Drug_Product_Flag"), use: str(r, "Patent_Use_Code"), delisted: flag(r, "Delist_Flag"), ref: ref(patents.source, r) }));
      const exclusivityRows: ExclusivityRow[] = exclusivity.rows
        .filter(r => text(r.entity_id) === ask.appl)
        .map(r => ({ appl: ask.appl, productNo: str(r, "Product_No"), code: str(r, "Exclusivity_Code"), date: str(r, "Exclusivity_Date"), ref: ref(exclusivity.source, r) }));
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
    const value: CompanyPatents = {
      ticker: ticker.toUpperCase(),
      sources: { products: products.source, patents: patents.source, exclusivity: exclusivity.source },
      asked: clean.length,
      applications,
      withheld,
      partial: patents.partial || exclusivity.partial || products.partial,
    };
    if (!value.partial) cache.set(key, { at: Date.now(), value });
    return { ok: true, data: value };
  } catch (e) {
    return { ok: false, reason: e instanceof Stop ? e.message : "The Orange Book records could not be read." };
  }
}
