import { RankingView } from "./ranking-view";

/**
 * Places at the latest period: the ranking of the profile's places, with the state tile map beside it when every
 * place is a US state, DC or Puerto Rico. Counties and other places stay a ranked list.
 */
export function PlaceView(props: Omit<Parameters<typeof RankingView>[0], "map">) {
  return <RankingView {...props} map />;
}
