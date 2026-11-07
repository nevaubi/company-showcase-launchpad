"use client";

import { SourceCardsSimulation } from "./source-cards-simulation";
import { SourceCardsView } from "./source-cards-view";
import type { SourceCardsProps } from "./source-cards-view";

export type { SourceCardsProps, SourceCitationProps } from "./source-cards-view";
export type { SourceCardsAnswerToken, SourceCardsSource, SourceCardsStatus } from "./source-cards-data";
export type { SourceCardsMarkId } from "./source-cards-marks";
export type { SourceCardsScenario } from "./source-cards-simulation";
export { SourceCitation } from "./source-cards-view";
export { SourceCardsSimulation } from "./source-cards-simulation";
export { SourceMark, markForUrl, sourceHost } from "./source-cards-marks";
export { sourceCardsAnswer, sourceCardsQuery, sourceCardsQuestion, sourceCardsSamples } from "./source-cards-data";

/**
 * A row of cited sources under an AI answer. Pass `sources` (and `status` while searching) to wire real results;
 * with no `sources` it renders a self-playing demo of a search, a cited answer and the citation highlights.
 */
export function SourceCards(props: SourceCardsProps) {
  if (props.sources === undefined) return <SourceCardsSimulation className={props.className} />;
  return <SourceCardsView {...props} />;
}

export default SourceCards;
