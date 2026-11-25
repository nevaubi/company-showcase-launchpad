/** The immutable catalogue ID of the original, full FDIC institution-quarter table. */
export const FDIC_NATIVE_DATASET =
  "official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b";

/** A company link is grounded in its stored bank call-report identity, never its name. */
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
