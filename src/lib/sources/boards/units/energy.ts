import type { UnitSpecs } from "../compose";
import type { BoardSpec, RankTileSpec, SeriesTileSpec, TileSpec } from "../types";

/**
 * Tiles and boards added by round 6 unit `energy`: the Energy board (04_energy) grows from four tiles, and Power
 * and utilities (05_utilities) gets its first board. Pure data: no network; no shared list is edited.
 *
 * Every Monthly Energy Review tile reads one MSN of a raw MER table through the core `eia-mer` profile, with the
 * series' description pinned (`subjectCheck`) and the unit as the record states it. Every series used here was
 * compared with EIA's CSV of its table on 26 Nov 2026: each stored record (month, value, description and unit, in
 * file order) equal to the file's, 63 series in 18 tables (energy report, round 6). Each tile's headline was
 * computed once from those rows; the report lists the figure, period and snapshot.
 *
 * The state tiles read the eGRID2023 state table and the EIA-861 net metering state table through this unit's
 * profiles (`../../profiles/units/energy.ts`).
 */

const MER_MONTHLY = "Monthly, not seasonally adjusted: compare a month with the same month a year earlier.";

const T01_02 = "official_04_energy_raw_mer_t01_02_815b85125f";
const T03_01 = "official_04_energy_raw_mer_t03_01_7b9fc216c5";
const T03_03B = "official_04_energy_raw_mer_t03_03b_831b447d52";
const T03_04 = "official_04_energy_raw_mer_t03_04_137ab74873";
const T04_01 = "official_04_energy_raw_mer_t04_01_7a83bcb610";
const T06_01 = "official_04_energy_raw_mer_t06_01_4cca84cba3";
const T07_02A = "official_04_energy_raw_mer_t07_02a_4593887b01";
const T07_06 = "official_04_energy_raw_mer_t07_06_73b49f9b83";
const T09_01 = "official_04_energy_raw_mer_t09_01_4ba4b3d233";
const T09_08 = "official_04_energy_raw_mer_t09_08_7f4fef2763";
const T09_10 = "official_04_energy_raw_mer_t09_10_5eab229ba3";
const T11_01 = "official_04_energy_raw_mer_t11_01_bb7ae7b424";
const T11_06 = "official_04_energy_raw_mer_t11_06_aa6ddc226e";

const EGRID_ST23 = "official_05_utilities_csv_egrid2023_st23_full_3993eec81f";
const NET_METERING_STATES = "official_05_utilities_csv_eia861_net_metering_2025_states_state_level_662ef5df39";

/** One MER series: the records of one MSN, the stored description pinned. */
const mer = (
  spec: Omit<SeriesTileSpec, "series" | "measure" | "collection" | "subjectCheck" | "form"> & {
    msn: string;
    description: string;
    form?: SeriesTileSpec["form"];
  },
): SeriesTileSpec => {
  const { msn, description, form, ...rest } = spec;
  return {
    ...rest,
    collection: "04_energy",
    measure: "Value",
    series: { where: [{ field: "MSN", value: msn }] },
    subjectCheck: { field: "Description", value: description },
    form: form ?? "line",
  };
};

const EGRID_NOTE =
  "Data year 2023, eGRID2023 revision 2. Fifty states, the District of Columbia and Puerto Rico, each as EPA's state table reports it.";

/** Tiles of the Energy board (04_energy), in board order after the four core tiles. */
const ENERGY_TILES: readonly TileSpec[] = [
  // Production
  mer({
    id: "energy-production",
    datasetId: T01_02,
    msn: "TEPRBUS",
    description: "Total Primary Energy Production",
    title: "Total primary energy production (MER table 1.2)",
    subject: "U.S. total primary energy production",
    unit: "Quadrillion Btu",
    decimals: 3,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),
  mer({
    id: "natural-gas-production",
    datasetId: T04_01,
    msn: "NGPRPUS",
    description: "Natural Gas Production (Dry)",
    title: "Natural gas production (dry) (MER table 4.1)",
    subject: "U.S. dry natural gas production",
    unit: "Billion Cubic Feet",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),
  mer({
    id: "coal-production",
    datasetId: T06_01,
    msn: "CLPRPUS",
    description: "Coal Production",
    title: "Coal production (MER table 6.1)",
    subject: "U.S. coal production",
    unit: "Thousand Short Tons",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    form: "bars",
    note: MER_MONTHLY,
  }),

  // Consumption
  mer({
    id: "petroleum-products-supplied",
    datasetId: T03_01,
    msn: "PATCPUS",
    description: "Petroleum Products Supplied",
    title: "Petroleum products supplied (MER table 3.1)",
    subject: "U.S. petroleum products supplied",
    verb: "were",
    unit: "Thousand Barrels per Day",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: "EIA: products supplied approximately represents consumption of petroleum products. " + MER_MONTHLY,
  }),
  mer({
    id: "natural-gas-consumption",
    datasetId: T04_01,
    msn: "NGTCPUS",
    description: "Natural Gas Consumption",
    title: "Natural gas consumption (MER table 4.1)",
    subject: "U.S. natural gas consumption",
    unit: "Billion Cubic Feet",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),

  // Trade
  mer({
    id: "petroleum-net-imports",
    datasetId: T03_01,
    msn: "PANIPUS",
    description: "Petroleum Net Imports",
    title: "Petroleum net imports (MER table 3.1)",
    subject: "U.S. petroleum net imports",
    verb: "were",
    unit: "Thousand Barrels per Day",
    decimals: 0,
    transform: "level",
    changeAs: "difference",
    headline: "level",
    window: 36,
    note: "Net imports are imports less exports; a negative figure means exports were larger.",
  }),
  mer({
    id: "crude-oil-imports",
    datasetId: T03_03B,
    msn: "COIMPUS",
    description: "Crude Oil Imports, Total",
    title: "Crude oil imports, total (MER table 3.3b)",
    subject: "U.S. crude oil imports",
    verb: "were",
    unit: "Thousand Barrels per Day",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: "The total includes imports for the Strategic Petroleum Reserve, which the table also lists alone. " + MER_MONTHLY,
  }),
  mer({
    id: "natural-gas-net-imports",
    datasetId: T04_01,
    msn: "NGNIPUS",
    description: "Natural Gas Net Imports",
    title: "Natural gas net imports (MER table 4.1)",
    subject: "U.S. natural gas net imports",
    verb: "were",
    unit: "Billion Cubic Feet",
    decimals: 0,
    transform: "level",
    changeAs: "difference",
    headline: "level",
    window: 36,
    note: "Net imports are imports less exports; a negative figure means exports were larger.",
  }),

  // Stocks
  mer({
    id: "crude-oil-stocks-spr",
    datasetId: T03_04,
    msn: "COSQPUS",
    description: "Crude Oil Stocks, SPR",
    title: "Crude oil stocks, Strategic Petroleum Reserve (MER table 3.4)",
    subject: "Crude oil stocks in the Strategic Petroleum Reserve",
    verb: "were",
    unit: "Million Barrels",
    decimals: 1,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 60,
    note: "End-of-month stocks.",
  }),

  // Prices
  mer({
    id: "crude-oil-price",
    datasetId: T09_01,
    msn: "RACPUUS",
    description: "Refiner Acquisition Cost of Crude Oil, Composite",
    title: "Refiner acquisition cost of crude oil, composite (MER table 9.1)",
    subject: "The composite refiner acquisition cost of crude oil",
    unit: "Dollars per Barrel",
    decimals: 2,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: "The composite averages the costs of domestic and imported crude oil. Not adjusted for inflation.",
  }),
  mer({
    id: "natural-gas-citygate-price",
    datasetId: T09_10,
    msn: "NGCGUUS",
    description: "Natural Gas Price, Citygate",
    title: "Natural gas price, citygate (MER table 9.10)",
    subject: "The citygate price of natural gas",
    unit: "Dollars per Thousand Cubic Feet",
    decimals: 2,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: "Citygate: where a distribution utility receives gas from a pipeline. Not adjusted for inflation.",
  }),

  // Emissions
  mer({
    id: "co2-emissions",
    datasetId: T11_01,
    msn: "TETCEUS",
    description: "Total Energy CO2 Emissions",
    title: "Carbon dioxide emissions from energy consumption, total (MER table 11.1)",
    subject: "U.S. energy-related carbon dioxide emissions",
    verb: "were",
    unit: "Million Metric Tons of Carbon Dioxide",
    decimals: 1,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),
];

/** Tiles of the Power and utilities board (05_utilities). */
const UTILITY_TILES: readonly TileSpec[] = [
  // Generation by fuel
  mer({
    id: "generation-natural-gas",
    datasetId: T07_02A,
    msn: "NGETPUS",
    description: "Electricity Net Generation From Natural Gas, All Sectors",
    title: "Electricity net generation from natural gas, all sectors (MER table 7.2a)",
    subject: "Net generation from natural gas",
    unit: "Million Kilowatthours",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),
  mer({
    id: "generation-coal",
    datasetId: T07_02A,
    msn: "CLETPUS",
    description: "Electricity Net Generation From Coal, All Sectors",
    title: "Electricity net generation from coal, all sectors (MER table 7.2a)",
    subject: "Net generation from coal",
    unit: "Million Kilowatthours",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),
  mer({
    id: "generation-nuclear",
    datasetId: T07_02A,
    msn: "NUETPUS",
    description: "Electricity Net Generation From Nuclear Electric Power, All Sectors",
    title: "Electricity net generation from nuclear electric power, all sectors (MER table 7.2a)",
    subject: "Net generation from nuclear electric power",
    unit: "Million Kilowatthours",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),
  mer({
    id: "generation-wind",
    datasetId: T07_02A,
    msn: "WYETPUS",
    description: "Electricity Net Generation From Wind, All Sectors",
    title: "Electricity net generation from wind, all sectors (MER table 7.2a)",
    subject: "Net generation from wind",
    unit: "Million Kilowatthours",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),
  mer({
    id: "generation-solar",
    datasetId: T07_02A,
    msn: "SOETPUS",
    description: "Electricity Net Generation From Solar, All Sectors",
    title: "Electricity net generation from solar, all sectors (MER table 7.2a)",
    subject: "Net generation from solar",
    unit: "Million Kilowatthours",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),

  // Sales and prices
  mer({
    id: "electricity-retail-sales",
    datasetId: T07_06,
    msn: "ESTCPUS",
    description: "Electricity Sales to Ultimate Customers, Total",
    title: "Electricity sales to ultimate customers, total (MER table 7.6)",
    subject: "Electricity sales to ultimate customers",
    verb: "were",
    unit: "Million Kilowatthours",
    decimals: 0,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),
  mer({
    id: "electricity-price-residential",
    datasetId: T09_08,
    msn: "ESRCUUS",
    description: "Average Price of Electricity to Ultimate Customers, Residential",
    title: "Average price of electricity to ultimate customers, residential (MER table 9.8)",
    subject: "The average residential price of electricity",
    unit: "Cents per Kilowatthour,  Including Taxes",
    decimals: 2,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: "Including taxes. Not adjusted for inflation.",
  }),

  // Emissions
  mer({
    id: "power-sector-co2",
    datasetId: T11_06,
    msn: "TXEIEUS",
    description: "Total Energy Electric Power Sector CO2 Emissions",
    title: "Carbon dioxide emissions from the electric power sector, total (MER table 11.6)",
    subject: "Carbon dioxide emissions of the electric power sector",
    verb: "were",
    unit: "Million Metric Tons of Carbon Dioxide",
    decimals: 1,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    note: MER_MONTHLY,
  }),

  // Plants and states
  {
    id: "egrid-state-generation",
    collection: "05_utilities",
    datasetId: EGRID_ST23,
    measure: "STNGENAN",
    title: "State annual net generation (eGRID2023)",
    subject: "state annual net generation",
    entities: "places (the 50 states, DC and Puerto Rico)",
    unit: "MWh",
    decimals: 0,
    transform: "rank",
    headline: "rank",
    form: "ranked-bars",
    across: { by: "geo_code", period: "2023", top: 10 },
    note: EGRID_NOTE,
  } satisfies RankTileSpec,
  {
    id: "egrid-state-co2-rate",
    collection: "05_utilities",
    datasetId: EGRID_ST23,
    measure: "STCO2RTA",
    title: "State annual CO2 total output emission rate (eGRID2023)",
    subject: "state annual CO2 total output emission rate",
    entities: "places (the 50 states, DC and Puerto Rico)",
    unit: "lb/MWh",
    decimals: 1,
    transform: "rank",
    headline: "rank",
    form: "ranked-bars",
    across: { by: "geo_code", period: "2023", top: 10 },
    note: "Pounds of CO2 per megawatthour of net generation. " + EGRID_NOTE,
  } satisfies RankTileSpec,
  {
    id: "egrid-state-renewables",
    collection: "05_utilities",
    datasetId: EGRID_ST23,
    measure: "STGENATR",
    title: "State annual total renewables net generation (eGRID2023)",
    subject: "state annual total renewables net generation",
    entities: "places (the 50 states, DC and Puerto Rico)",
    unit: "MWh",
    decimals: 0,
    transform: "rank",
    headline: "rank",
    form: "ranked-bars",
    across: { by: "geo_code", period: "2023", top: 10 },
    note: "Renewables as eGRID counts them: hydro, biomass, wind, solar and geothermal. " + EGRID_NOTE,
  } satisfies RankTileSpec,
  {
    id: "net-metered-solar-capacity",
    collection: "05_utilities",
    datasetId: NET_METERING_STATES,
    measure: "Photovoltaic | Capacity MW | Total",
    title: "Net metered photovoltaic capacity by state (EIA-861)",
    subject: "net metered photovoltaic capacity",
    entities: "places (the 50 states and DC)",
    unit: "MW",
    decimals: 1,
    transform: "rank",
    headline: "rank",
    form: "ranked-bars",
    across: { by: "geo_code", period: "2025", top: 10 },
    note: "Report year 2025. Photovoltaic capacity under net metering programs, all customer classes, as utilities reported it on Form EIA-861.",
  } satisfies RankTileSpec,
];

const ENERGY_BOARD_ADDS = ENERGY_TILES.map((t) => t.id);

export const UTILITIES_BOARD: BoardSpec = {
  id: "05_utilities",
  title: "Power and utilities",
  tiles: UTILITY_TILES.map((t) => t.id),
};

export const SPECS: UnitSpecs = {
  unit: "energy",
  tiles: [...ENERGY_TILES, ...UTILITY_TILES],
  boards: [UTILITIES_BOARD],
  boardTiles: {
    "04_energy": ENERGY_BOARD_ADDS,
    library: ["co2-emissions", "generation-solar"],
  },
};
