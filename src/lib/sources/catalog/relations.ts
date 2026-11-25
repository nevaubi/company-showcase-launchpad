import storedParents from "./audit-parents.json";
import storedRoles from "./audit-roles.json";
import type { CatalogInput, CatalogIssue, CatalogKind } from "./types";

/**
 * What a dataset is in relation to the others: the publisher's own table, a cut of one, a figure
 * computed from one, a dictionary, or one of the kit's own sheets.
 *
 * Three sources, in this order of precedence:
 * 1. `AUDIT`: relations the audit of 25 Nov 2026 established by reading rows and counts
 *    (`/home/claude/fu/round4/reports/data.md`, sections 1 and 5).
 * 2. `audit-roles.json` and `audit-parents.json`: the role each latest snapshot declares in
 *    `coverage.population_role` and the parent its `coverage.overlaps_files` names, read from
 *    production on 25 Nov 2026 (72 roles, 52 single parents).
 * 3. Rules on the id for the shapes that repeat (FRED panels, dictionaries, inventories).
 */

const ROLE_KIND: Record<string, CatalogKind> = {
  P: "projection", // projection_or_subset
  T: "projection", // partition_of_complete_panel
  M: "projection", // derived_period_projection
  A: "derived", // derived_aggregate
  D: "reference", // dimension_or_dictionary
  X: "native", // exact_duplicate_alias: the kept copy of two identical files
};

const o = (tail: string) => `official_${tail}`;

type Relation = { kind: CatalogKind; parent?: string };

const FDIC_PANEL = o("01_financials_data_fdic_top500_all_native_quarterly_2000_latest_f5f72a5b7b");
const FDIC_SOD = o("01_financials_data_fdic_top500_2026_all_sod_branches_dbdabfd5ea");
const NIC_RELATIONSHIPS = o("01_financials_data_fed_nic_native_csv_relationships_f440c4e9d7");
const Y9_ALL = o("01_financials_data_fed_y9_family_all_native_2026q1_q3_ffceb6e988");
const H8_ALL = o("01_financials_data_fed_h8_complete_native_observations_76de662a76");
const SEC_FACTS = o("12_sec_company_financials_selected_standard_facts_986b9c0288");
const MSHA_MINES = o("07_materials_csv_msha_mines_all_coal_metal_full_f59b9677c3");
const MSHA_MNM_MINES = o("07_materials_csv_msha_metal_nonmetal_mines_all_statuses_full_7569d51628");
const MSHA_EMPLOYMENT = o("07_materials_csv_msha_annual_employment_production_all_2000_2026_full_01ebc7f77d");
const MSHA_MNM_EMPLOYMENT = o("07_materials_csv_msha_materials_annual_employment_2000_2026_full_7b70c2de63");
const USGS_ALL = o("07_materials_csv_usgs_ds140_all_observations_full_564bd11da9");
const NHTSA_RECALLS = o("08_consumer_discretionary_recalls_all_product_records_c02255bd49");
const FAA_ASSETS = o("06_industrials_aircraft_assets_5cc71357e3");
const MER_UNION = o("04_energy_csv_mer_all_107_tables_all_history_3e7c636fc7");
const EV_MICRODATA = o("04_energy_csv_ev_charging_microdata_201506_202609_full_23eb0d08e9");
const EV_MICRODATA_RAW = o("04_energy_raw_full_data_mer_microdata_oct_2026_mer_b0e2ae2ede");
const EV_ID_LINKING_RAW = o("04_energy_raw_full_data_mer_id_linking_oct_2026_mer_79ef798369");
const TWSE_ALL = o("02_technology_csv_twse_revenue_all_industries_96edc5fdfa");
const TPEX_ALL = o("02_technology_csv_tpex_revenue_all_industries_65da2c3cb7");
const FHFA_MASTER = o("11_real_estate_hpi_master_all_0755e8292e");
const EIA861_SALES = o("05_utilities_csv_eia861_sales_ult_cust_2025_states_1e06be3f04");
const EIA861_SITED = o("05_utilities_csv_eia861_sales_ult_cust_cs_2025_customer_sited_bdf95ccf5c");
const EIA861_NON_NET = o(
  "05_utilities_csv_eia861_non_net_metering_distributed_2025_states_state_level_c6f0f9063e",
);
const EGRID_PLANT = o("05_utilities_csv_egrid2023_plnt23_full_964175ba0b");
const SEC_EMPTY = o("12_sec_company_financials_ambiguous_facts_0440a6946c");

const ERS = "09_consumer_staples_";
const ERS_PAIRS: [string, string][] = [
  [
    "historical_consumer_price_index_cpi_forecast_series_normalized_7c49d50270",
    "raw_historical_consumer_price_index_cpi_forecast_series_5ceebbebcd",
  ],
  [
    "historical_producer_price_index_ppi_forecast_series_normalized_d2295c0cac",
    "raw_historical_producer_price_index_ppi_forecast_series_41f68256bb",
  ],
  [
    "consumer_price_index_cpi_forecasts_previously_published_estimates_normalized_0eb4e12896",
    "raw_consumer_price_index_cpi_forecasts_previously_published_estimates_3ccb2698f7",
  ],
  [
    "producer_price_index_ppi_forecasts_previously_published_estimates_normalized_7054b555ad",
    "raw_producer_price_index_ppi_forecasts_previously_published_estimates_9e39ee6a01",
  ],
  [
    "annual_percent_changes_in_selected_consumer_price_indexes_1974_through_2025_normalized_f209ef0e21",
    "raw_annual_percent_changes_in_selected_consumer_price_indexes_1974_through_2025_56b8bc80d1",
  ],
  [
    "annual_percent_changes_in_selected_producer_price_indexes_1974_through_2025_normalized_c7b3c44268",
    "raw_annual_percent_changes_in_selected_producer_price_indexes_1974_through_2025_f0035409fd",
  ],
  [
    "changes_in_consumer_price_indexes_2024_through_2027_normalized_46caa998c8",
    "raw_changes_in_consumer_price_indexes_2024_through_2027_9919b8698d",
  ],
  [
    "changes_in_producer_price_indexes_2024_through_2027_normalized_ec890dc8b4",
    "raw_changes_in_producer_price_indexes_2024_through_2027_971e7edfd2",
  ],
];

/** Established by the audit: `[dataset, kind, parent]`. A projection without a parent has several. */
const AUDIT_ROWS: [string, CatalogKind, string?][] = [
  // FDIC: one bank-quarter panel, its cuts and sums; branch table and its sums.
  [o("01_financials_data_fdic_top500_core_quarterly_2000_latest_2602ee173a"), "projection", FDIC_PANEL],
  [o("01_financials_data_fdic_top500_annual_and_latest_core_b716e87ef2"), "projection", FDIC_PANEL],
  [o("01_financials_data_fdic_net_income_quarter_reconciliation_e18a12790a"), "derived", FDIC_PANEL],
  [o("01_financials_data_fdic_top500_quarterly_aggregate_and_peers_afed1f8c2b"), "derived", FDIC_PANEL],
  [o("01_financials_data_fdic_top500_quarterly_aggregate_and_peers_full_348783678b"), "derived", FDIC_PANEL],
  [o("01_financials_data_fdic_top500_quarter_coverage_grid_18b39dc335"), "derived", FDIC_PANEL],
  [o("01_financials_data_fdic_top500_bank_history_coverage_03433dbe63"), "derived", FDIC_PANEL],
  [o("01_financials_data_fdic_balance_sheet_identity_exceptions_bf69c41c2a"), "derived", FDIC_PANEL],
  [o("01_financials_data_fdic_top500_2026_sod_bank_totals_41b1214439"), "derived", FDIC_SOD],
  [o("01_financials_data_fdic_top500_2026_sod_by_bank_state_a65c3ff1ec"), "derived", FDIC_SOD],
  [o("01_financials_data_fdic_native_field_dictionary_and_coverage_e5dc6e4a7c"), "reference"],
  // National Information Center and FR Y-9.
  [o("01_financials_data_fdic_top500_nic_all_direct_ownership_rows_4d38366324"), "projection", NIC_RELATIONSHIPS],
  [o("01_financials_data_fdic_top500_nic_current_ownership_rows_5415dc2afe"), "projection", NIC_RELATIONSHIPS],
  [
    o("01_financials_data_fdic_top500_nic_transformations_a4cf9f0fc7"),
    "projection",
    o("01_financials_data_fed_nic_native_csv_transformations_a0243d454b"),
  ],
  [o("01_financials_data_fdic_top500_nic_exact_rssd_full_attributes_d508039326"), "projection"],
  [o("01_financials_data_fdic_top500_nic_rssd_identity_check_643941419e"), "derived"],
  [o("01_financials_data_fed_nic_complete_native_file_inventory_f098619710"), "reference"],
  [Y9_ALL, "projection"],
  [o("01_financials_data_fed_y9_consolidated_core_2026q1_q3_1e256b5509"), "projection", Y9_ALL],
  [o("01_financials_data_fed_y9_native_2026_package_inventory_087b199704"), "reference"],
  [o("01_financials_data_fed_y9_official_variable_dictionary_433523f87c"), "reference"],
  // Federal Reserve releases.
  [o("01_financials_data_fed_h8_monthly_headline_balances_2000_latest_ad2cb5f5f5"), "projection", H8_ALL],
  [o("01_financials_data_fed_h8_catalog_latest_65ec324ad2"), "reference"],
  [o("01_financials_data_fed_h8_full_series_dictionary_65369e472a"), "reference"],
  [o("01_financials_data_fed_z1_complete_table_inventory_3994040352"), "reference"],
  [o("01_financials_data_fed_z1_official_table_mapping_0749a69071"), "reference"],
  // NCUA.
  [o("01_financials_data_ncua_all_credit_unions_2026q2_core_c7e2229231"), "projection"],
  [o("01_financials_data_ncua_2026q2_native_table_inventory_a88d120b57"), "reference"],
  [o("01_financials_data_ncua_2026q2_official_account_dictionary_0f626ab8fb"), "reference"],
  [o("01_financials_data_ncua_2026q2_native_foicudes_a5396776d6"), "reference"],
  [o("01_financials_data_ncua_2026q2_native_acct_desctradenames_d2b669aa89"), "reference"],
  // SEC financial statement data sets, as normalised by the kit.
  [SEC_FACTS, "projection"],
  [o("12_sec_company_financials_all_submissions_0e97bfcbe7"), "projection"],
  [o("12_sec_company_financials_latest_company_balance_sheets_fa39777f80"), "derived", SEC_FACTS],
  [o("12_sec_company_financials_snapshot_eligibility_exclusions_3dc3383d84"), "derived", SEC_FACTS],
  [SEC_EMPTY, "derived", SEC_FACTS],
  [o("12_sec_company_financials_selected_tag_dictionary_ce05b8ab45"), "reference"],
  // Energy: the union of the 107 Monthly Energy Review tables has no single parent.
  [MER_UNION, "projection"],
  // Technology and communications.
  [
    o("02_technology_csv_us_electronics_ip_b57a689467"),
    "projection",
    o("02_technology_raw_fred_electronics_ip_8076283932"),
  ],
  [o("02_technology_csv_wb_tech_missing_observations_c4188b9da8"), "projection"],
  [
    o("10_communications_csv_wb_telecom_annual_acfa09eb49"),
    "projection",
    o("10_communications_csv_wb_telecom_annual_full_c578033483"),
  ],
  [o("10_communications_csv_wb_telecom_missing_observations_afef7dfa81"), "projection"],
  // MSHA: the yearly file holds coal and metal or nonmetal; the kit split and summed it.
  [MSHA_MNM_MINES, "projection", MSHA_MINES],
  [o("07_materials_csv_current_materials_mines_475e8810e0"), "projection", MSHA_MNM_MINES],
  [o("07_materials_csv_materials_mine_status_counts_4d6148ba31"), "derived", MSHA_MNM_MINES],
  [o("07_materials_csv_mine_commodity_status_counts_e07c44fa6a"), "derived", MSHA_MINES],
  [MSHA_MNM_EMPLOYMENT, "projection", MSHA_EMPLOYMENT],
  [o("04_energy_csv_msha_coal_employment_production_2000_2026_full_d3f430059d"), "projection", MSHA_EMPLOYMENT],
  [o("07_materials_csv_materials_employment_2025_7523fc0753"), "projection", MSHA_MNM_EMPLOYMENT],
  [o("07_materials_csv_employment_state_history_1a337a72d0"), "derived", MSHA_MNM_EMPLOYMENT],
  [
    o("07_materials_csv_materials_contractors_2025_99d70944f5"),
    "projection",
    o("07_materials_csv_msha_contractor_annual_2000_2026_full_2101bfa185"),
  ],
  [
    o("07_materials_csv_mine_controller_changes_2020_852eca0503"),
    "projection",
    o("07_materials_csv_msha_controller_operator_history_full_dfab67fc85"),
  ],
  // USGS: the long table is the 123 sheets unpivoted; its two halves; notes and dictionaries.
  [USGS_ALL, "projection"],
  [o("07_materials_csv_commodity_history_to_1959_f0eac5aaf7"), "projection", USGS_ALL],
  [o("07_materials_csv_commodity_history_1960_onward_2d3c4c99c3"), "projection", USGS_ALL],
  [o("07_materials_csv_usgs_ds140_repeated_source_years_487941f361"), "derived", USGS_ALL],
  [o("07_materials_csv_usgs_ds140_unassigned_source_cells_79856ff2e4"), "derived"],
  [o("07_materials_csv_commodity_coverage_0bf481e6d1"), "reference"],
  [o("07_materials_csv_series_dictionary_early_f1988f992c"), "reference"],
  [o("07_materials_csv_commodity_source_notes_597dd20c58"), "reference"],
  // NHTSA and FAA.
  [o("08_consumer_discretionary_recall_campaigns_648e3d43d3"), "derived", NHTSA_RECALLS],
  [o("08_consumer_discretionary_recalls_manufacturer_year_7d2c6c8fd6"), "derived", NHTSA_RECALLS],
  [o("08_consumer_discretionary_recalls_year_d8884f5228"), "derived", NHTSA_RECALLS],
  [FAA_ASSETS, "projection"],
  [
    o("06_industrials_aircraft_models_in_current_registry_100e552d29"),
    "projection",
    o("06_industrials_aircraft_model_reference_33ab8974fa"),
  ],
  [o("06_industrials_aircraft_year_type_a6f61c1e1e"), "derived", FAA_ASSETS],
  // USDA: every table is stored twice, as published and "normalized".
  ...ERS_PAIRS.map(
    ([cut, raw]): [string, CatalogKind, string] => [o(ERS + cut), "projection", o(ERS + raw)],
  ),
];

const AUDIT = new Map<string, Relation>(
  AUDIT_ROWS.map(([id, kind, parent]) => [id, parent ? { kind, parent } : { kind }]),
);

/** The long FRED table of each collection; the wide panels beside it are cut from it. */
const FRED_LONG: Record<string, string> = {
  "00_universal": o("00_universal_indicators_all_observations_2c6707222e"),
  "06_industrials": o("06_industrials_indicators_all_observations_b5249d20d9"),
  "08_consumer_discretionary": o("08_consumer_discretionary_indicators_all_observations_e2536bc259"),
  "09_consumer_staples": o("09_consumer_staples_indicators_all_observations_8743d903bf"),
  "11_real_estate": o("11_real_estate_indicators_all_observations_fef57477c8"),
};

const QUARANTINED_AGENCY = "source attribution unresolved";
const INTERNAL_SECTOR = "14_source_atlas";

function byRule(d: CatalogInput): Relation | null {
  if (/_(monthly_panel|quarterly_panel|daily_weekly)_[0-9a-f]{10}$/.test(d.id)) {
    const parent = FRED_LONG[d.sector];
    return parent ? { kind: "projection", parent } : { kind: "projection" };
  }
  if (/_indicators_all_observations_[0-9a-f]{10}$/.test(d.id)) return { kind: "projection" };
  if (/_series_catalogue_[0-9a-f]{10}$/.test(d.id)) return { kind: "reference" };
  if (/(_lookup|_dictionary|_field_dictionary)(_full)?_[0-9a-f]{10}$/.test(d.id)) return { kind: "reference" };
  return null;
}

export function relationFor(d: CatalogInput): Relation {
  if (d.sector === INTERNAL_SECTOR) return { kind: "internal" };
  if ((d.agency ?? "").trim().toLowerCase() === QUARANTINED_AGENCY) return { kind: "internal" };
  const audited = AUDIT.get(d.id);
  if (audited) return audited;
  const role = (storedRoles as Record<string, string>)[d.id];
  const parent = (storedParents as Record<string, string>)[d.id];
  if (role) {
    const kind = ROLE_KIND[role] ?? "native";
    // A lookup the kit kept once of two identical files is still a lookup.
    const ruled = byRule(d);
    if (kind === "native" && ruled) return ruled;
    return parent && kind !== "native" ? { kind, parent } : { kind };
  }
  const ruled = byRule(d);
  if (ruled) return ruled;
  return parent ? { kind: "projection", parent } : { kind: "native" };
}

/** Internal sheets, the quarantined tables and empty tables stay out of lists unless asked for. */
export function hiddenByDefault(d: CatalogInput, kind: CatalogKind): boolean {
  return kind === "internal" || d.rows === 0;
}

const ISSUE_TEXT = {
  footnote: (row: number) =>
    `Row ${row.toLocaleString("en-US")} is the workbook's footnote stored as a record; its text sits in the period index, so leave that row out.`,
  floatIds:
    "The utility number in the entity index carries a trailing .0 (57313.0 for utility 57313); search by name, or add .0 to the number.",
  rocPeriod:
    "The period index holds the Republic of China month 11510 (year 115, month 10), which is October 2026; a filter on 2026-10 finds nothing here.",
  yearOnly:
    "The period index holds the year only; the month or quarter is in the field named period, and the frequency in its own field.",
  floatCells:
    "Whole numbers in this table carry a trailing .0 that the publisher does not write (8.0 for 8); read cells as numbers, not as the publisher's text.",
  floatCellsFdic:
    "About half the numeric cells carry a trailing .0 that the FDIC does not write (18767000.0 for 18767000); read cells as numbers, not as the publisher's text.",
  floatCellsSod:
    "The OCCDIST field carries a trailing .0 (1.0) that the FDIC does not write; read it as a number.",
  trimmed:
    "The publisher pads cells to a fixed width; that padding was removed here, and 22 of the registry's 34 fields, the registrant among them, are not in this table.",
  recordId:
    "RECORD_ID is renumbered by the publisher on every export; identify a record by campaign number, make, model, year and component id.",
  empty: "This table has no rows.",
  merVintage:
    "As read on 25 Nov 2026 this table holds the previous Monthly Energy Review issue; the single tables were refreshed since and differ from it.",
  wrongLink:
    "The stored source address points to Monthly Energy Review table 1.1; this file is EIA's electric vehicle charging data.",
  sameFile: "This is the same file as EIA's charging-port microdata table; do not add the two.",
  sameRows:
    "These rows are also stored as the exchange's current monthly revenue table; do not add the two.",
} as const;

/**
 * An issue that holds only for snapshots retrieved before an instant: the defect is a stale copy, so
 * a later retrieval of the same table may no longer have it. Without a retrieval time it is shown.
 */
type IssueRule = CatalogIssue & { before?: string };

/** EIA published a new Monthly Energy Review issue and the refresh replaced the single tables on 25 Nov 2026. */
const MER_REISSUE = "2026-11-25T00:00:00Z";
const merVintage: IssueRule = { id: "W1", text: ISSUE_TEXT.merVintage, before: MER_REISSUE };

const ISSUES: [string, IssueRule][] = [
  [EIA861_SALES, { id: "W2", text: ISSUE_TEXT.footnote(2870) }],
  [EIA861_SITED, { id: "W2", text: ISSUE_TEXT.footnote(693) }],
  [EIA861_NON_NET, { id: "W2", text: ISSUE_TEXT.footnote(49) }],
  [EIA861_SALES, { id: "W3", text: ISSUE_TEXT.floatIds }],
  [EIA861_SITED, { id: "W3", text: ISSUE_TEXT.floatIds }],
  [TWSE_ALL, { id: "W4", text: ISSUE_TEXT.rocPeriod }],
  [TPEX_ALL, { id: "W4", text: ISSUE_TEXT.rocPeriod }],
  [TWSE_ALL, { id: "DUP", text: ISSUE_TEXT.sameRows }],
  [TPEX_ALL, { id: "DUP", text: ISSUE_TEXT.sameRows }],
  [FHFA_MASTER, { id: "W5", text: ISSUE_TEXT.yearOnly }],
  [o("11_real_estate_national_and_state_c21c1607a1"), { id: "W5", text: ISSUE_TEXT.yearOnly }],
  [o("11_real_estate_metro_purchase_only_d40ac9ae79"), { id: "W5", text: ISSUE_TEXT.yearOnly }],
  [o("11_real_estate_hpi_latest_by_series_289003ca07"), { id: "W5", text: ISSUE_TEXT.yearOnly }],
  [FDIC_PANEL, { id: "M1", text: ISSUE_TEXT.floatCellsFdic }],
  [FDIC_SOD, { id: "M1", text: ISSUE_TEXT.floatCellsSod }],
  [EIA861_SALES, { id: "M1", text: ISSUE_TEXT.floatCells }],
  [EIA861_SITED, { id: "M1", text: ISSUE_TEXT.floatCells }],
  [EIA861_NON_NET, { id: "M1", text: ISSUE_TEXT.floatCells }],
  [EGRID_PLANT, { id: "M1", text: ISSUE_TEXT.floatCells }],
  [EV_MICRODATA, { id: "M1", text: ISSUE_TEXT.floatCells }],
  [EV_MICRODATA_RAW, { id: "M1", text: ISSUE_TEXT.floatCells }],
  [FAA_ASSETS, { id: "M1", text: ISSUE_TEXT.trimmed }],
  [NHTSA_RECALLS, { id: "M6", text: ISSUE_TEXT.recordId }],
  [SEC_EMPTY, { id: "M10", text: ISSUE_TEXT.empty }],
  [MER_UNION, merVintage],
  [o("04_energy_csv_mer_normalized_observations_all_history_a30b874605"), merVintage],
  [o("04_energy_csv_annual_energy_history_cb19180b78"), merVintage],
  [o("04_energy_csv_monthly_energy_2024_onward_1bf877c69e"), merVintage],
  [o("04_energy_csv_energy_series_dictionary_301bb6518e"), merVintage],
  [o("04_energy_csv_energy_source_flags_6296a665d7"), merVintage],
  [EV_MICRODATA_RAW, { id: "M4", text: ISSUE_TEXT.wrongLink }],
  [EV_ID_LINKING_RAW, { id: "M4", text: ISSUE_TEXT.wrongLink }],
  [EV_MICRODATA_RAW, { id: "DUP", text: ISSUE_TEXT.sameFile }],
];

const ISSUES_BY_ID = new Map<string, IssueRule[]>();
for (const [id, issue] of ISSUES) {
  const list = ISSUES_BY_ID.get(id);
  if (list) list.push(issue);
  else ISSUES_BY_ID.set(id, [issue]);
}

function applies(rule: IssueRule, retrievedAt: string | null | undefined): boolean {
  if (!rule.before) return true;
  const at = typeof retrievedAt === "string" ? Date.parse(retrievedAt) : Number.NaN;
  return !Number.isFinite(at) || at < Date.parse(rule.before);
}

export function issuesFor(d: CatalogInput): CatalogIssue[] {
  const known: CatalogIssue[] = (ISSUES_BY_ID.get(d.id) ?? [])
    .filter((rule) => applies(rule, d.retrieved_at))
    .map(({ id, text }) => ({ id, text }));
  if (d.rows === 0 && !known.some((i) => i.id === "M10")) {
    known.push({ id: "M10", text: ISSUE_TEXT.empty });
  }
  return known;
}

/** Every id this file names, for the test that checks them against the stored list. */
export const RELATION_IDS: readonly string[] = [
  ...new Set([
    ...AUDIT_ROWS.flatMap(([id, , parent]) => (parent ? [id, parent] : [id])),
    ...Object.values(FRED_LONG),
    ...ISSUES.map(([id]) => id),
    ...Object.keys(storedRoles),
    ...Object.entries(storedParents).flat(),
  ]),
];
