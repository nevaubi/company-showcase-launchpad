import type { UnitSpecs } from "../compose";
import { SPECS as FORMS } from "./forms";
import { SPECS as BANKS } from "./banks";
import { SPECS as FUNDS } from "./funds";
import { SPECS as ENERGY } from "./energy";
import { SPECS as POWER } from "./power";
import { SPECS as PLACES } from "./places";
import { SPECS as HEALTH } from "./health";
import { SPECS as INDUSTRY } from "./industry";

/** The units that add tiles and boards, in the order their tiles are appended to a shared board. */
export const UNIT_SPECS: readonly UnitSpecs[] = [FORMS, BANKS, FUNDS, ENERGY, POWER, PLACES, HEALTH, INDUSTRY];
