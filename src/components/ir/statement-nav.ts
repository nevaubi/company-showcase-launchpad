// Pure: the Statements controls built from the sections' own kinds (sector-order.ts): which filter chips
// the company's tables fill, whether a section is in a chip, the "Go to a section" groups and the quiet
// note naming expected statements the documents do not print. Nothing here reads label text.
import { FILTER_OF, KIND_LABEL, type SectionKind } from "@/lib/ir/sector-order";
import type { Statement } from "@/lib/ir/statements";

export type SectionFilter = "revenue" | "profit" | "cost" | "kpi" | "balance";

/** Chip words for whole printed tables of each filter, in the order the chips show. */
export const FILTER_LABEL: Record<SectionFilter, string> = {
  profit: "Results and segments",
  revenue: "Revenue splits",
  cost: "Costs",
  balance: "Balances",
  kpi: "KPIs and ratios",
};
const FILTER_ORDER: SectionFilter[] = ["profit", "revenue", "cost", "balance", "kpi"];

/** The filter a section belongs to: its own (`filter`), else its kind's, else none (lines decide). */
export function sectionFilter(sec: Pick<Statement, "filter" | "kind">): SectionFilter | null {
  return sec.filter ?? (sec.kind ? FILTER_OF[sec.kind] : null);
}

/** The chips: "All", then each filter at least one section is in, with how many sections it holds. */
export function filterOptions(
  sections: Pick<Statement, "filter" | "kind">[],
): { v: "all" | SectionFilter; l: string; n: number }[] {
  const n = new Map<SectionFilter, number>();
  for (const s of sections) {
    const f = sectionFilter(s);
    if (f) n.set(f, (n.get(f) ?? 0) + 1);
  }
  return [
    { v: "all", l: "All", n: sections.length },
    ...FILTER_ORDER.filter((f) => n.has(f)).map((f) => ({ v: f, l: FILTER_LABEL[f], n: n.get(f)! })),
  ];
}

/** Lowercase words of a kind for a sentence ("average balances and yields"). */
const words = (k: SectionKind) => KIND_LABEL[k].charAt(0).toLowerCase() + KIND_LABEL[k].slice(1);

const list = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

/**
 * One quiet sentence for expected statements no section prints and a bank's headline measures no line
 * prints, or null when nothing is missing.
 */
export function missingNote(kinds: SectionKind[], headlines: string[]): string | null {
  const parts: string[] = [];
  if (kinds.length) parts.push(`Outside the available statement tables: ${list(kinds.map(words))}.`);
  if (headlines.length)
    parts.push(
      `These tables do not show ${list(headlines.map((h) => (/^[A-Z][a-z]/.test(h) ? h.charAt(0).toLowerCase() + h.slice(1) : h)))}.`,
    );
  return parts.length ? parts.join(" ") : null;
}
