// The FDIC tables the insured-banks panel reads and the call-report lines it shows. Lines are found by their
// native FDIC field name, which the stored dictionaries keep as the field label (keys are positional `colNNNN`);
// a line is shown only when the snapshot's dictionary states its unit. Positions are hints per dataset, checked
// against the label at read time (RBCT1CER sits at 1880 in one table and 1881 in the other).

/** Insured institutions chosen by assets on 30 June 2026 (the FDIC 500 cohort), latest quarter. Entity index: CERT. */
export const FDIC_CURRENT = "official_fdic_2026q2_cohort500_native_current_quarter";
/** The same cohort, every quarter since 2000. Entity index: CERT; period: REPDTE. */
export const FDIC_HISTORY = "official_01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b";
/** Every FDIC institution, identity fields (its dictionary states no units, so no figure is read from it). Entity index: CERT. */
export const FDIC_ALL_BANKS = "official_01_financials_data_latest_all_banks_core_796bc99364";

export type LineBasis = "ytd" | "quarter" | "balance";
export interface FdicLineDef {
  field: string;
  label: string;
  /** What the FDIC definition says the figure covers. */
  basis: LineBasis;
  hint: { current: number; history: number };
}

export const FDIC_LINES: readonly FdicLineDef[] = [
  { field: "ASSET", label: "Total assets", basis: "balance", hint: { current: 35, history: 35 } },
  { field: "DEP", label: "Total deposits", basis: "balance", hint: { current: 235, history: 235 } },
  { field: "LNLSNET", label: "Net loans and leases", basis: "balance", hint: { current: 918, history: 918 } },
  { field: "NETINC", label: "Net income", basis: "ytd", hint: { current: 1281, history: 1282 } },
  { field: "NIMY", label: "Net interest margin", basis: "ytd", hint: { current: 1295, history: 1296 } },
  { field: "ROA", label: "Return on assets", basis: "ytd", hint: { current: 1894, history: 1895 } },
  { field: "NTLNLSR", label: "Net charge-off rate", basis: "ytd", hint: { current: 1415, history: 1416 } },
  { field: "RBCT1CER", label: "Common equity tier 1 ratio", basis: "quarter", hint: { current: 1880, history: 1881 } },
  { field: "NCLNLSR", label: "Noncurrent loans to loans", basis: "quarter", hint: { current: 1238, history: 1239 } },
];

/** Identity fields of the cohort tables. */
export const FDIC_IDS = { cert: { field: "CERT", hint: { current: 0, history: 0 } }, date: { field: "REPDTE", hint: { current: 1, history: 1 } }, name: { field: "NAME", hint: { current: 1175, history: 1176 } }, state: { field: "STALP", hint: { current: 2049, history: 2050 } } } as const;

/** Identity fields of the all-banks file. */
export const ALL_BANKS_FIELDS = { cert: 1, date: 2, name: 3, cls: 26, state: 27, city: 28, rssd: 29, holder: 30, active: 32 } as const;
export const ALL_BANKS_LABELS: Record<keyof typeof ALL_BANKS_FIELDS, string> = { cert: "CERT", date: "REPDTE", name: "NAME", cls: "BKCLASS", state: "STALP", city: "CITY", rssd: "RSSDID", holder: "RSSDHCR", active: "ACTIVE" };

/** Units the panel treats as quantities, exactly as the FDIC dictionaries state them. */
export const QUANTITY_UNITS: ReadonlySet<string> = new Set(["USD thousands (monetary measures)", "Percent"]);

/** Basis words shown beside a line. */
export const BASIS_TEXT: Record<LineBasis, string> = { ytd: "year to date", quarter: "quarter", balance: "" };

/** The FDIC's public page of an institution. */
export const fdicInstitutionUrl = (cert: string) => `https://banks.data.fdic.gov/bankfind-suite/bankfind/details/${cert}`;
