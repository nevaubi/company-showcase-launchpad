import { EIA_MER_ENTRY, FDIC_FINANCIALS_ENTRY, FDIC_SUMMARY_ENTRY, FHFA_ENTRY } from "./families";
import { FRED_ENTRY } from "./fred";
import type { ProfileEntry } from "./types";

/**
 * The families that have a profile. A family is added only after its dictionary and rows were read on
 * production and the unit of every measure was traced to a dictionary entry, a unit field of the row or
 * the publisher's documentation. The proof is kept in the profile (`proof`) and in the unit's report.
 * Order matters only when two families claim one dataset: the first that applies wins.
 *
 * Families without a profile, and why, are listed in the boards report of 25 Nov 2026 (round 4).
 */
export const PROFILE_ENTRIES: readonly ProfileEntry[] = [FRED_ENTRY, EIA_MER_ENTRY, FDIC_FINANCIALS_ENTRY, FDIC_SUMMARY_ENTRY, FHFA_ENTRY];
