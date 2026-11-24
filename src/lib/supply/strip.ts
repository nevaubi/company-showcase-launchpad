// What the stats strip at the top of the supply page says about dependency, and in which direction. The strip reads every
// statement on the map, so it holds both what the company's own filings say about its counterparties and what other
// companies' filings say about the company. The Dependency score (`dependencyScore`) reads only the company's own filings.
// Each cell here names the direction and the party it measures, and a cell that shares a word with a score part counts the
// same thing as that part, so the two never read as a contradiction.
import { supplierShareBasis, type ShareBasis } from "./chain";
import { concentrationBasis, copies, dependencyScore, periodWords, statedShare, type Dependency, type GraphNode, type ProLink, type RiskLink, type SharePeriod } from "./core";

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
  topShare: { pct: number; of: string; basis: ShareBasis; own: boolean; period: SharePeriod } | null;
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
    // one share per link, the one quoted everywhere (a 10-K's year over a 10-Q's quarter), with its period
    for (const l of links) {
      const sh = statedShare(l);
      if (!sh || sh.pct < 10) continue;
      big = true;
      const own = l.ticker === focus;
      if (own) bigOwn = true;
      if (!topShare || sh.pct > topShare.pct) topShare = { pct: sh.pct, of: own ? (names[focus] ?? focus) : (names[l.ticker] ?? n.name), basis: shareBasis(l), own, period: sh.period };
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
  const named = by.length === 1 ? `${by[0].label}: ${focusName} is its sole source` : by.length > 1 ? `${by.length} companies: ${focusName} is their sole source` : null;
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
    hint: t ? `${t.pct}% of ${possessive(t.of)} ${SHARE_WORD[t.basis]}${periodWords(t.period)} (largest)` : "no share of 10% or more stated",
    title: [
      `${plural(f.concentratedOwn, "name")} at 10% or more of ${possessive(focusName)} own revenue or purchases, as its filings state.`,
      others ? `${plural(others, "company", "companies")} state${others === 1 ? "s" : ""} that ${focusName} is 10% or more of their own revenue or purchases; the Dependency score does not count those.` : "",
    ].filter(Boolean).join(" "),
  };
}

/** The hotspot cell: its label says where the regions were read, because the fallback is not the link sentences. */
export function hotspotCell(hotspots: string[], fromLinks: boolean, focusName: string): StripCell {
  return {
    label: "Hotspot regions",
    value: hotspots.length,
    hint: hotspots.length ? `${hotspots.slice(0, 2).join(", ")}${hotspots.length > 2 ? ` +${hotspots.length - 2}` : ""}, ${fromLinks ? "in link sentences" : "in filings and calls"}` : "none named in filings or calls",
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
  const label = !rows.length || !est.length ? "Stated exposure" : est.length === rows.length ? "Estimated exposure" : "Exposure (stated, est.)";
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

/** A customer share the company's own 10-K or 10-Q states without naming the customer ("one direct customer represented 22%"). */
export interface UnnamedShare { pct: number; period: string | null; form: string | null }

/** The largest unnamed customer share of revenue in the company's own filings (signals of kind concentration, read from a filing). */
export function unnamedCustomerShare(signals: { kind: string; pct: number | null; quote: string; source_kind: string; form: string | null; period: string | null }[]): UnnamedShare | null {
  let best: UnnamedShare | null = null;
  for (const s of signals) {
    if (s.kind !== "concentration" || s.pct == null || !(s.pct > 0) || s.pct > 100 || s.source_kind !== "filing") continue;
    if (concentrationBasis(s.quote) !== "revenue") continue;
    if (!best || s.pct > best.pct) best = { pct: s.pct, period: s.period, form: s.form };
  }
  return best;
}

export interface ScorePart { label: string; points: number | null; max: number; why: string }
export interface ScoreReading {
  /** null when no part has an input: the panel says "Not scored", never 0 */
  value: number | null;
  /** the line beside the value, or the reason when there is no value */
  sub: string;
  parts: ScorePart[];
  customerHhi: number;
  /** share of revenue the customer part counts (named shares, plus the unnamed share when it is folded in) */
  customerPct: number;
  /** the unnamed share folded into the customer part, if any */
  unnamed: UnnamedShare | null;
}

const customerPoints = (top: number, hhi: number) => Math.round(Math.min(40, top * 0.8 + Math.min(10, hhi / 250)));

/**
 * What the Dependency panel prints. A part whose inputs the filings do not give is "not scored", never 0 points; the score
 * is printed only when at least one part has an input. Two inputs the page already shows join the score by its own rules:
 * an unnamed customer's share of revenue that the company's own filing states (when it is larger than every named share
 * together, so it cannot be one of them), and the hotspots of the strip, which make the geopolitical part "not scored"
 * rather than 0 when no own link sentence names them. The strip, the score and the panel's note then never disagree.
 */
export function scoreReading(d: Dependency, focusName: string, unnamed: UnnamedShare | null, hot: { hotspots: string[]; fromLinks: boolean }): ScoreReading {
  const own = possessive(focusName);
  const fold = unnamed && unnamed.pct > d.statedCustomerPct ? unnamed : null;
  const top = Math.max(d.topCustomerPct, fold?.pct ?? 0);
  const hhi = Math.round(d.customerHhi + (fold ? fold.pct * fold.pct : 0));
  const named = d.parts.find((p) => p.label === "Customer concentration")!;
  const customer: ScorePart = top > 0
    ? {
        label: named.label, points: customerPoints(top, hhi), max: 40,
        why: fold
          ? `largest customer ${fold.pct}% of revenue, unnamed in ${own} ${fold.form ?? "filing"}${fold.period ? ` (${fold.period})` : ""}${d.topCustomerPct ? `; largest named customer ${d.topCustomerPct}%` : ""}`
          : named.why,
      }
    : { label: named.label, points: null, max: 40, why: `Not scored: ${own} filings state no customer share` };
  const single = d.parts.find((p) => p.label === SINGLE_SOURCE_LABEL)!;
  const geoPart = d.parts.find((p) => p.label === "Geopolitical exposure")!;
  const list = (h: string[]) => `${h.slice(0, 3).join(", ")}${h.length > 3 ? ` and ${h.length - 3} more` : ""}`;
  const geo: ScorePart = d.hotspotLinks > 0
    ? geoPart
    : hot.hotspots.length
      ? {
          label: geoPart.label, points: null, max: 30,
          why: hot.fromLinks
            ? `Not scored: ${list(hot.hotspots)} appear in other companies' link sentences, none in ${own} own`
            : `Not scored: ${own} filings and calls name ${list(hot.hotspots)}, but no link sentence ties a counterparty there`,
        }
      : { ...geoPart, why: "no hotspot region named in link sentences, filings or calls" };
  const parts: ScorePart[] = [customer, single, geo];
  const scored = parts.filter((p) => p.points != null);
  const anyInput = customer.points != null || (single.points ?? 0) > 0 || d.hotspotLinks > 0;
  const unscored = parts.filter((p) => p.points == null).map((p) => p.label.toLowerCase());
  if (!anyInput) {
    const why = [customer.points == null ? "name no customer share" : "", d.hotspotLinks === 0 ? "tie no link to a hotspot region" : ""].filter(Boolean).join(" and ");
    return { value: null, sub: `Not scored: ${own} filings ${why || "give no input"}`, parts, customerHhi: hhi, customerPct: Math.min(100, d.statedCustomerPct + (fold?.pct ?? 0)), unnamed: fold };
  }
  const value = scored.reduce((a, p) => a + (p.points ?? 0), 0);
  const sub = unscored.length ? `of 100 · ${unscored.join(" and ")} not scored` : "of 100 · higher is more fragile";
  return { value, sub, parts, customerHhi: hhi, customerPct: Math.min(100, d.statedCustomerPct + (fold?.pct ?? 0)), unnamed: fold };
}
