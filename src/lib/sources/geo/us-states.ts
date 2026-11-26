/**
 * US states, DC and the inhabited territories: postal code, name, two-digit FIPS code and, for the states and DC,
 * a place on the state tile grid (eleven columns, eight rows, each state one square near its usual place, Alaska and
 * Hawaii at the left edge). Territories have no grid place: a map lists them beneath the grid.
 *
 * A record is matched to a state only by a key the source writes: the postal code exactly as stored ("CA"), a
 * two-digit FIPS code ("06"), or the state's name, compared without regard to case or surrounding spaces
 * ("California", "CALIFORNIA"). Nothing is matched by a fragment, an abbreviation of a name or a number without its
 * leading zero. A dimension is read as states only when its keys are unanimous: every key that is not a national
 * total resolves under one rule (`stateKeyKind`), so a list of census divisions numbered "01" to "09" is never taken
 * for FIPS codes.
 */

export type UsPlaceKind = "state" | "district" | "territory";

export type UsPlace = {
  /** USPS code. */
  code: string;
  name: string;
  /** Two-digit FIPS state code. */
  fips: string;
  kind: UsPlaceKind;
  /** Row and column on the tile grid, zero-based; absent for territories. */
  grid?: { row: number; col: number };
};

export const GRID_COLUMNS = 11;
export const GRID_ROWS = 8;

const P = (code: string, name: string, fips: string, row: number, col: number, kind: UsPlaceKind = "state"): UsPlace => ({
  code,
  name,
  fips,
  kind,
  grid: { row, col },
});
const T = (code: string, name: string, fips: string): UsPlace => ({ code, name, fips, kind: "territory" });

/** The states and DC in grid reading order (row by row, west to east), then the territories. */
export const US_PLACES: readonly UsPlace[] = [
  P("AK", "Alaska", "02", 0, 0),
  P("ME", "Maine", "23", 0, 10),
  P("VT", "Vermont", "50", 1, 9),
  P("NH", "New Hampshire", "33", 1, 10),
  P("WA", "Washington", "53", 2, 0),
  P("ID", "Idaho", "16", 2, 1),
  P("MT", "Montana", "30", 2, 2),
  P("ND", "North Dakota", "38", 2, 3),
  P("MN", "Minnesota", "27", 2, 4),
  P("IL", "Illinois", "17", 2, 5),
  P("WI", "Wisconsin", "55", 2, 6),
  P("MI", "Michigan", "26", 2, 7),
  P("NY", "New York", "36", 2, 8),
  P("RI", "Rhode Island", "44", 2, 9),
  P("MA", "Massachusetts", "25", 2, 10),
  P("OR", "Oregon", "41", 3, 0),
  P("NV", "Nevada", "32", 3, 1),
  P("WY", "Wyoming", "56", 3, 2),
  P("SD", "South Dakota", "46", 3, 3),
  P("IA", "Iowa", "19", 3, 4),
  P("IN", "Indiana", "18", 3, 5),
  P("OH", "Ohio", "39", 3, 6),
  P("PA", "Pennsylvania", "42", 3, 7),
  P("NJ", "New Jersey", "34", 3, 8),
  P("CT", "Connecticut", "09", 3, 9),
  P("CA", "California", "06", 4, 0),
  P("UT", "Utah", "49", 4, 1),
  P("CO", "Colorado", "08", 4, 2),
  P("NE", "Nebraska", "31", 4, 3),
  P("MO", "Missouri", "29", 4, 4),
  P("KY", "Kentucky", "21", 4, 5),
  P("WV", "West Virginia", "54", 4, 6),
  P("VA", "Virginia", "51", 4, 7),
  P("MD", "Maryland", "24", 4, 8),
  P("DE", "Delaware", "10", 4, 9),
  P("AZ", "Arizona", "04", 5, 1),
  P("NM", "New Mexico", "35", 5, 2),
  P("KS", "Kansas", "20", 5, 3),
  P("AR", "Arkansas", "05", 5, 4),
  P("TN", "Tennessee", "47", 5, 5),
  P("NC", "North Carolina", "37", 5, 6),
  P("SC", "South Carolina", "45", 5, 7),
  P("DC", "District of Columbia", "11", 5, 8, "district"),
  P("OK", "Oklahoma", "40", 6, 3),
  P("LA", "Louisiana", "22", 6, 4),
  P("MS", "Mississippi", "28", 6, 5),
  P("AL", "Alabama", "01", 6, 6),
  P("GA", "Georgia", "13", 6, 7),
  P("HI", "Hawaii", "15", 7, 0),
  P("TX", "Texas", "48", 7, 3),
  P("FL", "Florida", "12", 7, 8),
  T("PR", "Puerto Rico", "72"),
  T("GU", "Guam", "66"),
  T("VI", "U.S. Virgin Islands", "78"),
  T("AS", "American Samoa", "60"),
  T("MP", "Northern Mariana Islands", "69"),
];

/** The 50 states and DC: the squares of the grid. */
export const GRID_PLACES: readonly UsPlace[] = US_PLACES.filter((p) => p.grid);
export const TERRITORIES: readonly UsPlace[] = US_PLACES.filter((p) => p.kind === "territory");

const BY_CODE = new Map(US_PLACES.map((p) => [p.code, p] as const));
const BY_FIPS = new Map(US_PLACES.map((p) => [p.fips, p] as const));
const BY_NAME = new Map(US_PLACES.map((p) => [p.name.toLowerCase(), p] as const));

/** Keys a publisher writes for the whole country, which are not a state: counted beside a map, never drawn. */
const NATIONAL = new Set(["us", "usa", "u.s.", "u.s.a.", "united states", "united states of america", "00", "national", "nation"]);

export type StateKeyKind = "postal" | "fips" | "name";

/** The place a key names under one rule, or null. */
export function placeByKey(key: string, kind: StateKeyKind): UsPlace | null {
  if (kind === "postal") return /^[A-Z]{2}$/.test(key) ? (BY_CODE.get(key) ?? null) : null;
  if (kind === "fips") return /^\d{2}$/.test(key) ? (BY_FIPS.get(key) ?? null) : null;
  return BY_NAME.get(key.trim().toLowerCase()) ?? null;
}

/** The place a key names under the first rule that resolves it (postal code, FIPS code, name), or null. */
export function placeOf(key: string | null | undefined): UsPlace | null {
  if (key == null) return null;
  return placeByKey(key, "postal") ?? placeByKey(key, "fips") ?? placeByKey(key, "name");
}

/** True for a key that names the whole country ("US", "United States", FIPS "00"). */
export function isNationalKey(key: string | null | undefined): boolean {
  return key != null && NATIONAL.has(key.trim().toLowerCase());
}

/** Distinct keys a dimension must hold, besides national totals, before it is read as states. */
export const MIN_STATE_KEYS = 10;

/**
 * The rule under which every key of a dimension names a state, DC or territory, or null when no rule is unanimous.
 * National totals are left aside; at least `MIN_STATE_KEYS` distinct other keys must resolve, every one under the same
 * rule, and no two keys may name the same place.
 */
export function stateKeyKind(keys: readonly (string | null | undefined)[]): StateKeyKind | null {
  const distinct = [...new Set(keys.filter((k): k is string => k != null && !isNationalKey(k)))];
  if (distinct.length < MIN_STATE_KEYS) return null;
  for (const kind of ["postal", "fips", "name"] as const) {
    const seen = new Set<string>();
    let unanimous = true;
    for (const key of distinct) {
      const place = placeByKey(key, kind);
      if (!place || seen.has(place.code)) {
        unanimous = false;
        break;
      }
      seen.add(place.code);
    }
    if (unanimous) return kind;
  }
  return null;
}

/** A place by its postal code. */
export function placeByCode(code: string): UsPlace | null {
  return BY_CODE.get(code) ?? null;
}
