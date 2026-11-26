import type { UnitSpecs } from "../compose";
import type {
  BoardSpec,
  CompareTileSpec,
  MapTileSpec,
  MixTileSpec,
  RecordsTileSpec,
  SeriesTileSpec,
  StatTileSpec,
  TileSeriesSpec,
  TileSpec,
} from "../types";

/**
 * Tiles and boards added by round 6 unit `energy`: the Energy board (04_energy) grows from four tiles, and Power
 * and utilities (05_utilities) gets its first board. Pure data: no network; no shared list is edited.
 *
 * Every Monthly Energy Review tile reads MSNs of raw MER tables through the core `eia-mer` profile, each series'
 * description pinned (`subjectCheck`) and its unit as the record states it. Every series used here was compared
 * with EIA's CSV of its table on 26 Nov 2026: each stored record (month, value, description and unit, in file order)
 * equal to the file's, 64 series in 18 tables (energy report, round 6; `energy.checks.json`). Each tile of one series
 * or one ranking was computed once from those rows; the report lists the figure, period and snapshot.
 *
 * The state tiles read the eGRID2023 state table and the EIA-861 net metering state table through this unit's
 * profiles (`../../profiles/units/energy.ts`); the count tiles count records and need no profile.
 *
 * Every tile here is on a board (the shared board test requires it) and computes in the board tests on the energy
 * fixture rows (`energy.fixtures.json`, written from `energy.rows.json` by `energy-tables.ts`).
 */

const MER_MONTHLY = "Monthly, not seasonally adjusted: compare a month with the same month a year earlier.";
const NET_IMPORTS = "Net imports are imports less exports; a negative figure means exports were larger.";

const T01_02 = "official_04_energy_raw_mer_t01_02_815b85125f";
const T02_01A = "official_04_energy_raw_mer_t02_01a_079e5be928";
const T02_01B = "official_04_energy_raw_mer_t02_01b_c3ddcc79fc";
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
const EIA860_STORAGE_PROPOSED = "official_05_utilities_csv_eia860_3_4_energy_storage_y2025_proposed_cde5506369";
const EIA860_OPERABLE = "official_05_utilities_csv_eia860_3_1_generator_y2025_operable_105a35a881";
const EIA860_PROPOSED = "official_05_utilities_csv_eia860_3_1_generator_y2025_proposed_f256d7a434";

const KWH = "Million Kilowatthours";
const CO2 = "Million Metric Tons of Carbon Dioxide";
const ELECTRICITY_PRICE = "Cents per Kilowatthour,  Including Taxes";

/** The address of one MER series: the records of one MSN. */
const msn = (code: string) => ({ where: [{ field: "MSN", value: code }] });

/** One MER series of a tile of one series, its description pinned. */
const mer = (
  spec: Omit<SeriesTileSpec, "series" | "measure" | "collection" | "subjectCheck" | "form"> & {
    msn: string;
    description: string;
    form?: SeriesTileSpec["form"];
  },
): SeriesTileSpec => {
  const { msn: code, description, form, ...rest } = spec;
  return {
    ...rest,
    collection: "04_energy",
    measure: "Value",
    series: msn(code),
    subjectCheck: { field: "Description", value: description },
    form: form ?? "line",
  };
};

/** One MER series of a compare or mix tile, its description pinned. */
const line = (code: string, description: string, label: string, subject: string, datasetId?: string): TileSeriesSpec => ({
  ...(datasetId ? { datasetId } : {}),
  series: msn(code),
  label,
  subject,
  subjectCheck: { field: "Description", value: description },
});

/** A compact MER tile: the latest month, its change over a year and a sparkline. */
const merStat = (
  spec: Omit<StatTileSpec, "series" | "measure" | "collection" | "subjectCheck" | "form" | "transform" | "headline"> & {
    msn: string;
    description: string;
  },
): StatTileSpec => {
  const { msn: code, description, ...rest } = spec;
  return {
    ...rest,
    collection: "04_energy",
    measure: "Value",
    form: "stat",
    transform: "level",
    headline: "level",
    series: msn(code),
    subjectCheck: { field: "Description", value: description },
  };
};

const EGRID_NOTE = "Data year 2023, eGRID2023 revision 2, as EPA's state table reports each state, DC and Puerto Rico.";

// ---------------------------------------------------------------------------------------------- Energy (04)

/** Tiles of one series on the Energy board, computed by the board server today. */
const ENERGY_SERIES: readonly SeriesTileSpec[] = [
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
    section: "Trade",
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
    section: "Trade",
    note: NET_IMPORTS,
  }),
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
    section: "Prices",
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
    section: "Prices",
    note: "Citygate: where a distribution utility receives gas from a pipeline. Not adjusted for inflation.",
  }),
];

/** Tiles of the round 6 forms on the Energy board. */
const ENERGY_FORMS: readonly TileSpec[] = [
  {
    id: "energy-production-mix",
    collection: "04_energy",
    datasetId: T01_02,
    measure: "Value",
    title: "Primary energy production by source (MER table 1.2)",
    subject: "Natural gas (dry) production",
    unit: "Quadrillion Btu",
    decimals: 3,
    form: "mix",
    transform: "level",
    headline: "share",
    whole: line("TEPRBUS", "Total Primary Energy Production", "Total", "total primary energy production"),
    parts: [
      line("NGPRBUS", "Natural Gas (Dry) Production", "Natural gas (dry)", "Natural gas (dry) production"),
      line("PAPRBUS", "Crude Oil Production", "Crude oil", "Crude oil production"),
      line("CLPRBUS", "Coal Production", "Coal", "Coal production"),
      line("NLPRBUS", "Natural Gas Plant Liquids Production", "Natural gas plant liquids", "Natural gas plant liquids production"),
      line("NUETBUS", "Nuclear Electric Power Production", "Nuclear", "Nuclear electric power production"),
      line("REPRBUS", "Total Renewable Energy Production", "Renewables", "Total renewable energy production"),
    ],
    draw: "areas",
    tolerance: "0.001",
    window: 36,
    section: "Production",
    size: "wide",
    note: "EIA's six sources sum to its total within its rounding. " + MER_MONTHLY,
  } satisfies MixTileSpec,
  {
    id: "consumption-by-sector",
    collection: "04_energy",
    datasetId: T02_01A,
    measure: "Value",
    title: "Total energy consumed by sector (MER tables 2.1a and 2.1b)",
    subject: "Total energy consumed by the industrial sector",
    unit: "Trillion Btu",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [
      line("TEICBUS", "Total Energy Consumed by the Industrial Sector", "Industrial", "Total energy consumed by the industrial sector"),
      line("TEACBUS", "Total Energy Consumed by the Transportation Sector", "Transportation", "Total energy consumed by the transportation sector", T02_01B),
      line("TERCBUS", "Total Energy Consumed by the Residential Sector", "Residential", "Total energy consumed by the residential sector"),
      line("TECCBUS", "Total Energy Consumed by the Commercial Sector", "Commercial", "Total energy consumed by the commercial sector"),
    ],
    window: 36,
    section: "Consumption",
    size: "wide",
    note: "Each sector's total includes its share of electrical system energy losses. " + MER_MONTHLY,
  } satisfies CompareTileSpec,
  {
    id: "petroleum-trade",
    collection: "04_energy",
    datasetId: T03_01,
    measure: "Value",
    title: "Petroleum exports and imports (MER table 3.1)",
    subject: "U.S. petroleum exports",
    verb: "were",
    unit: "Thousand Barrels per Day",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [
      line("PAEXPUS", "Petroleum Exports", "Exports", "U.S. petroleum exports"),
      line("PAIMPUS", "Petroleum Imports", "Imports", "U.S. petroleum imports"),
    ],
    window: 60,
    section: "Trade",
    size: "wide",
    note: "EIA publishes imports less exports as petroleum net imports. " + MER_MONTHLY,
  } satisfies CompareTileSpec,
  {
    id: "crude-oil-stocks",
    collection: "04_energy",
    datasetId: T03_04,
    measure: "Value",
    title: "Crude oil stocks, SPR and non-SPR (MER table 3.4)",
    subject: "Crude oil stocks in the Strategic Petroleum Reserve",
    verb: "were",
    unit: "Million Barrels",
    decimals: 1,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [
      line("COSQPUS", "Crude Oil Stocks, SPR", "Strategic Petroleum Reserve", "Crude oil stocks in the Strategic Petroleum Reserve"),
      line("COSXPUS", "Crude Oil Stocks, Non-SPR", "Non-SPR", "Crude oil stocks outside the Strategic Petroleum Reserve"),
    ],
    window: 60,
    section: "Stocks",
    note: MER_MONTHLY,
  } satisfies CompareTileSpec,
  {
    id: "co2-by-fuel",
    collection: "04_energy",
    datasetId: T11_01,
    measure: "Value",
    title: "Carbon dioxide emissions from energy consumption by source (MER table 11.1)",
    subject: "Carbon dioxide emissions from petroleum",
    verb: "were",
    unit: CO2,
    decimals: 1,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [
      line("PMTCEUS", "Petroleum, Excluding Biofuels, CO2 Emissions", "Petroleum", "Carbon dioxide emissions from petroleum"),
      line("NNTCEUS", "Natural Gas, Excluding Supplemental Gaseous Fuels, CO2 Emissions", "Natural gas", "Carbon dioxide emissions from natural gas"),
      line("CKTCEUS", "Coal, Including Coal Coke Net Imports, CO2 Emissions", "Coal", "Carbon dioxide emissions from coal"),
    ],
    window: 36,
    section: "Emissions",
    size: "wide",
    note: "Petroleum excludes biofuels; natural gas excludes supplemental gaseous fuels; coal includes coal coke net imports. " + MER_MONTHLY,
  } satisfies CompareTileSpec,
  merStat({
    id: "natural-gas-production-stat",
    datasetId: T04_01,
    msn: "NGPRPUS",
    description: "Natural Gas Production (Dry)",
    title: "Natural gas production (dry)",
    subject: "U.S. dry natural gas production",
    unit: "Billion Cubic Feet",
    decimals: 0,
    changeAs: "percent",
    section: "Production",
    note: MER_MONTHLY,
  }),
  merStat({
    id: "coal-production-stat",
    datasetId: T06_01,
    msn: "CLPRPUS",
    description: "Coal Production",
    title: "Coal production",
    subject: "U.S. coal production",
    unit: "Thousand Short Tons",
    decimals: 0,
    changeAs: "percent",
    section: "Production",
    note: MER_MONTHLY,
  }),
  merStat({
    id: "petroleum-products-supplied-stat",
    datasetId: T03_01,
    msn: "PATCPUS",
    description: "Petroleum Products Supplied",
    title: "Petroleum products supplied",
    subject: "U.S. petroleum products supplied",
    verb: "were",
    unit: "Thousand Barrels per Day",
    decimals: 0,
    changeAs: "percent",
    section: "Consumption",
    note: "EIA: products supplied approximately represents consumption of petroleum products.",
  }),
  merStat({
    id: "natural-gas-consumption-stat",
    datasetId: T04_01,
    msn: "NGTCPUS",
    description: "Natural Gas Consumption",
    title: "Natural gas consumption",
    subject: "U.S. natural gas consumption",
    unit: "Billion Cubic Feet",
    decimals: 0,
    changeAs: "percent",
    section: "Consumption",
    note: MER_MONTHLY,
  }),
  merStat({
    id: "co2-emissions-stat",
    datasetId: T11_01,
    msn: "TETCEUS",
    description: "Total Energy CO2 Emissions",
    title: "Energy-related CO2 emissions",
    subject: "U.S. energy-related carbon dioxide emissions",
    verb: "were",
    unit: CO2,
    decimals: 1,
    changeAs: "percent",
    section: "Emissions",
    note: MER_MONTHLY,
  }),
];

// ---------------------------------------------------------------------------------------------- Power and utilities (05)

/** Tiles of one series on the Power and utilities board, computed by the board server today. */
const UTILITY_SERIES: readonly SeriesTileSpec[] = [
  mer({
    id: "natural-gas-price-power",
    datasetId: T09_10,
    msn: "NGEIUUS",
    description: "Natural Gas Price, Electric Power Sector",
    title: "Natural gas price, electric power sector (MER table 9.10)",
    subject: "The price of natural gas to the electric power sector",
    unit: "Dollars per Thousand Cubic Feet",
    decimals: 2,
    transform: "level",
    changeAs: "percent",
    headline: "level",
    window: 36,
    section: "Sales and prices",
    note: "Not adjusted for inflation.",
  }),
];

/** Tiles of the round 6 forms and the state rankings on the Power and utilities board. */
const UTILITY_FORMS: readonly TileSpec[] = [
  {
    id: "generation-by-source",
    collection: "04_energy",
    datasetId: T07_02A,
    measure: "Value",
    title: "Electricity net generation by source, all sectors (MER table 7.2a)",
    subject: "Net generation from natural gas",
    unit: KWH,
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [
      line("NGETPUS", "Electricity Net Generation From Natural Gas, All Sectors", "Natural gas", "Net generation from natural gas"),
      line("CLETPUS", "Electricity Net Generation From Coal, All Sectors", "Coal", "Net generation from coal"),
      line("NUETPUS", "Electricity Net Generation From Nuclear Electric Power, All Sectors", "Nuclear", "Net generation from nuclear electric power"),
      line("WYETPUS", "Electricity Net Generation From Wind, All Sectors", "Wind", "Net generation from wind"),
      line("SOETPUS", "Electricity Net Generation From Solar, All Sectors", "Solar", "Net generation from solar"),
      line("HVETPUS", "Electricity Net Generation From Conventional Hydroelectric Power, All Sectors", "Hydro", "Net generation from conventional hydroelectric power"),
    ],
    window: 36,
    section: "Generation by fuel",
    size: "wide",
    note: "Six of the sources EIA lists; they do not sum to its total, which includes sources not shown. " + MER_MONTHLY,
  } satisfies CompareTileSpec,
  merStat({
    id: "generation-solar-stat",
    datasetId: T07_02A,
    msn: "SOETPUS",
    description: "Electricity Net Generation From Solar, All Sectors",
    title: "Net generation from solar",
    subject: "Net generation from solar",
    unit: KWH,
    decimals: 0,
    changeAs: "percent",
    section: "Generation by fuel",
    note: MER_MONTHLY,
  }),
  merStat({
    id: "generation-wind-stat",
    datasetId: T07_02A,
    msn: "WYETPUS",
    description: "Electricity Net Generation From Wind, All Sectors",
    title: "Net generation from wind",
    subject: "Net generation from wind",
    unit: KWH,
    decimals: 0,
    changeAs: "percent",
    section: "Generation by fuel",
    note: MER_MONTHLY,
  }),
  {
    id: "electricity-sales-by-sector",
    collection: "04_energy",
    datasetId: T07_06,
    measure: "Value",
    title: "Electricity sales to ultimate customers by sector (MER table 7.6)",
    subject: "Residential electricity sales",
    verb: "were",
    unit: KWH,
    decimals: 0,
    form: "mix",
    transform: "level",
    headline: "share",
    whole: line("ESTCPUS", "Electricity Sales to Ultimate Customers, Total", "Total", "total electricity sales to ultimate customers"),
    parts: [
      line("ESRCPUS", "Electricity Sales to Ultimate Customers, Residential", "Residential", "Residential sales"),
      line("ESCCPUS", "Electricity Sales to Ultimate Customers, Commercial", "Commercial", "Commercial sales"),
      line("ESICPUS", "Electricity Sales to Ultimate Customers, Industrial", "Industrial", "Industrial sales"),
      line("ESACPUS", "Electricity Sales to Ultimate Customers, Transportation", "Transportation", "Transportation sales"),
    ],
    draw: "columns",
    tolerance: "0.01",
    window: 24,
    section: "Sales and prices",
    size: "wide",
    note: "EIA's four sectors sum to its total within its rounding. " + MER_MONTHLY,
  } satisfies MixTileSpec,
  {
    id: "electricity-prices-by-sector",
    collection: "04_energy",
    datasetId: T09_08,
    measure: "Value",
    title: "Average price of electricity to ultimate customers by sector (MER table 9.8)",
    subject: "The average residential price of electricity",
    unit: ELECTRICITY_PRICE,
    decimals: 2,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [
      line("ESRCUUS", "Average Price of Electricity to Ultimate Customers, Residential", "Residential", "The average residential price of electricity"),
      line("ESCMUUS", "Average Price of Electricity to Ultimate Customers, Commercial", "Commercial", "The average commercial price of electricity"),
      line("ESICUUS", "Average Price of Electricity to Ultimate Customers, Industrial", "Industrial", "The average industrial price of electricity"),
    ],
    window: 36,
    section: "Sales and prices",
    note: "Including taxes. Not adjusted for inflation.",
  } satisfies CompareTileSpec,
  {
    id: "power-sector-co2-by-fuel",
    collection: "04_energy",
    datasetId: T11_06,
    measure: "Value",
    title: "Carbon dioxide emissions from the electric power sector by fuel (MER table 11.6)",
    subject: "Carbon dioxide emissions from natural gas in the electric power sector",
    verb: "were",
    unit: CO2,
    decimals: 1,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [
      line("NNEIEUS", "Natural Gas Electric Power Sector CO2 Emissions", "Natural gas", "Carbon dioxide emissions from natural gas in the electric power sector"),
      line("CLEIEUS", "Coal Electric Power Sector CO2 Emissions", "Coal", "Carbon dioxide emissions from coal in the electric power sector"),
    ],
    window: 36,
    section: "Emissions",
    note: MER_MONTHLY,
  } satisfies CompareTileSpec,
  merStat({
    id: "power-sector-co2-stat",
    datasetId: T11_06,
    msn: "TXEIEUS",
    description: "Total Energy Electric Power Sector CO2 Emissions",
    title: "Power sector CO2 emissions",
    subject: "Carbon dioxide emissions of the electric power sector",
    verb: "were",
    unit: CO2,
    decimals: 1,
    changeAs: "percent",
    section: "Emissions",
    note: MER_MONTHLY,
  }),
  {
    id: "egrid-state-generation",
    collection: "05_utilities",
    datasetId: EGRID_ST23,
    measure: "STNGENAN",
    title: "State annual net generation (eGRID2023)",
    subject: "state annual net generation",
    entities: "places (the states, DC and Puerto Rico)",
    unit: "MWh",
    decimals: 0,
    form: "map",
    transform: "level",
    headline: "rank",
    across: { by: "geo_code", period: "2023" },
    section: "Plants and states",
    note: EGRID_NOTE,
  } satisfies MapTileSpec,
  {
    id: "egrid-state-co2-rate",
    collection: "05_utilities",
    datasetId: EGRID_ST23,
    measure: "STCO2RTA",
    title: "State annual CO2 total output emission rate (eGRID2023)",
    subject: "state annual CO2 total output emission rate",
    entities: "places (the states, DC and Puerto Rico)",
    unit: "lb/MWh",
    decimals: 1,
    form: "map",
    transform: "level",
    headline: "rank",
    across: { by: "geo_code", period: "2023" },
    section: "Plants and states",
    note: "Pounds of CO2 per megawatthour of net generation. " + EGRID_NOTE,
  } satisfies MapTileSpec,
  {
    id: "egrid-state-renewables",
    collection: "05_utilities",
    datasetId: EGRID_ST23,
    measure: "STGENATR",
    title: "State annual total renewables net generation (eGRID2023)",
    subject: "state annual total renewables net generation",
    entities: "places (the states, DC and Puerto Rico)",
    unit: "MWh",
    decimals: 0,
    form: "map",
    transform: "level",
    headline: "rank",
    across: { by: "geo_code", period: "2023" },
    section: "Plants and states",
    note: "Renewables as eGRID counts them: hydro, biomass, wind, solar and geothermal. " + EGRID_NOTE,
  } satisfies MapTileSpec,
  {
    id: "net-metered-solar-capacity",
    collection: "05_utilities",
    datasetId: NET_METERING_STATES,
    measure: "Photovoltaic | Capacity MW | Total",
    title: "Net metered photovoltaic capacity by state (EIA-861)",
    subject: "net metered photovoltaic capacity",
    entities: "places (the states and DC)",
    unit: "MW",
    decimals: 1,
    form: "map",
    transform: "level",
    headline: "rank",
    across: { by: "geo_code", period: "2025" },
    section: "Plants and states",
    note: "Report year 2025. Photovoltaic capacity under net metering programs, all customer classes, as utilities reported it on Form EIA-861.",
  } satisfies MapTileSpec,
  {
    id: "eia860-operable-generators-by-state",
    collection: "05_utilities",
    datasetId: EIA860_OPERABLE,
    title: "Operable generators by state (EIA-860, 2025)",
    subject: "EIA-860's operable generator table",
    transform: "records",
    headline: "records",
    form: "map",
    per: { dimension: "geo_code", top: 60 },
    noun: "places (the states and DC)",
    section: "Capacity",
    note: "One record per generator as plants reported it for 2025: records, not megawatts.",
  } satisfies RecordsTileSpec,
  {
    id: "eia860-proposed-generators-by-state",
    collection: "05_utilities",
    datasetId: EIA860_PROPOSED,
    title: "Proposed generators by state (EIA-860, 2025)",
    subject: "EIA-860's proposed generator table",
    transform: "records",
    headline: "records",
    form: "map",
    per: { dimension: "geo_code", top: 60 },
    noun: "places (the states and DC)",
    section: "Capacity",
    note: "One record per planned generator as reported for 2025: records, not megawatts.",
  } satisfies RecordsTileSpec,
  {
    id: "eia860-proposed-storage-by-state",
    collection: "05_utilities",
    datasetId: EIA860_STORAGE_PROPOSED,
    title: "Proposed energy storage generators by state (EIA-860, 2025)",
    subject: "EIA-860's proposed energy storage table",
    transform: "records",
    headline: "records",
    form: "ranked-bars",
    per: { field: "State", top: 12 },
    section: "Capacity",
    note: "One record per planned storage generator as reported for 2025: records, not megawatts.",
  } satisfies RecordsTileSpec,
];

/** The Energy board's additions, in board order after its four core tiles: 18 tiles in all. */
const ENERGY_BOARD: readonly string[] = [
  "energy-production-mix",
  "natural-gas-production-stat",
  "coal-production-stat",
  "consumption-by-sector",
  "petroleum-products-supplied-stat",
  "natural-gas-consumption-stat",
  "petroleum-trade",
  "crude-oil-imports",
  "natural-gas-net-imports",
  "crude-oil-stocks",
  "crude-oil-price",
  "natural-gas-citygate-price",
  "co2-by-fuel",
  "co2-emissions-stat",
];

/** Power and utilities, 15 tiles in five sections. */
export const UTILITIES_BOARD: BoardSpec = {
  id: "05_utilities",
  title: "Power and utilities",
  tiles: [
    "generation-by-source",
    "generation-solar-stat",
    "generation-wind-stat",
    "electricity-sales-by-sector",
    "electricity-prices-by-sector",
    "natural-gas-price-power",
    "power-sector-co2-by-fuel",
    "power-sector-co2-stat",
    "egrid-state-generation",
    "egrid-state-co2-rate",
    "egrid-state-renewables",
    "net-metered-solar-capacity",
    "eia860-operable-generators-by-state",
    "eia860-proposed-generators-by-state",
    "eia860-proposed-storage-by-state",
  ],
};

export const SPECS: UnitSpecs = {
  unit: "energy",
  tiles: [...ENERGY_SERIES, ...ENERGY_FORMS, ...UTILITY_SERIES, ...UTILITY_FORMS],
  boards: [UTILITIES_BOARD],
  boardTiles: {
    "04_energy": ENERGY_BOARD,
    library: ["generation-by-source", "egrid-state-generation"],
  },
};
