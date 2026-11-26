import { RankingView } from "./ranking-view";

/**
 * Places at the latest period: the ranking of the profile's places, with the US state grid beside it when the places
 * are states by one rule (postal code, FIPS code or name; `boards/places.ts`). Counties and other places stay a ranked
 * list.
 */
export function PlaceView(props: Omit<Parameters<typeof RankingView>[0], "map">) {
  return <RankingView {...props} map />;
}
