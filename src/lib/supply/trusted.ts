// The one place stored supply rows become what the app shows. Every reader (Network, Globe, Chain, the stats, the shock
// simulation, the analyst metrics, the assistant's tools) loads rows through `supply/query.ts`, which calls these, so all of
// them see the same verified claims. Pure, no browser/Node APIs.
import { trustLink } from "./claims";
import { dedupeCurrent } from "./identity";
import type { RiskLink } from "./core";

/** Each row keeps only what its sentence states: amount (and flow), sole source, regions, plus its nature. */
export const trustRows = (rows: RiskLink[]): RiskLink[] => rows.map((r) => trustLink(r) as RiskLink);

/** Current rows: trusted, then one row per link across a filer's 10-K and 10-Q (the other copies ride as `corroboration`). */
export const currentRows = (rows: RiskLink[]): RiskLink[] => dedupeCurrent(trustRows(rows)) as RiskLink[];
