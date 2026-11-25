/** The families the generator titles, largest first. Each one owns its candidates; none overlap. */
import type { Family } from "./types";
import { z1Family } from "./z1";

export const FAMILIES: readonly Family[] = [z1Family];
