import type { ProfileEntry } from "../types";
import { ENTRIES as FINANCE } from "./finance";
import { ENTRIES as ENERGY } from "./energy";
import { ENTRIES as SECTORS } from "./sectors";
import { ENTRIES as INDUSTRY } from "./industry";

/** The profile families units added, after the core families (the first family that claims a dataset wins). */
export const UNIT_PROFILE_ENTRIES: readonly ProfileEntry[] = [...FINANCE, ...ENERGY, ...SECTORS, ...INDUSTRY];
