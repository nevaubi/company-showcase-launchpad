/**
 * Places of a cross-section read as US states: which rule (postal code, FIPS code or name) reads the most keys, the
 * state of each key under it, and the name a place shows when the record stores only its code. Pure; used by rank,
 * map and count tiles and by the table pages' place view.
 */
import { MIN_STATE_KEYS, isNationalKey, placeByKey, type StateKeyKind, type UsPlace } from "../geo/us-states";

/**
 * The rule that reads most of a dimension's keys as states (postal code, FIPS code or name, in that order on a tie),
 * the place of each key under it, and the keys it leaves aside. Null when fewer than `MIN_STATE_KEYS` keys resolve:
 * the dimension does not hold states. National totals are never a state.
 */
export function stateRule(keys: readonly string[]): { kind: StateKeyKind; places: Map<string, UsPlace>; others: string[] } | null {
  let best: { kind: StateKeyKind; places: Map<string, UsPlace> } | null = null;
  for (const kind of ["postal", "fips", "name"] as const) {
    const places = new Map<string, UsPlace>();
    const taken = new Set<string>();
    for (const key of keys) {
      if (isNationalKey(key)) continue;
      const place = placeByKey(key, kind);
      if (place && !taken.has(place.code)) {
        places.set(key, place);
        taken.add(place.code);
      }
    }
    if (!best || places.size > best.places.size) best = { kind, places };
  }
  if (!best || best.places.size < MIN_STATE_KEYS) return null;
  return { ...best, others: keys.filter((k) => !best!.places.has(k)) };
}

export const RULE_WORDS: Record<StateKeyKind, string> = { postal: "postal code", fips: "FIPS code", name: "name" };

/** The name a record shows for its place: the stored name, else the state its code names (and that it was named so). */
export function placeName(cell: { key: string; name: string | null }, rule: ReturnType<typeof stateRule>): { name: string; fromCode: boolean } {
  if (cell.name) return { name: cell.name, fromCode: false };
  const place = rule?.places.get(cell.key);
  return place && rule!.kind !== "name" ? { name: place.name, fromCode: true } : { name: cell.key, fromCode: false };
}

/** The sentence a tile's source line adds when place names were taken from the state codes. */
export function namedFromCodes(kind: StateKeyKind): string {
  return `State names from the ${RULE_WORDS[kind]}s the records carry.`;
}

