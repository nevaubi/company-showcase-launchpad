import { defineProfile } from "../define";
import type { Profile, ProfileDataset, ProfileEntry } from "../types";

/**
 * Profile families of round 6 unit `sectors` (Housing, Communications, Technology, Health care), each with its
 * proof (see ../registry.ts for the rule). The values compared for each proof are listed in the unit's report
 * (round 6, `sectors`). A family whose unit could not be traced to the publisher is not here; the report lists
 * it with the reason.
 */

// ---------------------------------------------------------------- Housing: FHFA quarterly purchase-only

/**
 * FHFA House Price Index, national and state table: the rows of FHFA's master file for the United States, the nine
 * census divisions and the states (`place_id`, the indexed geo code), every index family and frequency. FHFA
 * publishes purchase-only indexes for states only quarterly, so this family draws the traditional purchase-only
 * quarterly indexes, which FHFA normalizes "to 100 in the first quarter of 1991" (FHFA HPI FAQ): all 161 places of
 * that family in FHFA's master file start at 1991 Q1 with index_nsa and index_sa at 100.00, and so do the 51 states
 * of the stored table. An address must fix the family fields. The period is composed from `yr` and `period` (the
 * quarter), because the store's period dimension holds the year alone.
 * FHFA re-estimates the whole index history with each release (FAQ). This table was retrieved on 24 Nov 2026, before
 * the release that FHFA's current file carries, so the current file equals it only at the base: the comparison is
 * in the report, and a refreshed snapshot of the table is the release on screen.
 */
export const FHFA_QUARTERLY_DATASET = "official_11_real_estate_national_and_state_c21c1607a1";
const FHFA_Q_UNIT = "Index, first quarter of 1991 = 100";
const FHFA_Q_EVIDENCE =
  "https://fhfa.gov/sites/default/files/2024-05/FHFA_HPI_FAQs_05282024.pdf (\"We normalize the purchase-only indexes to 100 in the first quarter of 1991\"); https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv (traditional, purchase-only, quarterly: index_nsa and index_sa are 100.00 for 1991, period 1, at all 161 places)";
const FHFA_Q_FIXED = [
  { field: "hpi_type", value: "traditional" },
  { field: "hpi_flavor", value: "purchase-only" },
  { field: "frequency", value: "quarterly" },
] as const;

const fhfaQuarterlyClaims = (d: ProfileDataset) => d.source_id === "FHFA_MASTER" && d.id === FHFA_QUARTERLY_DATASET;

function fhfaQuarterlyProfile(): Profile {
  return defineProfile(fhfaQuarterlyClaims, {
    family: "fhfa-hpi-quarterly",
    period: {
      from: "fields",
      fields: ["yr", "period", "frequency"],
      format: "quarter",
      compose: ([yr, period, frequency]) => {
        if (!yr || !period || !/^\d{4}$/.test(yr) || !/^[1-4]$/.test(period)) return null;
        return frequency === "quarterly" ? { text: `${yr}Q${period}`, format: "quarter" } : null;
      },
    },
    cadence: "quarter",
    fixed: FHFA_Q_FIXED,
    measures: [
      { field: "index_sa", label: "Index, seasonally adjusted", unit: { from: "constant", text: FHFA_Q_UNIT, evidence: FHFA_Q_EVIDENCE }, grouping: "none" },
      { field: "index_nsa", label: "Index, not seasonally adjusted", unit: { from: "constant", text: FHFA_Q_UNIT, evidence: FHFA_Q_EVIDENCE }, grouping: "none" },
    ],
    extraFields: ["place_id", "place_name", "level"],
    addressing: {
      by: "geo_code",
      where: ["hpi_type", "hpi_flavor", "frequency"],
      scan: "key",
      rowsScanned: 1130,
      note: "A place is one place_id through the geo index (at most 1,130 records, the United States, over every index family); the family fields are matched after the read.",
    },
    defaultSeries: () => ({ by: "geo_code", key: "USA", where: [...FHFA_Q_FIXED] }),
    firstLook: "series",
    proof: {
      snapshotId: "ddd83ae236ba7f328fea24ad360b64510e73b6acf75b3c2c7f57f7e48769ade7",
      datasetId: FHFA_QUARTERLY_DATASET,
      checked: "2026-11-26",
      documentation: ["https://fhfa.gov/sites/default/files/2024-05/FHFA_HPI_FAQs_05282024.pdf", "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv"],
    },
  });
}

export const FHFA_QUARTERLY_ENTRY: ProfileEntry = { family: "fhfa-hpi-quarterly", claims: fhfaQuarterlyClaims, profile: fhfaQuarterlyProfile };

/** Profile families of round 6 unit `sectors`, each with its proof (see ../registry.ts for the rule). */
export const ENTRIES: readonly ProfileEntry[] = [FHFA_QUARTERLY_ENTRY];
