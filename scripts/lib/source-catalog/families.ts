/** The families the generator titles, largest first. Each one owns its candidates; none overlap. */
import { bdcFamily, h8Family, nmfpFamily, ofrFamily } from "./banks-funds";
import { eia860Family, eia861Family } from "./eia-forms";
import type { Family } from "./types";
import { fredFamily } from "./fred";
import { merFamily } from "./mer";
import { usgsFamily } from "./usgs";
import { z1Family } from "./z1";

export const FAMILIES: readonly Family[] = [z1Family, fredFamily, usgsFamily, merFamily, eia861Family, eia860Family, nmfpFamily, h8Family, ofrFamily, bdcFamily];
