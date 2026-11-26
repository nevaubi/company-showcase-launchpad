// The FDIC Summary of Deposits tables the deposits-by-state chart reads: the 2026 survey of the FDIC 500 cohort,
// one row per insured institution and branch state, and one row per institution with its totals. Both carry the
// certificate as their entity index (`entity_id` = CERT), so a charter is read by its certificate and nothing else.
// Fields are found by label (the stored keys are positional); positions are hints checked against the label. The
// deposits field is drawn only while the dictionary states exactly `SOD_UNIT` for it.
//
// Publisher's definitions: DEPSUMBR is the branch's domestic deposits (FDIC API), reported "in thousands" (FDIC SOD
// instructions); STALPBR the branch state's postal abbreviation. The stored rows sum DEPSUMBR and count branch records
// per certificate and branch state (the dataset's notes); the proof in the round 6 company report compares them
// with the FDIC API's own aggregation by STALPBR.

/** Insured institution (CERT) by branch state, 2026 survey, FDIC 500 cohort. Entity index: CERT. */
export const SOD_BY_STATE = "official_01_financials_data_fdic_top500_2026_sod_by_bank_state_a65c3ff1ec";
/** Insured institution (CERT) totals of the 2026 survey, FDIC 500 cohort. Entity index: CERT. */
export const SOD_TOTALS = "official_01_financials_data_fdic_top500_2026_sod_bank_totals_41b1214439";

/**
 * The unit of the deposits sums. The totals table's dictionary states it; the by-state table's dictionary states no
 * unit for its deposits field, so there it rests on the FDIC's own instructions (`SOD_UNIT_EVIDENCE`) and on the proof
 * that the stored sums equal the FDIC API's sums of DEPSUMBR. A dictionary that states any other unit turns the
 * figures off.
 */
export const SOD_UNIT = "USD thousands";
export const SOD_UNIT_EVIDENCE = "https://fdic.gov/system/files/2024-07/2024-sod-instructions.pdf (Summary of Deposits reporting instructions: \"Report all amounts in thousands, rounded to the nearest thousand dollars.\")";

/** The unit of a deposits field whose dictionary entry states `stated`: the documented unit, or null when the entry states another. */
export const sodUnit = (stated: string | null | undefined): string | null => (!stated || stated === SOD_UNIT ? SOD_UNIT : null);

export const SOD_STATE_FIELDS = {
  cert: { label: "CERT", hint: 0 },
  name: { label: "NAMEFULL", hint: 1 },
  state: { label: "STALPBR", hint: 2 },
  branches: { label: "branch_records", hint: 3 },
  deposits: { label: "branch_deposits_USD_thousands", hint: 4 },
} as const;

export const SOD_TOTAL_FIELDS = {
  cert: { label: "CERT", hint: 0 },
  name: { label: "NAMEFULL", hint: 1 },
  branches: { label: "branch_records", hint: 2 },
  states: { label: "states_and_territories", hint: 3 },
  deposits: { label: "branch_deposits_USD_thousands", hint: 4 },
  year: { label: "survey_year", hint: 6 },
} as const;

/** The FDIC letter of the 2026 survey: "the annual survey of branch office deposits as of June 30, 2026". */
export const SOD_DOCUMENTATION = "https://www.fdic.gov/news/financial-institution-letters/2026/summary-deposits-survey-and-filing-june-30-2026";

/** The most branch-state rows one institution can have: the states, DC and the territories, with room to spare. */
export const SOD_MAX_STATES = 100;
