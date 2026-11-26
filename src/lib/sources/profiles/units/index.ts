import type { ProfileEntry } from "../types";
import { ENTRIES as BANKS } from "./banks";
import { ENTRIES as FUNDS } from "./funds";
import { ENTRIES as ENERGY } from "./energy";
import { ENTRIES as POWER } from "./power";
import { ENTRIES as PLACES } from "./places";
import { ENTRIES as HEALTH } from "./health";
import { ENTRIES as INDUSTRY } from "./industry";

/** The profile families units added, after the core families (the first family that claims a dataset wins). */
export const UNIT_PROFILE_ENTRIES: readonly ProfileEntry[] = [...BANKS, ...FUNDS, ...ENERGY, ...POWER, ...PLACES, ...HEALTH, ...INDUSTRY];
