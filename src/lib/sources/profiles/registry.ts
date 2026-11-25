import type { ProfileEntry } from "./types";

/**
 * The families that have a profile. A family is added only after its dictionary and rows were read on
 * production and the unit of every measure was traced to a dictionary entry, a unit field of the row or
 * the publisher's documentation. The proof is kept in the profile (`proof`) and in the unit's report.
 * Order matters only when two families claim one dataset: the first that applies wins.
 */
export const PROFILE_ENTRIES: readonly ProfileEntry[] = [];
