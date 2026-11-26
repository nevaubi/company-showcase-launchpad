import { defineProfile } from "./define";
import type { Cadence, Profile, ProfileDataset, ProfileEntry } from "./types";

/**
 * FRED single-series files: two fields, `observation_date` (the record's period, declared as the period
 * dimension) and a field named after the series code that holds the value. The dictionary states no unit
 * and no type, so a series is drawn only when it is listed here with the unit FRED states on its series
 * page, checked against that page, the store's own series catalogue (retrieved with the data) and FRED's
 * graph file (every stored value of the checked window equal, or a later revision named in the report).
 * The first 19 were checked on 25 Nov 2026 (boards report), the rest on 26 Nov 2026 (fred report: the
 * last 24 stored rows of each equal FRED's file). A series that is not listed gets no measure chart.
 *
 * FRED dates every observation by the first day of its period (a month, a quarter) or, for a weekly
 * series, by the day the week ends; the cadence says which, so "2026-10-01" is read as Oct 2026.
 */
export type FredSeries = {
  code: string;
  /** FRED's title of the series. */
  title: string;
  /** "Units:" as FRED's series page states it, without the adjustment. */
  unit: string;
  /** The adjustment FRED states beside the unit. */
  adjustment: "Seasonally Adjusted" | "Not Seasonally Adjusted" | "Seasonally Adjusted Annual Rate";
  cadence: Cadence;
  /** For a weekly series: the day each week ends, as FRED states the frequency. */
  weekEnding?: string;
  /** The snapshot the check read. */
  snapshotId: string;
  datasetId: string;
  /** Rows of that snapshot: the whole series is read in row order. */
  rows: number;
};

/** Checked on 25 Nov 2026. */
const CHECKED_25_NOV: readonly FredSeries[] = [
  { code: "CPIAUCNS", title: "Consumer Price Index for All Urban Consumers: All Items in U.S. City Average", unit: "Index 1982-1984=100", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "4578f05e3ab18846e819eb29dda922f3ee6a9cbe2bf2b10192be7ad68c771e31", datasetId: "official_09_consumer_staples_raw_fred_cpiaucns_c8a57a978a", rows: 322 },
  { code: "CPIUFDSL", title: "Consumer Price Index for All Urban Consumers: Food in U.S. City Average", unit: "Index 1982-1984=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "afbb53f6a90390e184e0ea12d0a39d8fce92c3eae79ca79c0f03b67c729fa54d", datasetId: "official_09_consumer_staples_raw_fred_cpiufdsl_7b34566789", rows: 322 },
  { code: "CUSR0000SEFV", title: "Consumer Price Index for All Urban Consumers: Food Away from Home in U.S. City Average", unit: "Index 1982-1984=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "9a221bef66298b31858f5e1539174fb3f69ffbe25e778f4b4c9aa0ffd08ecbfa", datasetId: "official_09_consumer_staples_raw_fred_cusr0000sefv_80c6f8b4c5", rows: 322 },
  { code: "PCEPI", title: "Personal Consumption Expenditures: Chain-type Price Index", unit: "Index 2017=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "0a1c78c13aa469b86cfa1a3fb34e010204d33cf0ad2cd52f0abf66e7ab703f14", datasetId: "official_00_universal_raw_fred_pcepi_6220e72d37", rows: 321 },
  { code: "UNRATE", title: "Unemployment Rate", unit: "Percent", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "0d1a5ef3747ea9e1757d97d83ac82c78cc9b439fb7770a3c99b5afc4f8acc82c", datasetId: "official_00_universal_raw_fred_unrate_3286ca8718", rows: 322 },
  { code: "FEDFUNDS", title: "Federal Funds Effective Rate", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "c38dfc80c540d43a41ed7ce46ae200e6f870b55f788e91f152d7b9f1bbd1d8b5", datasetId: "official_00_universal_raw_fred_fedfunds_60a510e6af", rows: 322 },
  { code: "GS10", title: "Market Yield on U.S. Treasury Securities at 10-Year Constant Maturity, Quoted on an Investment Basis", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "0bf14d29c40d719b45cc8b45c805275e664ab5853c54c795899d5d36eb479986", datasetId: "official_00_universal_raw_fred_gs10_83de07f258", rows: 322 },
  { code: "GDPC1", title: "Real Gross Domestic Product", unit: "Billions of Chained 2017 Dollars", adjustment: "Seasonally Adjusted Annual Rate", cadence: "quarter", snapshotId: "35e62d99d9992a378e520e20a772c9972c158463dda6cfcc255c5493a556242c", datasetId: "official_00_universal_raw_fred_gdpc1_66c002f48e", rows: 107 },
  { code: "ICSA", title: "Initial Claims", unit: "Number", adjustment: "Seasonally Adjusted", cadence: "week", weekEnding: "Saturday", snapshotId: "7126f433d670aba2309f1498a02bde172e94d2ce8ee4606f6abdfd531f16cc0c", datasetId: "official_00_universal_raw_fred_icsa_6f2afbca3c", rows: 1403 },
  { code: "MORTGAGE30US", title: "30-Year Fixed Rate Mortgage Average in the United States", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "week", weekEnding: "Thursday", snapshotId: "a2e3b524f380e483dac7d515bcb7ae35d0dc69a53b5a65e35e5ad4fab3a6cbcf", datasetId: "official_11_real_estate_raw_fred_mortgage30us_dbaf839e72", rows: 1403 },
  { code: "HOUST", title: "New Privately-Owned Housing Units Started: Total Units", unit: "Thousands of Units", adjustment: "Seasonally Adjusted Annual Rate", cadence: "month", snapshotId: "577742bdeb059e560cec273b2e0496f48b60f1193c435cd105db5f9d635ed41b", datasetId: "official_11_real_estate_raw_fred_houst_2f8d88288f", rows: 322 },
  { code: "CSUSHPINSA", title: "S&P Cotality Case-Shiller U.S. National Home Price Index", unit: "Index Jan 2000=100", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "8dd4cda6be52c0c0a19ade14d160f379f0b486bea259fca5ffd8d0e8e33c2187", datasetId: "official_11_real_estate_raw_fred_csushpinsa_4546d8e855", rows: 320 },
  { code: "MSPNHSUS", title: "Median Sales Price for New Houses Sold in the United States", unit: "Dollars", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "ccd327892c5ff750925b39495297b7b2d858100dd88dea029f5107dab9bdcac5", datasetId: "official_11_real_estate_raw_fred_mspnhsus_cbb7225da9", rows: 321 },
  { code: "RSAFS", title: "Advance Retail Sales: Retail Trade and Food Services", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "0478b7c9df0a6bf39350690304b4a707326402356f2fef74a38d3e09d0127c87", datasetId: "official_08_consumer_discretionary_raw_fred_rsafs_a6e0a3815f", rows: 322 },
  { code: "TOTALSA", title: "Total Vehicle Sales", unit: "Millions of Units", adjustment: "Seasonally Adjusted Annual Rate", cadence: "month", snapshotId: "ea1adfbfd08f14d07025c2112d2b19dada952b06c4bbba442025cac7315b49e0", datasetId: "official_08_consumer_discretionary_raw_fred_totalsa_b2b7f5ec9c", rows: 322 },
  { code: "ECOMPCTSA", title: "E-Commerce Retail Sales as a Percent of Total Sales", unit: "Percent", adjustment: "Seasonally Adjusted", cadence: "quarter", snapshotId: "0c9696b5e688ab708ed9ca84c894701e08fb65d6ab4d48f5ca83d2c7620af5d0", datasetId: "official_08_consumer_discretionary_raw_fred_ecompctsa_98e8171a3a", rows: 107 },
  { code: "DGORDER", title: "Manufacturers' New Orders: Durable Goods", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "4e81de424914a7f9a9bfa2e16fedad2e4b9a6b0be79ecd6be2c6d15b7a568ef9", datasetId: "official_06_industrials_raw_fred_dgorder_8974ef3329", rows: 321 },
  { code: "TSIFRGHT", title: "Freight Transportation Services Index", unit: "Index 2000=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "d16a96b1376f417effe5465aeadeac29afe27aabf11e065fb44dd573b64df8f1", datasetId: "official_06_industrials_raw_fred_tsifrght_19732278ec", rows: 320 },
  { code: "MANEMP", title: "All Employees, Manufacturing", unit: "Thousands of Persons", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "3f342f7dade37c520340195cee324f8e0e5059d797e32cd7ac3a56c34623ec16", datasetId: "official_06_industrials_raw_fred_manemp_ae6a27a459", rows: 322 },
];

/** Checked on 26 Nov 2026: unit and frequency as the store's catalogue and FRED's page state them, the last 24 stored rows equal FRED's file. */
const CHECKED_26_NOV: readonly FredSeries[] = [
  { code: "AIRRPMTSID11", title: "Air Revenue Passenger Miles", unit: "Thousands", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "0d9c643f0cb19d0900334d4b0b16a9ba9b7c158ffdcc514658d2b0fb42aa0909", datasetId: "official_06_industrials_raw_fred_airrpmtsid11_1d8b6455f9", rows: 319 },
  { code: "AMTMNO", title: "Manufacturers' New Orders: Total Manufacturing", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "c48a603bdda83db6a7c750d52897e7322d88e3c09464a00ca7a352eb44b682bf", datasetId: "official_06_industrials_raw_fred_amtmno_17ff88a923", rows: 321 },
  { code: "AMTMTI", title: "Manufacturers' Total Inventories: Total Manufacturing", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "45d7e14462ce9400c6e9a2ecbf57a418fb1ae8fd477182862b5ea6e05aa978f8", datasetId: "official_06_industrials_raw_fred_amtmti_9819c49e4b", rows: 321 },
  { code: "AMTMVS", title: "Manufacturers' Value of Shipments: Total Manufacturing", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "5ab1bb413fac7f7ed2218cf225e8cad2fe4f58d09590d04b978ec6d28a8006e6", datasetId: "official_06_industrials_raw_fred_amtmvs_3e9b8beede", rows: 321 },
  { code: "ASPNHSUS", title: "Average Sales Price for New Houses Sold in the United States", unit: "Dollars", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "e187f0259cfbdd13957812d407a4e4be8c6917e579151c00c01fd4772229afc2", datasetId: "official_11_real_estate_raw_fred_aspnhsus_3c728c9e16", rows: 322 },
  { code: "AWHMAN", title: "Average Weekly Hours of Production and Nonsupervisory Employees, Manufacturing", unit: "Hours", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "c64e455eb22404a4dfd55fc449e2571443bd20d162e10f95f9dd910194ff348d", datasetId: "official_06_industrials_raw_fred_awhman_6bfe61b8fa", rows: 322 },
  { code: "CES3231100001", title: "All Employees, Food Manufacturing", unit: "Thousands of Persons", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "2d23e8e868a43730ccb21dc7e6d5c3f51266b1842162a2e7a7411f116ef9a027", datasetId: "official_09_consumer_staples_raw_fred_ces3231100001_69d7580241", rows: 322 },
  { code: "CES3231200001", title: "All Employees: Nondurable Goods: Beverages and Tobacco Products (DISCONTINUED)", unit: "Thousands of Persons", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "c9b3d02a1029fb3a0fae84e56b6b45a9f41e452b1db20bbaba6ccafe7e602f84", datasetId: "official_09_consumer_staples_raw_fred_ces3231200001_1364ea1c26", rows: 156 },
  { code: "CES3232500001", title: "All Employees, Chemical Manufacturing", unit: "Thousands of Persons", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "fa5138fe8af4f17a7890b6d91fb5cf4c5d8df56383e3a4be69507c25c44d682e", datasetId: "official_09_consumer_staples_raw_fred_ces3232500001_213d30203c", rows: 322 },
  { code: "CES4300000001", title: "All Employees, Transportation and Warehousing", unit: "Thousands of Persons", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "6c2637e72adaed06160674997746fde7e948dcb957e4dbdd4db8898ded69a690", datasetId: "official_06_industrials_raw_fred_ces4300000001_03cef3c8c6", rows: 322 },
  { code: "CES7072000001", title: "All Employees, Accommodation and Food Services", unit: "Thousands of Persons", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "b0e8b490f08ee983e2a8d66732ddbfe7400b9f0d3a4014e629843ef2d98ac107", datasetId: "official_08_consumer_discretionary_raw_fred_ces7072000001_056c9c7bd2", rows: 322 },
  { code: "CIVPART", title: "Labor Force Participation Rate", unit: "Percent", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "e01ea42e6d8d9c45bf420be9ad3bb268750c426a1d63c1f627ee40dbc31387e2", datasetId: "official_00_universal_raw_fred_civpart_af6b261f31", rows: 322 },
  { code: "COMPUTSA", title: "New Privately-Owned Housing Units Completed: Total Units", unit: "Thousands of Units", adjustment: "Seasonally Adjusted Annual Rate", cadence: "month", snapshotId: "512b599b844a88844c54a20e5f3335f8c78c57973fb31b57fcd7c349f53c17aa", datasetId: "official_11_real_estate_raw_fred_computsa_8cda69aeb6", rows: 322 },
  { code: "CPIAUCSL", title: "Consumer Price Index for All Urban Consumers: All Items in U.S. City Average", unit: "Index 1982-1984=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "e1f5b3e0fbe93f4d90ada4d4b315cbc6cb6d055d55a5ec1af4fe2aa530cf92f0", datasetId: "official_00_universal_raw_fred_cpiaucsl_2f7637f02f", rows: 322 },
  { code: "CPILFESL", title: "Consumer Price Index for All Urban Consumers: All Items Less Food and Energy in U.S. City Average", unit: "Index 1982-1984=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "9c0bcfe8b5ecfaf8800c005a884e79584f38c047f4f51f332d3356d9e7fcf225", datasetId: "official_00_universal_raw_fred_cpilfesl_e6f9ec4e3f", rows: 322 },
  { code: "CUSR0000SAF11", title: "Consumer Price Index for All Urban Consumers: Food at Home in U.S. City Average", unit: "Index 1982-1984=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "5ed0321bb23bebcf6ecfb261d0ddd8677f621990e2d4795465ed697f7cf13ccb", datasetId: "official_09_consumer_staples_raw_fred_cusr0000saf11_da16f312cb", rows: 322 },
  { code: "CUSR0000SEHA", title: "Consumer Price Index for All Urban Consumers: Rent of Primary Residence in U.S. City Average", unit: "Index 1982-1984=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "41c38da637fe5123fda6a07d01266327400d8d4289f4429a680689702c1692cd", datasetId: "official_11_real_estate_raw_fred_cusr0000seha_36a4f89c12", rows: 322 },
  { code: "CUSR0000SEHC", title: "Consumer Price Index for All Urban Consumers: Owners' Equivalent Rent of Residences in U.S. City Average", unit: "Index Dec 1982=100", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "f4b644a0eb05f51f1bbc92883a088f2bcc259c4b4421bfb0fd498a505d0a7baf", datasetId: "official_11_real_estate_raw_fred_cusr0000sehc_9b4c95c81e", rows: 322 },
  { code: "ECOMSA", title: "E-Commerce Retail Sales", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "quarter", snapshotId: "d8d504eacd328a50eb364e41cac39c5f93d165826995bf437f7b1316c85aa1c9", datasetId: "official_08_consumer_discretionary_raw_fred_ecomsa_c68f544dfa", rows: 107 },
  { code: "EMRATIO", title: "Employment-Population Ratio", unit: "Percent", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "4c89b07011225fac07b0799e66cd0b150e9b04a7ea703ef53646c1e5958ee54a", datasetId: "official_00_universal_raw_fred_emratio_c7b1c5e3e0", rows: 322 },
  { code: "GS2", title: "Market Yield on U.S. Treasury Securities at 2-Year Constant Maturity, Quoted on an Investment Basis", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "38b05c8284dffbcca8cfa908f8e92c8d7c244927890d98bf8060bbe3798c468d", datasetId: "official_00_universal_raw_fred_gs2_70ad200e92", rows: 322 },
  { code: "GS30", title: "Market Yield on U.S. Treasury Securities at 30-Year Constant Maturity, Quoted on an Investment Basis", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "month", snapshotId: "860b36a8675f23d82c869bec33d0070dbb13455d623ca45544773c0ffe80481e", datasetId: "official_00_universal_raw_fred_gs30_a1b0a3a169", rows: 322 },
  { code: "HOUST1F", title: "New Privately-Owned Housing Units Started: Single-Family Units", unit: "Thousands of Units", adjustment: "Seasonally Adjusted Annual Rate", cadence: "month", snapshotId: "3d0a977844f3f05957d0e6c48bd8d25620c63a19e562c84fdf678f6676bd0fd2", datasetId: "official_11_real_estate_raw_fred_houst1f_971795b857", rows: 322 },
  { code: "HOUST5F", title: "New Privately-Owned Housing Units Started: Units in Buildings with 5 Units or More", unit: "Thousands of Units", adjustment: "Seasonally Adjusted Annual Rate", cadence: "month", snapshotId: "05d1fa20336333cf82871359a094edddb062952f0df4bd34284659eb8e4775ea", datasetId: "official_11_real_estate_raw_fred_houst5f_285b717333", rows: 322 },
  { code: "HSN1F", title: "New One Family Houses Sold: United States", unit: "Thousands", adjustment: "Seasonally Adjusted Annual Rate", cadence: "month", snapshotId: "9d7679dd0499ac0b261f1a93f20e2585e3138db05c9c74cfad3132d1579b9704", datasetId: "official_11_real_estate_raw_fred_hsn1f_04f38d1309", rows: 322 },
  { code: "JTSJOL", title: "Job Openings: Total Nonfarm", unit: "Level in Thousands", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "53a1fbfa35ec99213a9144ef5100d1b25ceb304101b22e22dc611c143026cd15", datasetId: "official_00_universal_raw_fred_jtsjol_ba481d2b0a", rows: 310 },
  { code: "MORTGAGE15US", title: "15-Year Fixed Rate Mortgage Average in the United States", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "week", weekEnding: "Thursday", snapshotId: "23014f1ee3675d624cdec1a186780a08f8a6a9d312df69e95512bda6f341c148", datasetId: "official_11_real_estate_raw_fred_mortgage15us_eadc9e515f", rows: 1404 },
  { code: "MRTSSM441USS", title: "Retail Sales: Motor Vehicle and Parts Dealers", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "ebae72c6d926ab64bf109a9b023c8c5727782ff8f6cfc844996b44baf872a307", datasetId: "official_08_consumer_discretionary_raw_fred_mrtssm441uss_b65d4d1014", rows: 321 },
  { code: "MRTSSM442USS", title: "Retail Sales: Furniture and Home Furnishings Stores", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "5ce14a4127e248f0c848b70dc18cd2620d3e7126fdb328b0229db97702bab9a8", datasetId: "official_08_consumer_discretionary_raw_fred_mrtssm442uss_d6892cab05", rows: 321 },
  { code: "MRTSSM445USS", title: "Retail Sales: Food and Beverage Stores", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "24eaa98501dc87ab6f1fddd2d83b23799c25ff793183696f0670d8df88251283", datasetId: "official_09_consumer_staples_raw_fred_mrtssm445uss_6f3de03950", rows: 321 },
  { code: "MRTSSM448USS", title: "Retail Sales: Clothing and Clothing Accessory Stores", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "a91f38eb247bf8fbbbc1eecaf6bee9c66ae97133a9530b9bc330f928f38d3caf", datasetId: "official_08_consumer_discretionary_raw_fred_mrtssm448uss_81143b483c", rows: 321 },
  { code: "MRTSSM451USS", title: "Retail Sales: Sporting Goods, Hobby, Musical Instrument, and Book Stores", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "a6c7f7abb7eacfd2acd90b2f1a9a65213f1b308110ffbcda453c875e9d8fd360", datasetId: "official_08_consumer_discretionary_raw_fred_mrtssm451uss_6b1a113b80", rows: 321 },
  { code: "MRTSSM452USS", title: "Retail Sales: General Merchandise Stores", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "86d90941477d82510dfe4f6777f7762333f4395d0d0358305038d3482c338216", datasetId: "official_08_consumer_discretionary_raw_fred_mrtssm452uss_490eaa2d78", rows: 321 },
  { code: "MRTSSM722USS", title: "Retail Sales: Food Services and Drinking Places", unit: "Millions of Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "3f683d37af7cc3eb13adc8fc011babe4e6fb60aa8b2b9c02203a07f43eca4f80", datasetId: "official_08_consumer_discretionary_raw_fred_mrtssm722uss_6aebc6411b", rows: 321 },
  { code: "PAYEMS", title: "All Employees, Total Nonfarm", unit: "Thousands of Persons", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "d3b3cad2cf6685073f5c1b7a76465c504053a41ece3df7a0f70342999717ed2c", datasetId: "official_00_universal_raw_fred_payems_4ed01ff72c", rows: 322 },
  { code: "PCEND", title: "Personal Consumption Expenditures: Nondurable Goods", unit: "Billions of Dollars", adjustment: "Seasonally Adjusted Annual Rate", cadence: "month", snapshotId: "6616dd398fac2df7b2ab5a146f1a11d9450a4ffa9fd33dfc7d8546f7c50d1bc6", datasetId: "official_09_consumer_staples_raw_fred_pcend_68544f9668", rows: 322 },
  { code: "RAILFRTCARLOADSD11", title: "Rail Freight Carloads", unit: "Carloads", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "7773db04e6b224528ade301fdc89a97bda1786f994c329589b1997728d3cef0b", datasetId: "official_06_industrials_raw_fred_railfrtcarloadsd11_637421be33", rows: 320 },
  { code: "RHVRUSQ156N", title: "Homeowner Vacancy Rate in the United States", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "quarter", snapshotId: "bb37ac6733b86c2667cfd909cbb5551904e8122f900dec23e3cd92948e963520", datasetId: "official_11_real_estate_raw_fred_rhvrusq156n_522a4367b9", rows: 107 },
  { code: "RRSFS", title: "Advance Real Retail and Food Services Sales", unit: "Millions of 1982-84 CPI Adjusted Dollars", adjustment: "Seasonally Adjusted", cadence: "month", snapshotId: "c3b5585858a751066e8d5254e04da5ddb14dbb0cf6aa233b4cc450aec01113e5", datasetId: "official_08_consumer_discretionary_raw_fred_rrsfs_cfee919a59", rows: 322 },
  { code: "RRVRUSQ156N", title: "Rental Vacancy Rate in the United States", unit: "Percent", adjustment: "Not Seasonally Adjusted", cadence: "quarter", snapshotId: "ae259bdfec87298b13c2232201adedfb34467bdab8a6e4fd166a8815c298e2e2", datasetId: "official_11_real_estate_raw_fred_rrvrusq156n_36dac8b82c", rows: 107 },
];

export const FRED_SERIES: readonly FredSeries[] = [...CHECKED_25_NOV, ...CHECKED_26_NOV];

/** The day each series was checked, for its proof. */
const CHECKED_ON = new Map<string, string>([
  ...CHECKED_25_NOV.map((s) => [s.code, "2026-11-25"] as const),
  ...CHECKED_26_NOV.map((s) => [s.code, "2026-11-26"] as const),
]);

const IP_REBASED =
  "The store's series catalogue states Index 2017=100 (retrieved 24 Nov 2026); FRED's page now states Index 2022=100, so the stored unit cannot be established at the publisher.";
const tooLong = (frequency: string, rows: number) =>
  `${frequency} series of ${rows.toLocaleString("en-US")} rows: a first look reads at most 4,999 records, so its latest observations would not be drawn.`;

/**
 * Series that were checked and refused, with the reason, so nobody adds them back without a new check.
 * IPMAN: the stored values are on the base the store's catalogue states (Index 2017=100); FRED's page now
 * states Index 2022=100 and every value of the checked window differs, so the stored unit cannot be
 * established at the publisher. The other industrial production series are in the same state.
 * A daily series longer than a first look reads (4,999 records) would be drawn without its latest
 * observations, and WALCL's period (a Wednesday level) is not a week ending.
 */
export const FRED_REFUSED: Readonly<Record<string, string>> = {
  IPMAN: "Stored on Index 2017=100 as catalogued at retrieval; FRED now states Index 2022=100 and all 48 checked values differ.",
  INDPRO: IP_REBASED,
  IPG311A2S: IP_REBASED,
  IPG322S: IP_REBASED,
  IPG325S: IP_REBASED,
  IPG332S: IP_REBASED,
  IPG333S: IP_REBASED,
  IPG3361T3S: IP_REBASED,
  IPG3364S: IP_REBASED,
  DEXCHUS: tooLong("Daily", 7015),
  DEXJPUS: tooLong("Daily", 7015),
  DEXUSEU: tooLong("Daily", 7015),
  DFF: tooLong("Daily, 7-Day", 9821),
  DTWEXBGS: tooLong("Daily", 5450),
  WALCL:
    "FRED states the frequency as Weekly, As of Wednesday (the level on each Wednesday); a weekly cadence here reads a period as the week ending on its date, which would misstate it.",
};

const BY_CODE = new Map(FRED_SERIES.map((s) => [s.code, s] as const));

/** The series code of a FRED file, from its registered source id ("FRED_UNRATE"). */
export function fredCode(dataset: ProfileDataset): string | null {
  return dataset.source_id?.startsWith("FRED_") ? dataset.source_id.slice(5) : null;
}

export function fredSeries(dataset: ProfileDataset): FredSeries | null {
  const code = fredCode(dataset);
  return code ? (BY_CODE.get(code) ?? null) : null;
}

const claims = (dataset: ProfileDataset) => fredSeries(dataset) !== null;

function fredProfile(dataset: ProfileDataset): Profile {
  const series = fredSeries(dataset);
  if (!series) throw new Error(`no checked FRED series for ${dataset.id}`);
  return defineProfile(claims, {
    family: "fred",
    period: { from: "dimension", format: "iso-date" },
    cadence: series.cadence,
    measures: [
      {
        field: series.code,
        label: series.title,
        unit: { from: "constant", text: series.unit, evidence: `https://fred.stlouisfed.org/series/${series.code}` },
        grouping: "none",
      },
    ],
    extraFields: ["observation_date"],
    addressing: {
      by: null,
      where: [],
      scan: "table",
      rowsScanned: series.rows,
      note: "One series per file: the whole snapshot is read in row order, at most five pages of 1,000 rows.",
    },
    defaultSeries: () => ({ whole: true }),
    firstLook: "series",
    proof: {
      snapshotId: series.snapshotId,
      datasetId: series.datasetId,
      checked: CHECKED_ON.get(series.code) ?? "2026-11-25",
      documentation: [`https://fred.stlouisfed.org/series/${series.code}`, `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${series.code}`],
    },
  });
}

export const FRED_ENTRY: ProfileEntry = { family: "fred", claims, profile: fredProfile };
