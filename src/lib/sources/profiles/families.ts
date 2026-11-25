import { defineProfile } from "./define";
import type { Profile, ProfileDataset, ProfileEntry } from "./types";

/**
 * EIA Monthly Energy Review, the 107 raw tables as EIA's table browser writes them: one record per series
 * and month, `MSN` (EIA's series code), `YYYYMM`, `Value`, `Column_Order`, `Description`, `Unit`. The unit
 * and the series name are cells of every record, so a tile reads them from the record itself and refuses a
 * record that states another unit. `YYYYMM` is the period dimension; a month "13" is EIA's annual figure,
 * which a monthly series leaves out (counted, not drawn). The tables have no indexed series key: a series is
 * a filter on `MSN`, allowed because the largest raw table holds 10,845 records (the reads allow cell
 * filters on snapshots of at most 50,000). One MSN can appear twice in a table (T01.01 lists NUETBUS as
 * production and as consumption); a tile then refuses with "two records for one month".
 * Checked on 25 Nov 2026: T01.01, T03.01, T07.01 and T09.04 equal EIA's CSVs record for record over the
 * 39 records read of each, units and descriptions included.
 */
const merClaims = (d: ProfileDataset) => d.source_id === "EIA_MER" && d.id.startsWith("official_04_energy_raw_mer_t");

function merProfile(dataset: ProfileDataset): Profile {
  return defineProfile(merClaims, {
    family: "eia-mer",
    period: { from: "dimension", format: "yyyymm" },
    cadence: "month",
    measures: [{ field: "Value", label: "Value", unit: { from: "column", column: "Unit" }, grouping: "none" }],
    extraFields: ["MSN", "YYYYMM", "Description"],
    addressing: {
      by: null,
      where: ["MSN"],
      scan: "table",
      rowsScanned: 10845,
      note: "A series is the records of one MSN, found by a cell filter; the largest raw table has 10,845 records.",
    },
    defaultSeries: () => null,
    firstLook: "series",
    proof: {
      snapshotId: "9a953a8c60285f8aeef9c451850a3cbf362cef7d6550e35fde21315788d74f32",
      datasetId: dataset.id.startsWith("official_04_energy_raw_mer_t") ? "official_04_energy_raw_mer_t01_01_50b683cd84" : dataset.id,
      checked: "2026-11-25",
      documentation: [
        "https://www.eia.gov/totalenergy/data/browser/csv.php?tbl=T01.01",
        "https://www.eia.gov/totalenergy/data/monthly/",
      ],
    },
  });
}

export const EIA_MER_ENTRY: ProfileEntry = { family: "eia-mer", claims: merClaims, profile: merProfile };

/**
 * FDIC bank financial reports (BankFind financials): one record per insured institution (`CERT`, the FDIC
 * certificate, is the indexed entity; `NAME` the entity name) and report date (`REPDTE`, YYYYMMDD, the
 * period dimension). Money fields carry the native type "number" and the unit "USD thousands (monetary
 * measures)" in the dictionary itself, so the unit is read from the dictionary and the profile turns off if
 * it ever states another. A charter is not its holding company: names are shown as the FDIC writes them.
 * The tables hold a cohort (500 institutions chosen by assets on 30 June 2026), never the whole industry.
 * Checked on 25 Nov 2026: the ten largest of the current-quarter table by ASSET equal the FDIC API's ten
 * largest for REPDTE 20260930, name, ASSET and DEP alike.
 */
const fdicClaims = (d: ProfileDataset) => d.source_id === "FDIC_FINANCIALS";
const FDIC_MONEY = "USD thousands (monetary measures)";

function fdicProfile(): Profile {
  return defineProfile(fdicClaims, {
    family: "fdic-financials",
    entityNoun: { one: "insured institution", many: "insured institutions" },
    period: { from: "dimension", format: "yyyymmdd" },
    cadence: "quarter",
    measures: [
      { field: "ASSET", label: "Total assets", unit: { from: "dictionary", text: FDIC_MONEY }, grouping: "none" },
      { field: "DEP", label: "Total deposits", unit: { from: "dictionary", text: FDIC_MONEY }, grouping: "none" },
    ],
    extraFields: ["CERT", "REPDTE", "NAME"],
    addressing: {
      by: "entity_id",
      where: [],
      scan: "key",
      rowsScanned: 107,
      note: "One institution is one CERT through the entity index; one quarter is one REPDTE through the period index (496 records).",
    },
    defaultSeries: () => null,
    firstLook: "ranking",
    proof: {
      snapshotId: "5161b5868f6f0b69142364ccfc1a39c59578abe9d9b551c3d50b940290ac2ddf",
      datasetId: "official_fdic_2026q2_cohort500_native_current_quarter",
      checked: "2026-11-25",
      documentation: ["https://api.fdic.gov/banks/financials", "https://banks.data.fdic.gov/docs/"],
    },
  });
}

export const FDIC_FINANCIALS_ENTRY: ProfileEntry = { family: "fdic-financials", claims: fdicClaims, profile: fdicProfile };

/**
 * FDIC historical industry summary (BankFind summary): one record per charter class (`CB_SI`: CB commercial
 * banks, SI savings institutions) and year (`YEAR`, the period dimension) for "All States and Territories".
 * Money fields are typed and carry "USD thousands (monetary measures)" in the dictionary. The two classes are
 * separate series and are never added here. The table holds 134 records, so a class is a cell filter.
 * Checked on 25 Nov 2026: CB 2023 to 2025 equal the FDIC API (ASSET, DEP, NETINC).
 */
const summaryClaims = (d: ProfileDataset) => d.source_id === "FDIC_SUMMARY";

function summaryProfile(): Profile {
  return defineProfile(summaryClaims, {
    family: "fdic-summary",
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: [
      { field: "ASSET", label: "Total assets", unit: { from: "dictionary", text: FDIC_MONEY }, grouping: "none" },
      { field: "DEP", label: "Total deposits", unit: { from: "dictionary", text: FDIC_MONEY }, grouping: "none" },
      { field: "NETINC", label: "Net income", unit: { from: "dictionary", text: FDIC_MONEY }, grouping: "none" },
    ],
    extraFields: ["YEAR", "STNAME"],
    addressing: {
      by: null,
      where: ["CB_SI"],
      scan: "table",
      rowsScanned: 134,
      note: "A charter class is a cell filter on CB_SI over a 134-record table.",
    },
    defaultSeries: () => ({ where: [{ field: "CB_SI", value: "CB" }] }),
    firstLook: "series",
    proof: {
      snapshotId: "de8e57f4ef51eb3285d293a607660113663cfe40bfc8e6ed7ada56e8d5368973",
      datasetId: "official_01_financials_data_fdic_annual_historical_national_core_ffa805e556",
      checked: "2026-11-25",
      documentation: ["https://api.fdic.gov/banks/summary"],
    },
  });
}

export const FDIC_SUMMARY_ENTRY: ProfileEntry = { family: "fdic-summary", claims: summaryClaims, profile: summaryProfile };

/**
 * FHFA House Price Index master file: one record per index family (`hpi_type`, `hpi_flavor`), frequency,
 * place (`place_id`, the indexed geo code) and period. Finding W5: the store's period dimension is the year
 * alone, so the period is composed from `yr` and `period` (the month or the quarter) by `frequency`. The file
 * mixes index families with different base periods, so the unit is stated only for the traditional
 * purchase-only monthly indexes, which the publisher's own file sets to 100.00 in January 1991 (record
 * USA, 1991, period 1, both index_nsa and index_sa); an address must fix those three fields.
 * Checked on 25 Nov 2026: 48 of 48 United States monthly records read equal FHFA's hpi_master.csv.
 */
const fhfaClaims = (d: ProfileDataset) => d.source_id === "FHFA_MASTER";
const FHFA_UNIT = "Index, January 1991 = 100";
const FHFA_EVIDENCE =
  "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv (traditional, purchase-only, monthly: index_nsa and index_sa are 100.00 for 1991, period 1)";

function fhfaProfile(): Profile {
  return defineProfile(fhfaClaims, {
    family: "fhfa-hpi",
    period: {
      from: "fields",
      fields: ["yr", "period", "frequency"],
      format: "yyyy-mm",
      compose: ([yr, period, frequency]) => {
        if (!yr || !period || !/^\d{4}$/.test(yr) || !/^\d{1,2}$/.test(period)) return null;
        if (frequency === "monthly") return { text: `${yr}-${period.padStart(2, "0")}`, format: "yyyy-mm" };
        if (frequency === "quarterly" && /^[1-4]$/.test(period)) return { text: `${yr}Q${period}`, format: "quarter" };
        return null;
      },
    },
    cadence: "month",
    fixed: [
      { field: "hpi_type", value: "traditional" },
      { field: "hpi_flavor", value: "purchase-only" },
      { field: "frequency", value: "monthly" },
    ],
    measures: [
      { field: "index_sa", label: "Index, seasonally adjusted", unit: { from: "constant", text: FHFA_UNIT, evidence: FHFA_EVIDENCE }, grouping: "none" },
      { field: "index_nsa", label: "Index, not seasonally adjusted", unit: { from: "constant", text: FHFA_UNIT, evidence: FHFA_EVIDENCE }, grouping: "none" },
    ],
    extraFields: ["place_id"],
    addressing: {
      by: "geo_code",
      where: ["hpi_type", "hpi_flavor", "frequency"],
      scan: "key",
      rowsScanned: 1136,
      note: "A place is one place_id through the geo index (the United States has 1,136 records over six index families); the family fields are matched after the read.",
    },
    defaultSeries: () => ({
      by: "geo_code",
      key: "USA",
      where: [
        { field: "hpi_type", value: "traditional" },
        { field: "hpi_flavor", value: "purchase-only" },
        { field: "frequency", value: "monthly" },
      ],
    }),
    firstLook: "series",
    proof: {
      snapshotId: "ed72e8d4dc863aaa9105655515e7eb8cd04339b4d9de53ef134b8a4a3801e44a",
      datasetId: "official_11_real_estate_hpi_master_all_0755e8292e",
      checked: "2026-11-25",
      documentation: ["https://www.fhfa.gov/data/hpi/datasets", "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv"],
    },
  });
}

export const FHFA_ENTRY: ProfileEntry = { family: "fhfa-hpi", claims: fhfaClaims, profile: fhfaProfile };
