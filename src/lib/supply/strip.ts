// What the stats strip at the top of the supply page says about dependency, and in which direction. The strip reads every
// statement on the map, so it holds both what the company's own filings say about its counterparties and what other
// companies' filings say about the company. The Dependency score (`dependencyScore`) reads only the company's own filings.
// Each cell here names the direction and the party it measures, and a cell that shares a word with a score part counts the
// same thing as that part, so the two never read as a contradiction.
import { supplierShareBasis, type ShareBasis } from "./chain";
import { copies, dependencyScore, type GraphNode, type ProLink, type RiskLink, type SharePeriod } from "./core";

export interface StripFacts {
  /** supplier and partner ties the company's own filings call sole, single or exclusive source (the score's count) */
  ownSingle: number;
  /** ties its own filings say it relies on without calling them the only source */
  ownDependency: number;
  /** counterparties whose own filings call the company their sole source */
  namedSoleBy: { label: string; relation: GraphNode["relation"] }[];
  /** names with a stated share of 10% or more, in either direction */
  concentrated: number;
  /** of those, shares the company's own filings state (of its revenue or purchases) */
  concentratedOwn: number;
  /** the largest stated share of 10% or more, and whose revenue or purchases it is a share of */
  topShare: { pct: number; of: string; basis: ShareBasis; own: boolean } | null;
}

const SHARE_WORD: Record<ShareBasis, string> = { revenue: "revenue", purchases: "purchases", receivables: "receivables", buyer_revenue: "revenue" };

/** Whose figure a stated share is: always the filer's (a customer's share of the filer's revenue, a supplier's share of what the filer buys). */
function shareBasis(l: RiskLink): ShareBasis {
  return l.relation === "customer" ? "revenue" : supplierShareBasis(l.quote ?? "");
}

export function stripFacts(focus: string, graph: GraphNode[], all: ProLink[], names: Record<string, string>): StripFacts {
  const score = dependencyScore(focus, all);
  const namedSoleBy: StripFacts["namedSoleBy"] = [];
  let concentrated = 0;
  let concentratedOwn = 0;
  let topShare: StripFacts["topShare"] = null;
  for (const n of graph) {
    const links = n.links as RiskLink[];
    if (links.some((l) => l.ticker !== focus && copies(l).some((c) => !!c.single_source))) namedSoleBy.push({ label: n.ticker ?? n.name, relation: n.relation });
    let big = false;
    let bigOwn = false;
    for (const l of links) for (const c of copies(l)) {
      const pct = c.share_pct ?? 0;
      if (pct < 10) continue;
      big = true;
      const own = l.ticker === focus;
      if (own) bigOwn = true;
      if (!topShare || pct > topShare.pct) topShare = { pct, of: own ? (names[focus] ?? focus) : (names[l.ticker] ?? n.name), basis: shareBasis(l), own };
    }
    if (big) concentrated++;
    if (bigOwn) concentratedOwn++;
  }
  return { ownSingle: score.singleSource, ownDependency: score.statedDependencies, namedSoleBy, concentrated, concentratedOwn, topShare };
}

export interface StripCell {
  label: string;
  value: number;
  hint: string;
  title: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);

/** The single-source cell: the company's own inputs, the same count and the same words as the score's part. */
export function singleSourceCell(f: StripFacts, focusName: string): StripCell {
  const by = f.namedSoleBy;
  const named = by.length === 1 ? `${by[0].label} names ${focusName} its sole source` : by.length > 1 ? `${by.length} companies name ${focusName} sole source` : null;
  const deps = f.ownDependency ? `plus ${plural(f.ownDependency, "stated dependency", "stated dependencies")}` : null;
  return {
    label: SINGLE_SOURCE_LABEL,
    value: f.ownSingle,
    hint: named ?? deps ?? `in ${possessive(focusName)} own filings`,
    title: [
      `${plural(f.ownSingle, "supplier or partner", "suppliers or partners")} ${possessive(focusName)} own filings call a sole, single or exclusive source.`,
      deps ? `${focusName} also states it relies on ${plural(f.ownDependency, "other name")} without calling it the only source.` : "",
      by.length ? `Named as sole source by ${by.map((b) => b.label).join(", ")} in their own filings: not an input of ${focusName}, so not counted here or in the score.` : "",
    ].filter(Boolean).join(" "),
  };
}

/** The concentration cell: names with a share of 10% or more in either direction, the largest said with whose figure it is. */
export function concentrationCell(f: StripFacts, focusName: string): StripCell {
  const t = f.topShare;
  const others = f.concentrated - f.concentratedOwn;
  return {
    label: "Shares of 10% or more",
    value: f.concentrated,
    hint: t ? `largest ${t.pct}% of ${possessive(t.of)} ${SHARE_WORD[t.basis]}` : "no share of 10% or more stated",
    title: [
      `${plural(f.concentratedOwn, "name")} at 10% or more of ${possessive(focusName)} own revenue or purchases, as its filings state.`,
      others ? `${plural(others, "company", "companies")} state${others === 1 ? "s" : ""} that ${focusName} is 10% or more of their own revenue or purchases; the Dependency score does not count those.` : "",
    ].filter(Boolean).join(" "),
  };
}

/** The hotspot cell: its label says where the regions were read, because the fallback is not the link sentences. */
export function hotspotCell(hotspots: string[], fromLinks: boolean, focusName: string): StripCell {
  return {
    label: fromLinks ? "Hotspots in link sentences" : "Hotspots in filings and calls",
    value: hotspots.length,
    hint: hotspots.length ? `${hotspots.slice(0, 2).join(", ")}${hotspots.length > 2 ? ` +${hotspots.length - 2}` : ""}` : "none named in filings or calls",
    title: hotspots.length
      ? `${hotspots.join(", ")}: ${fromLinks ? "named in the sentences of the links on the map, in either direction" : `named in ${possessive(focusName)} other filings and calls, not in any link sentence`}.`
      : "No hotspot region is named in the link sentences, filings or calls.",
  };
}

/** Same words as the score part (`dependencyScore` parts): the strip and the score count the same ties under it. */
export const SINGLE_SOURCE_LABEL = "Single-source inputs";

/** What the Dependency score counts, and what it leaves to the strip. */
export const scoreScope = (focusName: string) =>
  `Counts ${possessive(focusName)} own 10-K and 10-Q only. Sole-source ties and shares that other companies state about ${focusName} are in the strip at the top.`;

/** How the exposure figure was reached: stated flows, estimates from a stated share × the filer's last twelve months of revenue, or both. */
export function exposureWords(rows: { from: "flow" | "share"; period?: SharePeriod }[]): { label: string; note: string | null; title: string } {
  const est = rows.filter((r) => r.from === "share");
  const quarter = est.filter((r) => r.period === "quarter").length;
  const interim = est.filter((r) => r.period === "interim").length;
  const label = !rows.length || !est.length ? "Stated exposure" : est.length === rows.length ? "Estimated exposure" : "Stated and estimated exposure";
  const note = est.length ? `${est.length} estimated` : null;
  const periods = [quarter ? `${plural(quarter, "estimate")} from a quarter's share in a 10-Q` : "", interim ? `${plural(interim, "estimate")} from a year-to-date share in a 10-Q` : ""].filter(Boolean).join("; ");
  const title = est.length
    ? `${plural(est.length, "name")} estimated from a stated share × the filer's revenue for the last twelve months; a 10-K's annual share is used where there is one.${periods ? ` ${periods}.` : ""} ${plural(rows.length - est.length, "name")} at a flow the sentence states.`
    : "Each name once, at its largest flow the sentence states.";
  return { label, note, title };
}

/** How one estimated exposure row reads: the share, its period and whose revenue. */
export function estimateWords(pct: number, period: SharePeriod | undefined, filer: string): string {
  const of = period === "quarter" ? `of ${possessive(filer)} revenue for a quarter (10-Q)` : period === "interim" ? `of ${possessive(filer)} revenue year to date (10-Q)` : `of ${possessive(filer)} revenue`;
  return `est. ${pct}% ${of} × 12-month revenue`;
}
