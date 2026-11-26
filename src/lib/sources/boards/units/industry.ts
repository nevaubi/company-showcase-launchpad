import type { UnitSpecs } from "../compose";
import type {
  CompareTileSpec,
  MapTileSpec,
  RecordsTileSpec,
  SeriesTileSpec,
  StatTileSpec,
  TileSeriesSpec,
  TileSpec,
} from "../types";

/**
 * Tiles and boards of round 6 unit `industry`: a new board for Materials and mining (USGS DS140 commodity sheets,
 * MSHA's mine register and mine employment) and tiles for Consumer discretionary (NHTSA recall campaigns) and Consumer
 * staples (USDA ERS food price changes and forecasts). Every tile reads a family profiled in
 * `../../profiles/units/industry.ts`, or counts records. Each headline was computed once from production rows on
 * 26 Nov 2026 (the unit's report lists figure, period and snapshot). Pure data: no network; no shared list is edited.
 */

const DS140 = (id: string) => `official_07_materials_csv_ds140_${id}`;
const COPPER = DS140("ds140_copper_2020_copper_fe7a2ceced");
const LITHIUM = DS140("ds140_lithium_2021_lithium_statistics_5b2b81ee38");
const RARE_EARTHS = DS140("ds140_rare_earths_2020_rare_earths_b3eaf5640c");
const GOLD = DS140("ds140_gold_2022_gold_d2ef17c836");
const ALUMINUM = DS140("ds140_aluminum_2021_aluminum_ce6abb6cb0");
const IRON_ORE = DS140("ds140_iron_ore_2021_iron_ore_7857d02400");
const STEEL = DS140("ds140_iron_steel_2021_steel_c85682b436");
const CEMENT = DS140("ds140_cement_2021_cement_cae9732a17");
const CRUSHED_STONE = DS140("ds140_crushed_stone_2022_crushed_stone_4a6b577f2c");
const SAND_GRAVEL = DS140("ds140_construction_sand_and_20gravel_2022_construction_sand_and_gravel_4dcc870751");
const HELIUM = DS140("ds140_helium_2022_helium_a71a6a99f6");

const MSHA_MINE_COUNTS = "official_07_materials_csv_materials_mine_status_counts_4d6148ba31";
const MSHA_CURRENT_MINES = "official_07_materials_csv_current_materials_mines_475e8810e0";
const MSHA_ALL_MINES = "official_07_materials_csv_msha_mines_all_coal_metal_full_f59b9677c3";
const MSHA_STATE_SUBUNIT = "official_07_materials_csv_employment_state_history_1a337a72d0";

const NHTSA_BY_YEAR = "official_08_consumer_discretionary_recalls_year_d8884f5228";
const NHTSA_BY_MAKER = "official_08_consumer_discretionary_recalls_manufacturer_year_7d2c6c8fd6";

const ERS_CPI_ANNUAL = "official_09_consumer_staples_raw_annual_percent_changes_in_selected_consumer_price_indexes_1974_through_2025_56b8bc80d1";
const ERS_PPI_ANNUAL = "official_09_consumer_staples_raw_annual_percent_changes_in_selected_producer_price_indexes_1974_through_2025_f0035409fd";
const ERS_CPI_HISTORY = "official_09_consumer_staples_raw_historical_consumer_price_index_cpi_forecast_series_5ceebbebcd";

const MINERALS = "Mineral commodities";
const MINES = "Mines";
const EMPLOYMENT = "Mine employment";
const RECALLS = "Vehicle recalls";
const FOOD_PRICES = "Food prices";
const FORECASTS = "Food price forecasts";
const FARM = "Farm and wholesale prices";

const DS140_NOTE = "Annual, as USGS publishes the commodity sheet (Data Series 140); the sheet's last year is its latest revision.";

/** A level of one DS140 sheet's statistic, the whole sheet one series. */
const ds140Line = (spec: Omit<SeriesTileSpec, "collection" | "series" | "transform" | "headline" | "form" | "changeAs"> & { form?: SeriesTileSpec["form"] }): SeriesTileSpec => ({
  ...spec,
  collection: "07_materials",
  series: { whole: true },
  form: spec.form ?? "line",
  transform: "level",
  headline: "level",
  changeAs: "percent",
  section: spec.section ?? MINERALS,
});

/** A compact level of one DS140 statistic with its change from the year before. */
const ds140Stat = (spec: Omit<StatTileSpec, "collection" | "series" | "transform" | "headline" | "form" | "changeAs" | "decimals" | "section" | "note">): StatTileSpec => ({
  ...spec,
  collection: "07_materials",
  series: { whole: true },
  form: "stat",
  transform: "level",
  headline: "level",
  changeAs: "percent",
  decimals: 0,
  section: MINERALS,
  note: DS140_NOTE,
});

const whole = (measure: string, label: string, subject?: string): TileSeriesSpec => ({ measure, series: { whole: true }, label, ...(subject ? { subject } : {}) });

const MATERIALS_TILES: readonly TileSpec[] = [
  {
    id: "copper-production",
    collection: "07_materials",
    datasetId: COPPER,
    measure: "Primary production",
    title: "Copper, U.S. primary and secondary production",
    subject: "U.S. primary copper production",
    unit: "metric tons (t) copper content",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [whole("Primary production", "Primary production"), whole("Secondary production", "Secondary production", "secondary production")],
    window: 60,
    note: DS140_NOTE,
    section: MINERALS,
    size: "wide",
  } satisfies CompareTileSpec,
  ds140Line({
    id: "lithium-world-production",
    datasetId: LITHIUM,
    measure: "World production (lithium content)",
    title: "Lithium, world production (lithium content)",
    subject: "World lithium production",
    unit: "metric tons (t) lithium content",
    decimals: 0,
    window: 50,
    note: DS140_NOTE,
  }),
  {
    id: "copper-aluminum-real-value",
    collection: "07_materials",
    datasetId: COPPER,
    measure: "Unit value (98$/t)",
    title: "Copper and aluminum, unit value in constant 1998 dollars",
    subject: "The unit value of copper in constant 1998 dollars",
    unit: "98$/t",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [whole("Unit value (98$/t)", "Copper"), { datasetId: ALUMINUM, measure: "Unit value (98$/t)", series: { whole: true }, label: "Aluminum", subject: "aluminum" }],
    window: 60,
    note: "Annual. USGS states a unit value as the value of one metric ton, here in constant 1998 U.S. dollars by the Consumer Price Index (Data Series 140); each metal's sheet ends at its latest revision.",
    section: MINERALS,
    size: "wide",
  } satisfies CompareTileSpec,
  ds140Line({
    id: "gold-unit-value",
    datasetId: GOLD,
    measure: "Unit value ($/t)",
    title: "Gold, unit value",
    subject: "The unit value of gold",
    unit: "$/t",
    decimals: 0,
    window: 40,
    note: "Annual. USGS defines unit value as the value of one metric ton in current dollars (Data Series 140).",
  }),
  {
    id: "aluminum-production",
    collection: "07_materials",
    datasetId: ALUMINUM,
    measure: "Primary production",
    title: "Aluminum, U.S. primary and secondary production",
    subject: "U.S. primary aluminum production",
    unit: "metric tons (t) aluminum content",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [whole("Primary production", "Primary production"), whole("Secondary production", "Secondary production", "secondary production")],
    window: 40,
    note: DS140_NOTE,
    section: MINERALS,
  } satisfies CompareTileSpec,
  {
    id: "rare-earths-us",
    collection: "07_materials",
    datasetId: RARE_EARTHS,
    measure: "Production",
    title: "Rare earths, U.S. production, imports and apparent consumption",
    subject: "U.S. rare-earth production",
    unit: "metric tons (t) rare-earth oxide equivalent",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [whole("Production", "Production"), whole("Imports", "Imports", "imports"), whole("Apparent consumption", "Apparent consumption", "apparent consumption")],
    window: 40,
    note: DS140_NOTE,
    section: MINERALS,
  } satisfies CompareTileSpec,
  {
    id: "crushed-stone-sand-gravel-production",
    collection: "07_materials",
    datasetId: CRUSHED_STONE,
    measure: "Production",
    title: "Crushed stone and construction sand and gravel, U.S. production",
    subject: "U.S. crushed stone production",
    unit: "metric tons (t) gross weight",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "percent",
    lines: [whole("Production", "Crushed stone"), { datasetId: SAND_GRAVEL, measure: "Production", series: { whole: true }, label: "Construction sand and gravel", subject: "U.S. construction sand and gravel production" }],
    window: 40,
    note: DS140_NOTE,
    section: MINERALS,
  } satisfies CompareTileSpec,
  ds140Stat({ id: "iron-ore-production", datasetId: IRON_ORE, measure: "Production", title: "Iron ore, U.S. production", subject: "U.S. iron ore production", unit: "metric tons (t) gross weight" }),
  ds140Stat({ id: "raw-steel-production", datasetId: STEEL, measure: "Raw steel production", title: "Raw steel, U.S. production", subject: "U.S. raw steel production", unit: "metric tons (t)" }),
  ds140Stat({ id: "cement-production", datasetId: CEMENT, measure: "Production", title: "Cement, U.S. production", subject: "U.S. cement production", unit: "metric tons (t) gross weight" }),
  ds140Stat({ id: "helium-production", datasetId: HELIUM, measure: "Production", title: "Helium, U.S. production", subject: "U.S. helium production", unit: "metric tons (t) helium content" }),
  {
    id: "active-surface-mines-map",
    collection: "07_materials",
    datasetId: MSHA_MINE_COUNTS,
    measure: "Mine count",
    title: "Active metal and nonmetal surface mines by state",
    subject: "count of active surface mines",
    unit: "mine register records",
    decimals: 0,
    form: "map",
    transform: "level",
    headline: "rank",
    entities: "states and territories",
    across: {
      by: "geo_code",
      period: "table",
      where: [
        { field: "CURRENT_MINE_TYPE", value: "Surface" },
        { field: "CURRENT_MINE_STATUS", value: "Active" },
      ],
    },
    note: "Mines on MSHA's register with the status Active and the type Surface, counted by the store from MSHA's mine file as retrieved.",
    section: MINES,
  } satisfies MapTileSpec,
  {
    id: "mines-on-register-map",
    collection: "07_materials",
    datasetId: MSHA_CURRENT_MINES,
    title: "Metal and nonmetal mines on MSHA's register, abandoned mines left out, by state",
    subject: "MSHA's register of metal and nonmetal mines",
    transform: "records",
    headline: "records",
    form: "map",
    per: { dimension: "geo_code", top: 60 },
    note: "Records of the register, one per mine, with any status but abandoned (active, intermittent, idled, new and nonproducing).",
    section: MINES,
  } satisfies RecordsTileSpec,
  {
    id: "mines-ever-registered",
    collection: "07_materials",
    datasetId: MSHA_ALL_MINES,
    title: "Mines ever registered with MSHA, coal and metal and nonmetal, every status",
    subject: "MSHA's register of coal, metal and nonmetal mines",
    transform: "records",
    headline: "records",
    form: "ranked-bars",
    per: { dimension: "geo_code", top: 12 },
    note: "Records of the register, one per mine, abandoned mines included.",
    section: MINES,
  } satisfies RecordsTileSpec,
  {
    id: "pit-hours-map",
    collection: "07_materials",
    datasetId: MSHA_STATE_SUBUNIT,
    measure: "ANNUAL_HRS",
    title: "Employee hours at metal and nonmetal strip, quarry and open-pit operations, 2025",
    subject: "employee hours at strip, quarry and open-pit operations",
    unit: "employee-hours",
    decimals: 0,
    form: "map",
    transform: "level",
    headline: "rank",
    entities: "states and territories",
    across: { by: "geo_code", period: "2025", where: [{ field: "SUBUNIT_CD", value: "03" }] },
    note: "MSHA's subunit 03, summed by the store over MSHA's mine records by state. 2026 holds only the quarters reported so far, so the map shows 2025.",
    section: EMPLOYMENT,
  } satisfies MapTileSpec,
  {
    id: "pit-hours-change-map",
    collection: "07_materials",
    datasetId: MSHA_STATE_SUBUNIT,
    measure: "ANNUAL_HRS",
    title: "Change in employee hours at metal and nonmetal strip, quarry and open-pit operations, 2025 over 2024",
    subject: "employee hours at strip, quarry and open-pit operations",
    unit: "employee-hours",
    decimals: 0,
    form: "map",
    transform: "change-12m",
    changeAs: "difference",
    headline: "rank",
    entities: "states and territories",
    across: { by: "geo_code", period: "2025", where: [{ field: "SUBUNIT_CD", value: "03" }] },
    note: "The change from 2024 to 2025 in MSHA's subunit 03 hours, summed by the store over MSHA's mine records by state; 2026 holds only the quarters reported so far.",
    section: EMPLOYMENT,
  } satisfies MapTileSpec,
  {
    id: "mill-employees-map",
    collection: "07_materials",
    datasetId: MSHA_STATE_SUBUNIT,
    measure: "AVG_ANNUAL_EMPL",
    title: "Average employees at metal and nonmetal mills and preparation plants, 2025",
    subject: "average employment at mills and preparation plants",
    unit: "average employees",
    decimals: 0,
    form: "map",
    transform: "level",
    headline: "rank",
    entities: "states and territories",
    across: { by: "geo_code", period: "2025", where: [{ field: "SUBUNIT_CD", value: "30" }] },
    note: "MSHA's subunit 30 (mill operation or preparation plant), summed by the store over MSHA's mine records by state.",
    section: EMPLOYMENT,
  } satisfies MapTileSpec,
];

const maker = (name: string): TileSeriesSpec => ({ series: { where: [{ field: "Manufacturer", value: name }] }, label: name });

const RECALL_NOTE = "Counted once per NHTSA recall number, by the year NHTSA received the manufacturer's Part 573 report. The latest year counts the reports received up to the file's retrieval.";

const DISCRETIONARY_TILES: readonly TileSpec[] = [
  {
    id: "recall-campaigns-by-year",
    collection: "08_consumer_discretionary",
    datasetId: NHTSA_BY_YEAR,
    measure: "Distinct campaigns",
    title: "Safety recall campaigns by the year NHTSA received the report",
    subject: "NHTSA's recall file",
    verb: "had",
    unit: "recall campaigns",
    decimals: 0,
    form: "bars",
    transform: "level",
    headline: "level",
    series: { whole: true },
    window: 30,
    note: RECALL_NOTE,
    section: RECALLS,
  } satisfies SeriesTileSpec,
  {
    id: "recall-campaigns-detroit",
    collection: "08_consumer_discretionary",
    datasetId: NHTSA_BY_MAKER,
    measure: "Distinct campaigns",
    title: "Recall campaigns filed by Ford, Chrysler (FCA US), General Motors and Honda",
    subject: "Ford Motor Company",
    verb: "had",
    unit: "recall campaigns",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    lines: [maker("Ford Motor Company"), maker("Chrysler (FCA US, LLC)"), maker("General Motors, LLC"), maker("Honda (American Honda Motor Co.)")],
    window: 15,
    note: `${RECALL_NOTE} Manufacturers as NHTSA names the filer.`,
    section: RECALLS,
  } satisfies CompareTileSpec,
  {
    id: "recall-campaigns-imports",
    collection: "08_consumer_discretionary",
    datasetId: NHTSA_BY_MAKER,
    measure: "Distinct campaigns",
    title: "Recall campaigns filed by Volkswagen, BMW, Mercedes-Benz and Hyundai",
    subject: "Volkswagen Group of America, Inc.",
    verb: "had",
    unit: "recall campaigns",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    lines: [maker("Volkswagen Group of America, Inc."), maker("BMW of North America, LLC"), maker("Mercedes-Benz USA, LLC"), maker("Hyundai Motor America")],
    window: 15,
    note: `${RECALL_NOTE} Manufacturers as NHTSA names the filer.`,
    section: RECALLS,
  } satisfies CompareTileSpec,
  {
    id: "recall-campaigns-other-makers",
    collection: "08_consumer_discretionary",
    datasetId: NHTSA_BY_MAKER,
    measure: "Distinct campaigns",
    title: "Recall campaigns filed by Toyota, Nissan, Kia and Tesla",
    subject: "Toyota Motor Engineering & Manufacturing",
    verb: "had",
    unit: "recall campaigns",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    lines: [maker("Toyota Motor Engineering & Manufacturing"), maker("Nissan North America, Inc."), maker("Kia America, Inc."), maker("Tesla, Inc.")],
    window: 15,
    note: `${RECALL_NOTE} Manufacturers as NHTSA names the filer.`,
    section: RECALLS,
  } satisfies CompareTileSpec,
  {
    id: "recall-campaigns-rv-makers",
    collection: "08_consumer_discretionary",
    datasetId: NHTSA_BY_MAKER,
    measure: "Distinct campaigns",
    title: "Recall campaigns filed by recreational vehicle makers Forest River, Jayco, Keystone RV and Winnebago",
    subject: "Forest River, Inc.",
    verb: "had",
    unit: "recall campaigns",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    lines: [maker("Forest River, Inc."), maker("Jayco, Inc."), maker("Keystone RV Company"), maker("Winnebago Industries, Inc.")],
    window: 15,
    note: `${RECALL_NOTE} Manufacturers as NHTSA names the filer.`,
    section: RECALLS,
  } satisfies CompareTileSpec,
  {
    id: "recall-campaigns-truck-makers",
    collection: "08_consumer_discretionary",
    datasetId: NHTSA_BY_MAKER,
    measure: "Distinct campaigns",
    title: "Recall campaigns filed by truck makers Daimler Trucks, PACCAR, Volvo Trucks and Mack Trucks",
    subject: "Daimler Trucks North America, LLC",
    verb: "had",
    unit: "recall campaigns",
    decimals: 0,
    form: "compare",
    transform: "level",
    headline: "level",
    lines: [maker("Daimler Trucks North America, LLC"), maker("PACCAR Incorporated"), maker("Volvo Trucks North America"), maker("Mack Trucks, Inc.")],
    window: 15,
    note: `${RECALL_NOTE} Manufacturers as NHTSA names the filer.`,
    section: RECALLS,
  } satisfies CompareTileSpec,
];

const cpiItem = (item: string, label?: string): TileSeriesSpec => ({
  series: { where: [{ field: "Consumer Price Index item", value: item }] },
  label: label ?? item,
});
const ppiItem = (item: string, label?: string): TileSeriesSpec => ({ series: { where: [{ field: "Producer Price Index item", value: item }] }, label: label ?? item });
/** A CPI item on a tile of the PPI table: the series names the CPI table and its measure. */
const cpiItemOf = (item: string, label: string): TileSeriesSpec => ({ datasetId: ERS_CPI_ANNUAL, measure: "Percent change", ...cpiItem(item, label) });
const forecast = (item: string, attribute: string, label: string): TileSeriesSpec => ({
  series: {
    where: [
      { field: "Consumer Price Index item", value: item },
      { field: "Year being forecast", value: "2026" },
      { field: "Attribute", value: attribute },
    ],
  },
  label,
});

const ERS_ANNUAL_NOTE = "Annual average over the previous year's, as USDA ERS publishes it in the Food Price Outlook.";
const ERS_FORECAST_NOTE =
  "One point per monthly Food Price Outlook. ERS published no outlook from October to December 2025, so those months are gaps. The store's latest is the October 2026 outlook.";

const cpiStat = (id: string, item: string, title: string, subject: string): StatTileSpec => ({
  id,
  collection: "09_consumer_staples",
  datasetId: ERS_CPI_ANNUAL,
  measure: "Percent change",
  title,
  subject,
  unit: "Percent",
  decimals: 1,
  form: "stat",
  transform: "level",
  headline: "level",
  series: { where: [{ field: "Consumer Price Index item", value: item }] },
  changeAs: "difference",
  window: 24,
  note: ERS_ANNUAL_NOTE,
  section: FOOD_PRICES,
});

const STAPLES_TILES: readonly TileSpec[] = [
  {
    id: "food-at-home-vs-away",
    collection: "09_consumer_staples",
    datasetId: ERS_CPI_ANNUAL,
    measure: "Percent change",
    title: "Consumer Price Index, food at home and food away from home, annual percent change",
    subject: "The annual change in the CPI for food at home",
    unit: "Percent",
    decimals: 1,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "difference",
    lines: [cpiItem("Food at home"), cpiItem("Food away from home", "Food away from home")],
    window: 30,
    note: ERS_ANNUAL_NOTE,
    section: FOOD_PRICES,
  } satisfies CompareTileSpec,
  cpiStat("eggs-cpi-annual", "Eggs", "Eggs, CPI annual change", "The annual change in the CPI for eggs"),
  cpiStat("beef-cpi-annual", "Beef and veal", "Beef and veal, CPI annual change", "The annual change in the CPI for beef and veal"),
  cpiStat("sugar-cpi-annual", "Sugar and sweets", "Sugar and sweets, CPI annual change", "The annual change in the CPI for sugar and sweets"),
  cpiStat(
    "beverages-cpi-annual",
    "Nonalcoholic beverages",
    "Nonalcoholic beverages, CPI annual change",
    "The annual change in the CPI for nonalcoholic beverages",
  ),
  {
    id: "cattle-and-beef-ppi",
    collection: "09_consumer_staples",
    datasetId: ERS_PPI_ANNUAL,
    measure: "Percent change",
    title: "Producer Price Index, farm-level cattle and wholesale beef, annual percent change",
    subject: "The annual change in the PPI for farm-level cattle",
    unit: "Percent",
    decimals: 1,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "difference",
    lines: [ppiItem("Farm-level cattle"), ppiItem("Wholesale beef")],
    window: 30,
    note: ERS_ANNUAL_NOTE,
    section: FARM,
  } satisfies CompareTileSpec,
  {
    id: "eggs-farm-and-retail",
    collection: "09_consumer_staples",
    datasetId: ERS_PPI_ANNUAL,
    measure: "Percent change",
    title: "Eggs, farm-level producer prices and consumer prices, annual percent change",
    subject: "The annual change in the PPI for farm-level eggs",
    unit: "Percent",
    decimals: 1,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "difference",
    lines: [ppiItem("Farm-level eggs", "Farm-level eggs (PPI)"), cpiItemOf("Eggs", "Eggs (CPI)")],
    window: 30,
    note: `${ERS_ANNUAL_NOTE} The farm-level series is a Producer Price Index, the retail series a Consumer Price Index.`,
    section: FARM,
  } satisfies CompareTileSpec,
  {
    id: "wheat-farm-to-retail",
    collection: "09_consumer_staples",
    datasetId: ERS_PPI_ANNUAL,
    measure: "Percent change",
    title: "Farm-level wheat, wholesale wheat flour, and cereals and bakery products, annual percent change",
    subject: "The annual change in the PPI for farm-level wheat",
    unit: "Percent",
    decimals: 1,
    form: "compare",
    transform: "level",
    headline: "level",
    changeAs: "difference",
    lines: [ppiItem("Farm-level wheat", "Farm-level wheat (PPI)"), ppiItem("Wholesale wheat flour", "Wholesale wheat flour (PPI)"), cpiItemOf("Cereals and bakery products", "Cereals and bakery products (CPI)")],
    window: 30,
    note: `${ERS_ANNUAL_NOTE} Farm-level and wholesale series are Producer Price Indexes, cereals and bakery products a Consumer Price Index.`,
    section: FARM,
  } satisfies CompareTileSpec,
  {
    id: "all-food-forecast-2026",
    collection: "09_consumer_staples",
    datasetId: ERS_CPI_HISTORY,
    measure: "Forecast percent change",
    title: "ERS forecast of the 2026 change in the CPI for all food, by outlook",
    subject: "The midpoint of ERS's forecast for all food in 2026",
    unit: "Percent",
    decimals: 1,
    form: "compare",
    transform: "level",
    headline: "level",
    lines: [
      forecast("All food", "Midpoint of forecast interval", "Midpoint"),
      forecast("All food", "Lower bound of forecast interval", "Lower bound"),
      forecast("All food", "Upper bound of forecast interval", "Upper bound"),
    ],
    window: 16,
    note: ERS_FORECAST_NOTE,
    section: FORECASTS,
    size: "wide",
  } satisfies CompareTileSpec,
  {
    id: "food-at-home-forecast-2026",
    collection: "09_consumer_staples",
    datasetId: ERS_CPI_HISTORY,
    measure: "Forecast percent change",
    title: "ERS forecast of the 2026 change in the CPI for food at home, by outlook",
    subject: "The midpoint of ERS's forecast for food at home in 2026",
    unit: "Percent",
    decimals: 1,
    form: "compare",
    transform: "level",
    headline: "level",
    lines: [
      forecast("Food at home", "Midpoint of forecast interval", "Midpoint"),
      forecast("Food at home", "Lower bound of forecast interval", "Lower bound"),
      forecast("Food at home", "Upper bound of forecast interval", "Upper bound"),
    ],
    window: 16,
    note: ERS_FORECAST_NOTE,
    section: FORECASTS,
  } satisfies CompareTileSpec,
];

const ids = (tiles: readonly TileSpec[]) => tiles.map((t) => t.id);

export const SPECS: UnitSpecs = {
  unit: "industry",
  tiles: [...MATERIALS_TILES, ...DISCRETIONARY_TILES, ...STAPLES_TILES],
  boards: [{ id: "07_materials", title: "Materials and mining", tiles: ids(MATERIALS_TILES) }],
  boardTiles: {
    "08_consumer_discretionary": ids(DISCRETIONARY_TILES),
    "09_consumer_staples": ids(STAPLES_TILES),
    library: ["copper-production", "food-at-home-vs-away"],
  },
};
