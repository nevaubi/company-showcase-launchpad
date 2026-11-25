import type { Collection } from "./types";

/**
 * The 15 collections (`source_datasets.sector`) with reader-facing names, in reading order.
 * Blurbs name what the collection holds today; they are checked against the stored list in the tests.
 */
export const COLLECTIONS: readonly Collection[] = [
  {
    id: "00_universal",
    name: "Economy",
    order: 1,
    blurb:
      "Economy-wide series from FRED: output, prices, jobs, interest rates, money and exchange rates, plus the current Taiwan exchange revenue feeds.",
  },
  {
    id: "01_financials",
    name: "Banks and funds",
    order: 2,
    blurb:
      "Bank, holding company, credit union and fund filings, and the Federal Reserve's H.8 and Z.1 releases.",
  },
  {
    id: "12_sec_company_financials",
    name: "SEC company financials",
    order: 3,
    blurb: "Standard facts and the filing inventory from the SEC's Financial Statement Data Sets.",
  },
  {
    id: "13_ir_integration",
    name: "Company investor relations",
    order: 4,
    blurb: "Document and spreadsheet inventories read from company investor-relations sites.",
  },
  {
    id: "02_technology",
    name: "Technology",
    order: 5,
    blurb:
      "Taiwan listed-company monthly revenue, electronics production, exploited vulnerabilities and World Bank technology indicators.",
  },
  {
    id: "10_communications",
    name: "Communications",
    order: 6,
    blurb: "USAC funding programs, FCC provider records and World Bank telecom indicators.",
  },
  {
    id: "03_healthcare",
    name: "Health care",
    order: 7,
    blurb:
      "FDA drug applications and the Orange Book, Medicare Part D spending and active industry clinical trials.",
  },
  {
    id: "04_energy",
    name: "Energy",
    order: 8,
    blurb:
      "EIA's Monthly Energy Review, company petroleum imports, EV charging, offshore wells and pipelines, and coal mines.",
  },
  {
    id: "05_utilities",
    name: "Power and utilities",
    order: 9,
    blurb:
      "EIA's generator, utility and plant surveys (forms 860, 861 and 923) and EPA's eGRID emissions tables.",
  },
  {
    id: "07_materials",
    name: "Materials and mining",
    order: 10,
    blurb:
      "USGS historical mineral statistics and MSHA mine, employment and controller records.",
  },
  {
    id: "06_industrials",
    name: "Industrials and transport",
    order: 11,
    blurb: "Factory orders, production and freight series from FRED, and the FAA aircraft registry.",
  },
  {
    id: "08_consumer_discretionary",
    name: "Consumer discretionary",
    order: 12,
    blurb: "Retail, vehicle and e-commerce sales series from FRED, and NHTSA recalls and safety ratings.",
  },
  {
    id: "09_consumer_staples",
    name: "Consumer staples",
    order: 13,
    blurb: "USDA food price changes and forecasts, and food production and price series from FRED.",
  },
  {
    id: "11_real_estate",
    name: "Housing and real estate",
    order: 14,
    blurb:
      "FHFA house price indexes down to census tract, and housing starts, sales and mortgage rate series from FRED.",
  },
  {
    id: "14_source_atlas",
    name: "Source registry (internal)",
    order: 15,
    blurb: "The collection specifications this library was assembled from. Not publisher data.",
    internal: true,
  },
];

const BY_ID = new Map(COLLECTIONS.map((c) => [c.id, c]));

/** A collection id the list does not know is shown under its own id, last, so nothing disappears. */
export function collectionFor(sector: string): Collection {
  const known = BY_ID.get(sector);
  if (known) return known;
  const name =
    (sector ?? "")
      .replace(/^\d+_/, "")
      .replace(/_/g, " ")
      .trim() || "Other";
  return {
    id: sector,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    order: COLLECTIONS.length + 1,
    blurb: "",
  };
}
