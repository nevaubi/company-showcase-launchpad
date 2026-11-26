import { defineProfile } from "../define";
import type { MeasureSpec, Profile, ProfileDataset, ProfileEntry } from "../types";

/**
 * Profile families of round 6 unit `energy` (Energy and Power and utilities), each with its proof. The EIA
 * Monthly Energy Review keeps its core profile (`../families.ts`); the families here are the state tables whose
 * unit the publisher states in its own file and whose stored cells were compared with that file on 26 Nov 2026
 * (energy report, round 6).
 *
 * Families of the two collections without a profile, and why, are listed in `ENERGY_REFUSED`.
 */

/**
 * EPA eGRID2023 (revision 2), state table ST23: one record per state, the District of Columbia and Puerto Rico
 * (52) for the data year 2023. `YEAR` is the period dimension; the store indexes `FIPSST`, the two-digit FIPS
 * state code, as the place. Every field is named by eGRID's own code (STNGENAN), which is the label the
 * snapshot's dictionary keeps; the unit is the one EPA prints in the workbook's first header row above each
 * code ("State annual net generation (MWh)"). The resource-mix fields (STCLPR and the like) are stored as
 * fractions of one under a header that says "percent", so they are not measures here; the generation of each
 * fuel is read in MWh instead.
 * Checked on 26 Nov 2026: 520 of 520 stored cells (52 places by the ten measures below) equal EPA's workbook.
 */
const EGRID_WORKBOOK = "https://www.epa.gov/system/files/documents/2025-06/egrid2023_data_rev2.xlsx";
const egridClaims = (d: ProfileDataset) => d.source_id === "EPA_EGRID" && d.id.startsWith("official_05_utilities_csv_egrid2023_st23_full_");

const egridMeasure = (field: string, label: string, unit: string): MeasureSpec => ({
  field,
  label,
  unit: { from: "constant", text: unit, evidence: `${EGRID_WORKBOOK} (sheet ST23, first header row above ${field}: "${label} (${unit})")` },
  grouping: "none",
});

/** The eGRID ST23 measures: field code, EPA's description, and the unit EPA prints with it. */
export const EGRID_STATE_MEASURES: readonly MeasureSpec[] = [
  egridMeasure("STNGENAN", "State annual net generation", "MWh"),
  egridMeasure("STCO2RTA", "State annual CO2 total output emission rate", "lb/MWh"),
  egridMeasure("STCO2AN", "State annual CO2 emissions", "tons"),
  egridMeasure("STNAMEPCAP", "State nameplate capacity", "MW"),
  egridMeasure("STGENATR", "State annual total renewables net generation", "MWh"),
  egridMeasure("STGENACL", "State annual coal net generation", "MWh"),
  egridMeasure("STGENAGS", "State annual gas net generation", "MWh"),
  egridMeasure("STGENANC", "State annual nuclear net generation", "MWh"),
  egridMeasure("STGENAWI", "State annual wind net generation", "MWh"),
  egridMeasure("STGENASO", "State annual solar net generation", "MWh"),
];

function egridStateProfile(): Profile {
  return defineProfile(egridClaims, {
    family: "epa-egrid-state",
    entityNoun: { one: "state", many: "states" },
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: EGRID_STATE_MEASURES,
    extraFields: ["YEAR", "PSTATABB", "FIPSST"],
    addressing: {
      by: "geo_code",
      where: [],
      scan: "key",
      rowsScanned: 1,
      note: "One place is one FIPS state code through the geo index (one record each); the data year is the period index (52 records).",
    },
    defaultSeries: () => null,
    firstLook: "places",
    proof: {
      snapshotId: "35539c70582926f0f0bc5ade4e5f6ba30393bc0b3bf9b2d0d0476dee94dac859",
      datasetId: "official_05_utilities_csv_egrid2023_st23_full_3993eec81f",
      checked: "2026-11-26",
      documentation: [EGRID_WORKBOOK, "https://www.epa.gov/egrid/egrid-technical-guide"],
    },
  });
}

export const EGRID_STATE_ENTRY: ProfileEntry = { family: "epa-egrid-state", claims: egridClaims, profile: egridStateProfile };

/**
 * EIA-861 net metering, state level (workbook Net_Metering_2025.xlsx, sheet "States- State Level"): one record
 * per state and DC for the report year, and the sheet's own source line kept as a last record (its period is
 * that line, so a ranking names the year). The store indexes the state's postal code as the place and the year
 * as the period. Labels join EIA's three header rows ("Photovoltaic | Capacity MW | Total"); capacity fields
 * carry the unit MW in the dictionary, from the workbook's unit row, so the unit is read from the dictionary and
 * the profile turns off if it ever states another. EIA writes "." where a cell does not apply; it is a gap.
 * Checked on 26 Nov 2026: 357 of 357 stored cells (51 places by seven fields) equal EIA's workbook, markers too.
 */
const EIA861_ZIP = "https://www.eia.gov/electricity/data/eia861/zip/f8612025.zip";
const netMeteringClaims = (d: ProfileDataset) =>
  d.source_id === "EIA861_DISTRIBUTED" &&
  d.id.startsWith("official_05_utilities_csv_eia861_net_metering_") &&
  d.id.includes("_states_state_level_");

/** The net metering measures: the joined header, the publisher's words, and where the unit is stated. */
export const NET_METERING_STATE_MEASURES: readonly MeasureSpec[] = [
  {
    field: "Photovoltaic | Capacity MW | Total",
    label: "Net metered photovoltaic capacity, total",
    unit: { from: "dictionary", text: "MW" },
    grouping: "none",
    markers: ["."],
  },
  {
    field: "Photovoltaic | Capacity MW | Residential",
    label: "Net metered photovoltaic capacity, residential",
    unit: { from: "dictionary", text: "MW" },
    grouping: "none",
    markers: ["."],
  },
  {
    field: "Photovoltaic | Energy Sold Back MWh | Total",
    label: "Photovoltaic energy sold back, total",
    unit: {
      from: "constant",
      text: "MWh",
      evidence: `${EIA861_ZIP} (Net_Metering_2025.xlsx, sheet "States- State Level", header "Energy Sold Back MWh")`,
    },
    grouping: "none",
    markers: ["."],
  },
];

function netMeteringProfile(): Profile {
  return defineProfile(netMeteringClaims, {
    family: "eia861-net-metering-state",
    entityNoun: { one: "state", many: "states" },
    period: { from: "dimension", format: "year" },
    cadence: "year",
    measures: NET_METERING_STATE_MEASURES,
    extraFields: ["Utility Characteristics | Year", "Utility Characteristics | State"],
    addressing: {
      by: "geo_code",
      where: [],
      scan: "key",
      rowsScanned: 1,
      note: "One state is one postal code through the geo index (one record each); a ranking names the report year, because the sheet's source line is kept as a record with a period of its own.",
    },
    defaultSeries: () => null,
    firstLook: "places",
    proof: {
      snapshotId: "aed6f50aaeb4a6795e3f9858afdb55b0b3fddf68fc34a9ef8e360cf5e112eb82",
      datasetId: "official_05_utilities_csv_eia861_net_metering_2025_states_state_level_662ef5df39",
      checked: "2026-11-26",
      documentation: [EIA861_ZIP, "https://www.eia.gov/electricity/data/eia861/"],
    },
  });
}

export const NET_METERING_STATE_ENTRY: ProfileEntry = {
  family: "eia861-net-metering-state",
  claims: netMeteringClaims,
  profile: netMeteringProfile,
};

/**
 * Families of Energy (04) and Power and utilities (05) without a measure profile, by source id, with the reason
 * in one sentence. Their tables still get the first look of every table (records per period, places and
 * entities by records) and count tiles; no measure is drawn from them.
 */
export const ENERGY_REFUSED: Readonly<Record<string, string>> = {
  EIA814_IMPORTS:
    "The company files state QUANTITY without a unit in the dictionary and hold several records per importer, port, product and month, so no record is one series; the country and importer tables are sums the store derived from them, which EIA does not publish.",
  EIA820_REFINERIES:
    "QUANTITY is in units that change with PRODUCT and SUPPLY (barrels per calendar day, barrels per stream day, barrels), and the table has no period or place dimension to rank by.",
  EIA_EV_MICRODATA:
    "The microdata are one record per charging location and port with counts, not a measure with a unit; the monthly port counts by state are sums the store derived from them.",
  BSEE_BOREHOLES: "A well inventory: dates, codes and coordinates, no measure.",
  BSEE_PIPELINES: "A segment inventory: the dictionary states no unit for any size or length field.",
  BSEE_PRODUCTION_RANK:
    "The dictionary states the volumes' unit as not confirmed, and the table has no period dimension for a ranking.",
  BSEE_COMPANIES: "A register of company names and addresses, no measure.",
  MSHA_COAL:
    "The mine files hold one record per mine subunit and year, so a mine's production is a sum of its subunits that no bounded read gives (2025 alone has 1,313 records); the state table is a sum the store derived, which MSHA does not publish.",
  EIA923_GENERATION:
    "A plant's records are split by prime mover and fuel and its months are twelve fields of one record; state and national totals are sums the store derived or that no bounded read gives.",
  EIA860_GENERATORS:
    "One record per generator with no period: capacity by state, technology or year is a sum no bounded read gives.",
  EIA860_PLANTS: "One record per plant with no period and no capacity field; capacity lives in the generator tables.",
  EIA860_SOLAR: "One record per solar generator with no period: capacity by state or year is a sum no bounded read gives.",
  EIA860_WIND: "One record per wind generator with no period: capacity by state or year is a sum no bounded read gives.",
  EIA860_STORAGE: "One record per storage generator with no period: capacity by state or year is a sum no bounded read gives.",
  EIA860_MULTIFUEL: "One record per generator with no period and fuel codes, no measure to rank by period.",
  EIA860_UTILITIES: "A register of utilities, no measure.",
  EIA860_OWNERS: "Ownership shares of generators with no period; a share is not drawn without the capacity it applies to.",
  EIA860_ENV_ASSOC: "Associations between boilers, generators and control equipment: identifiers only.",
  EIA860_ENV_EQUIP: "Equipment design records with no period: no series and no cross-section to rank.",
  EIA861_ARCHIVE:
    "Utility-level records: a state's figure is a sum over utilities that no bounded read gives, and one year's records exceed one cross-section in the larger tables.",
  EIA861_SALES: "Utility-level sales, revenue and customers: 2,870 records in the year, more than one cross-section holds.",
  EIA861_RELIABILITY: "The state totals table does not index the state, so a ranking or map has no place key; the utility tables are utility-level.",
  EIA861_TERRITORY: "Service territory lists (utility and county), no measure.",
  EIA861_METERING: "Utility-level meter counts: a state's figure is a sum over utilities that no bounded read gives.",
  EIA861_OPERATIONS: "Utility-level operating data: 1,728 records in the year, more than one cross-section holds.",
  EIA861_ENERGY_EFFICIENCY: "Utility-level program records: a state's figure is a sum over utilities that no bounded read gives.",
  EIA861_DEMAND_RESPONSE: "Utility-level program records: a state's figure is a sum over utilities that no bounded read gives.",
};

/** Profile families of round 6 unit `energy`, each with its proof (see ../registry.ts for the rule). */
export const ENTRIES: readonly ProfileEntry[] = [EGRID_STATE_ENTRY, NET_METERING_STATE_ENTRY];
