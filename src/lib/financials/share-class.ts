// Earnings per share and weighted shares that a filer tags only by share class. SEC's company facts carry
// undimensioned facts alone, so a filer whose EPS lines sit on the class-of-stock axis (Berkshire Hathaway's
// "Net earnings per average equivalent Class B share", Visa's class A EPS) had no EPS at all. These facts are read
// from each filing's own inline XBRL at ingest, for the covered ticker's class only, and merged into the facts under
// a class prefix ("classB:EarningsPerShareBasic") that the EPS and share lines list after their undimensioned
// concepts, so they stand only where the filer tags no undimensioned figure. Pure: no Node or browser APIs.
import type { RawFact } from "./build";
import { parseContexts, parseInlineFacts } from "../xbrl/inline";

export type ShareClass = "A" | "B" | "C";

/** The class-tagged concepts read, with the unit the statement builder reads them in. */
export const CLASS_CONCEPTS: Record<string, "USD/shares" | "shares"> = {
  EarningsPerShareBasic: "USD/shares",
  EarningsPerShareDiluted: "USD/shares",
  EarningsPerShareBasicAndDiluted: "USD/shares",
  WeightedAverageNumberOfSharesOutstandingBasic: "shares",
  WeightedAverageNumberOfDilutedSharesOutstanding: "shares",
};

const CLASS_AXIS = "us-gaap:StatementClassOfStockAxis";

/** The class a covered ticker trades as: the letter after its dash (BRK-B), else class A (Visa's V). */
export function tickerShareClass(ticker: string): ShareClass {
  const m = ticker.toUpperCase().match(/[-.]([ABC])$/);
  return (m?.[1] as ShareClass | undefined) ?? "A";
}

/** The prefix under which the class's facts are merged ("classB"). */
export const classPrefix = (c: ShareClass) => `class${c}`;

/** Concept names of a line for every class, in class order: what the schema lists after a line's own concepts. */
export const classConcepts = (local: string) => (["A", "B", "C"] as const).map((c) => `${classPrefix(c)}:${local}`);

/** A class-of-stock member of the given class: us-gaap:CommonClassAMember, brka:EquivalentClassBMember. */
export function isClassMember(member: string, c: ShareClass): boolean {
  const local = member.split(":").pop() ?? "";
  return new RegExp(`Class${c}(Common)?(Stock|Shares?)?Member$`).test(local);
}

/** The class letter a merged concept carries ("classB:EarningsPerShareBasic" → "B"), or undefined. */
export function classOfConcept(concept: string): ShareClass | undefined {
  return concept.match(/^class([ABC]):/)?.[1] as ShareClass | undefined;
}

/**
 * Facts of the class concepts tagged with exactly one dimension, the class-of-stock axis at the ticker's class, from
 * one filing's inline XBRL. Keyed by merged concept name ("classB:EarningsPerShareBasic").
 */
export function classFactsFromInline(html: string, c: ShareClass, filing: { accn: string; form: string; filed: string }): Map<string, RawFact[]> {
  const contexts = parseContexts(html);
  const out = new Map<string, RawFact[]>();
  for (const f of parseInlineFacts(html)) {
    const [ns, local] = f.concept.split(":");
    if (ns !== "us-gaap" || !(local in CLASS_CONCEPTS)) continue;
    const ctx = contexts.get(f.context);
    if (!ctx || ctx.typed || ctx.dims.length !== 1) continue;
    const [axis, member] = ctx.dims[0];
    if (axis !== CLASS_AXIS || !isClassMember(member, c)) continue;
    const end = ctx.end ?? ctx.instant;
    if (!end) continue;
    const key = `${classPrefix(c)}:${local}`;
    const list = out.get(key) ?? [];
    const fact: RawFact = { ...(ctx.start ? { start: ctx.start } : {}), end, val: f.value, accn: filing.accn, form: filing.form, filed: filing.filed };
    if (!list.some((x) => x.start === fact.start && x.end === fact.end)) list.push(fact);
    out.set(key, list);
  }
  return out;
}
