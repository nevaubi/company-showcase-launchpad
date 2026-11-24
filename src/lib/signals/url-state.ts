// What /app/setups keeps in its address, so a copied link reopens the same list: the view and the
// five filters. Every value is optional and a bad value is dropped (the default applies) rather than
// breaking the page. Pure.
import { z } from "zod";
import { DEFAULT_FILTERS, LIQUIDITY_FLOORS, type RankFilters } from "./rank";
import type { Family } from "./strategies";

export const SETUP_VIEWS = ["short", "closest", "all"] as const;
export type SetupView = (typeof SETUP_VIEWS)[number];
const SIDES = ["long", "short"] as const;
const HOLDS = ["week", "fortnight", "month"] as const;
/** Families a live signal can belong to (pairs are not single-stock setups). */
export const SETUP_FAMILIES = ["reversal", "momentum", "events", "links", "multi"] as const satisfies readonly Family[];

export const setupsSearch = z.object({
  view: z.enum(SETUP_VIEWS).optional().catch(undefined),
  side: z.enum(SIDES).optional().catch(undefined),
  hold: z.enum(HOLDS).optional().catch(undefined),
  family: z.enum(SETUP_FAMILIES).optional().catch(undefined),
  sector: z.string().min(1).max(60).optional().catch(undefined),
  /** Least dollar volume a day, in millions: 5, 20, 100 or 500. */
  liq: z.coerce.number().optional().catch(undefined),
});
export type SetupsSearch = z.infer<typeof setupsSearch>;

/** The ranking filters a search stands for; anything missing or unknown falls back to the default. */
export function filtersOf(s: SetupsSearch, sectors: readonly string[] = []): RankFilters {
  const floor = LIQUIDITY_FLOORS.find((f) => f === (s.liq ?? NaN) * 1e6);
  return {
    side: s.side ?? DEFAULT_FILTERS.side,
    hold: s.hold ?? DEFAULT_FILTERS.hold,
    family: s.family ?? DEFAULT_FILTERS.family,
    sector: s.sector && (!sectors.length || sectors.includes(s.sector)) ? s.sector : DEFAULT_FILTERS.sector,
    minDollarVolume: floor ?? DEFAULT_FILTERS.minDollarVolume,
  };
}

/** The search for a set of filters, defaults left out so the address stays short. */
export function searchOf(f: RankFilters): Omit<SetupsSearch, "view"> {
  return {
    side: f.side === "all" ? undefined : f.side,
    hold: f.hold === "all" ? undefined : f.hold,
    family: f.family === "all" || f.family === "pairs" ? undefined : f.family,
    sector: f.sector === "all" ? undefined : f.sector,
    liq: f.minDollarVolume === DEFAULT_FILTERS.minDollarVolume ? undefined : f.minDollarVolume / 1e6,
  };
}

/**
 * The view shown when the address names none: always the short list, even when it is empty (its
 * empty state says why). The closest rules are a separate watch list, never the default.
 */
export const defaultView = (_shortListLength?: number): SetupView => "short";

export const filtersActive = (f: RankFilters) =>
  f.side !== DEFAULT_FILTERS.side || f.hold !== DEFAULT_FILTERS.hold || f.family !== DEFAULT_FILTERS.family || f.sector !== DEFAULT_FILTERS.sector || f.minDollarVolume !== DEFAULT_FILTERS.minDollarVolume;
