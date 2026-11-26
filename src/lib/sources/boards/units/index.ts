import type { UnitSpecs } from "../compose";
import { SPECS as FORMS } from "./forms";
import { SPECS as FINANCE } from "./finance";
import { SPECS as ENERGY } from "./energy";
import { SPECS as SECTORS } from "./sectors";
import { SPECS as INDUSTRY } from "./industry";

/** The units that add tiles and boards, in the order their tiles are appended to a shared board. */
export const UNIT_SPECS: readonly UnitSpecs[] = [FORMS, FINANCE, ENERGY, SECTORS, INDUSTRY];
