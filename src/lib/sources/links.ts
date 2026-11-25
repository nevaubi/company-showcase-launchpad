/**
 * Addresses of the Data library, built in one place for screens, company panels and the
 * assistant's tools, so a link a tool returns is the link a screen writes.
 *
 * Search values go through the router's own serializer (`defaultStringifySearch`), so a
 * native string such as "628" or "01001" comes back from the router as the same string.
 * Path segments are percent-encoded. Each builder has a round-trip test.
 */
import { defaultStringifySearch } from "@tanstack/react-router";
import { collectionSlug } from "./collections";

export const LIBRARY_PATH = "/app/alt-data/library";

/** Address state of the Data library landing (unit `library`). */
export type LibrarySearch = {
  q?: string;
  shape?: "series" | "panel" | "place" | "reference";
  pub?: string;
  sort?: "new" | "size" | "name";
  view?: "changes";
};
/** Address state of one collection (unit `library`). */
export type CollectionSearch = Pick<LibrarySearch, "q" | "pub" | "shape" | "sort">;
/**
 * Address state of the table page (unit `dataset`) that links may set: the pinned snapshot,
 * the record filters and cursor, and the open record (`row`, the 1-based row number).
 */
export type DatasetSearch = {
  snapshot?: string;
  entity?: string;
  geography?: string;
  period?: string;
  q?: string;
  after?: number;
  row?: number;
};

const query = (values: Record<string, string | number | null | undefined>): string =>
  defaultStringifySearch(
    Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined && value !== null && value !== "")),
  );

export function libraryHref(search: LibrarySearch = {}): string {
  return `${LIBRARY_PATH}${query(search)}`;
}

/** A collection by its stored id ("01_financials") or its slug ("banks"). */
export function collectionHref(collection: string, search: CollectionSearch = {}): string {
  return `${LIBRARY_PATH}/c/${encodeURIComponent(collectionSlug(collection))}${query(search)}`;
}

export function datasetHref(datasetId: string, search: DatasetSearch = {}): string {
  return `${LIBRARY_PATH}/d/${encodeURIComponent(datasetId)}${query(search)}`;
}

/** One record of one immutable snapshot: the address every chart mark and tool row opens. */
export function recordHref(datasetId: string, snapshotId: string, row: number): string {
  return datasetHref(datasetId, { snapshot: snapshotId, row });
}

/** The immutable catalogue ID of the original, full FDIC institution-quarter table. */
export const FDIC_NATIVE_DATASET =
  "official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b";

/**
 * The one FDIC certificate stored with a company's bank call-report rows (`alt_data`, dataset
 * "bank", `meta.cert`), or null when there is none or more than one. That certificate comes
 * from the alt registry's mapping of companies to institutions (`src/lib/alt/AGENTS.md`), so
 * it is the app's mapping and not a key the FDIC table carries; screens word the link as the
 * insured bank, never as the consolidated company.
 */
export function soleBankCertificate(
  rows: { dataset: string; meta?: Record<string, unknown> | null }[],
): string | null {
  const ids = new Set(
    rows
      .filter((r) => r.dataset === "bank")
      .map((r) => r.meta?.cert)
      .filter((v) => typeof v === "string" || (typeof v === "number" && Number.isSafeInteger(v)))
      .map(String)
      .filter((v) => /^\d+$/.test(v) && !/^0+$/.test(v)),
  );
  return ids.size === 1 ? [...ids][0] : null;
}

const COLLECTIONS: Record<string, string> = {
  Financials: "01_financials",
  "Information Technology": "02_technology",
  Technology: "02_technology",
  "Health Care": "03_healthcare",
  Healthcare: "03_healthcare",
  Energy: "04_energy",
  Utilities: "05_utilities",
  Industrials: "06_industrials",
  Materials: "07_materials",
  "Consumer Discretionary": "08_consumer_discretionary",
  "Consumer Staples": "09_consumer_staples",
  "Communication Services": "10_communications",
  "Real Estate": "11_real_estate",
};
export const sourceCollectionForSector = (sector: string): string | null =>
  COLLECTIONS[sector] ?? null;
