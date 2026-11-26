// The IR tab's chart components and their contract. Build the inputs with the adapters (from an IrPayload) and
// mount the components; see types.ts for what each takes.
export type * from "./types";
export { SectionChart } from "./section-chart";
export { SummaryStrip } from "./summary-strip";
export { BridgeChart } from "./bridge-chart";
export { BankPanel } from "./bank-panel";
export { MarginPanel } from "./margin-panel";
export { bankFiguresOf, groupSeries, marginFiguresOf, partsOf, segmentMixOf, seriesOf, summaryTilesOf, targetOf } from "./from-payload";
export { bridgeOf, defaultBridge, foldParts, stackable, statOf, tiedPeriods } from "./model";
