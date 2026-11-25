// The reviewed list of FR Y-9C capital lines the holding company panel shows, each with the unit the Federal
// Reserve's own instructions establish. The stored FR Y-9C dictionary gives these fields no unit (only BHCK2170
// and BHCK4340 carry one), so this list is the only place a unit comes from; a field it cannot establish is
// shown as filed, with no unit. Fields are found by their MDRM mnemonic, which the stored dictionary keeps as
// the field label (keys there are positional, `colNNNN`). Positions are hints, checked against the label.
//
// Sources (retrieved 25 Nov 2026):
// - INSTRUCTIONS: "Instructions for Preparation of Consolidated Financial Statements for Holding Companies,
//   Reporting Form FR Y-9C", effective September 2026, file SHA-256 8ed5206561a87ec3f43a958323122329c1eeb3f873bd1a376d4fce18dc5f50a6.
//   General Instructions, C. Rounding (page GEN-5): dollar amounts are reported in thousands. Schedule HC-R,
//   Part I: items 31 (leverage ratio), 47 (common equity tier 1 capital ratio), 48 (tier 1 capital ratio) and 49
//   (total capital ratio) are reported "as a percentage, rounded to four decimal places"; item 60(a) is the
//   stress capital buffer "or 2.5000 percent"; item 53 (supplementary leverage ratio) is taken from FFIEC 101,
//   Schedule A, Table 2, item 2.22 and states no unit.
// - Line labels: the Fed's FR Y-9C variable dictionary as stored (dataset Y9C_VARIABLES), read by variable name.
// - Cross-check against the companies' own documents for 30 Sep 2026 (research, enrich.md section 4.1): CET1
//   capital ratio JPM 13.9676 filed, 13.9 printed; BAC 10.8963 and 12.0429 (advanced, BHCWP793), 10.9 and 12.0
//   printed; USB 10.8276, 10.8 printed. Tier 1 leverage JPM 6.5297 and 6.5, BAC 6.5847 and 6.6. Supplementary
//   leverage JPM 5.4656 and 5.5, BAC 5.4690 and 5.5. JPM tier 1 capital 324229000 filed (USD thousands) against
//   324,243 printed (USD millions, an estimate); risk-weighted assets 2177516285 against 2,183,531.
export const Y9C_INSTRUCTIONS_URL = "https://www.federalreserve.gov/apps/reportingforms/Download/DownloadAttachment?guid=698a2ee2-3603-4151-ac3e-49d695e29e8f";
export const Y9C_FORM_URL = "https://www.federalreserve.gov/apps/reportingforms/Report/Index/FR_Y-9C";

/** The Fed's FR Y-9C variable dictionary as stored in the official library (variable, valid from, valid to, description). */
export const Y9C_VARIABLES = "official_01_financials_data_fed_y9_official_variable_dictionary_433523f87c";

export interface Y9cFieldDef {
  /** MDRM mnemonic, the stored field label. */
  field: string;
  /** Short name on screen. */
  short: string;
  /** Established unit, or null: shown as filed. */
  unit: "Percent" | "USD thousands" | null;
  /** Where the unit comes from. */
  unitEvidence: string;
  kind: "ratio" | "amount";
  /** Position in today's snapshot, checked against the label before use. */
  hint: number;
}

const PCT = (item: string) => `FR Y-9C instructions, Schedule HC-R, Part I, item ${item}: reported as a percentage, rounded to four decimal places`;
const THOUSANDS = "FR Y-9C instructions, General Instructions, C. Rounding (GEN-5): dollar amounts are reported in thousands";

/** The ten capital lines, in the order the panel shows them. */
export const Y9C_FIELDS: readonly Y9cFieldDef[] = [
  { field: "BHCAP793", short: "Common equity tier 1 capital ratio", unit: "Percent", unitEvidence: PCT("47"), kind: "ratio", hint: 89 },
  { field: "BHCA7206", short: "Tier 1 capital ratio", unit: "Percent", unitEvidence: PCT("48"), kind: "ratio", hint: 43 },
  { field: "BHCA7205", short: "Total capital ratio", unit: "Percent", unitEvidence: PCT("49"), kind: "ratio", hint: 42 },
  { field: "BHCA7204", short: "Tier 1 leverage ratio", unit: "Percent", unitEvidence: PCT("31"), kind: "ratio", hint: 41 },
  { field: "BHCAH036", short: "Supplementary leverage ratio", unit: null, unitEvidence: "FR Y-9C instructions, Schedule HC-R, Part I, item 53: taken from FFIEC 101, Schedule A, Table 2, item 2.22; no unit stated, shown as filed", kind: "ratio", hint: 49 },
  { field: "BHCALE85", short: "Stress capital buffer", unit: "Percent", unitEvidence: "FR Y-9C instructions, Schedule HC-R, Part I, item 60(a): the stress capital buffer or 2.5000 percent", kind: "ratio", hint: 68 },
  { field: "BHCAP859", short: "Common equity tier 1 capital", unit: "USD thousands", unitEvidence: THOUSANDS, kind: "amount", hint: 105 },
  { field: "BHCA8274", short: "Tier 1 capital", unit: "USD thousands", unitEvidence: THOUSANDS, kind: "amount", hint: 44 },
  { field: "BHCA3792", short: "Total capital", unit: "USD thousands", unitEvidence: THOUSANDS, kind: "amount", hint: 38 },
  { field: "BHCAA223", short: "Total risk-weighted assets", unit: "USD thousands", unitEvidence: THOUSANDS, kind: "amount", hint: 45 },
];

/** Identity and the tie line: RSSD (RSSD9001), report date (RSSD9999), total assets (BHCK2170, unit from the dictionary). */
export const Y9C_KEYS = { rssd: { field: "RSSD9001", hint: 0 }, date: { field: "RSSD9999", hint: 1 }, assets: { field: "BHCK2170", hint: 183 } } as const;
