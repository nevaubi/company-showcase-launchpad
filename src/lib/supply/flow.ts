// Shapes a company's named suppliers and customers into a three-stage flow (suppliers → company →
// customers) sized by the dollar figure each filing states. Pure: no React, no fetching.
import { linkDollars, type GraphNode, type RiskLink } from "@/lib/supply/core";

export interface FlowParty {
  /** Graph node key, e.g. "customer:BA". */
  key: string;
  name: string;
  ticker: string | null;
  relation: "supplier" | "customer";
  /** Largest dollar figure any filing states for this relationship, or null when none does. */
  dollars: number | null;
  /** Largest stated share (% of revenue or purchases), or null. */
  share: number | null;
  detail: string;
  sole: boolean;
  filings: number;
}

/** Suppliers and customers from the focus graph, biggest disclosed dollars first, then biggest share. */
export function flowParties(graph: GraphNode[], revenue: Record<string, number | undefined>): FlowParty[] {
  return graph
    .filter((n): n is GraphNode & { relation: "supplier" | "customer" } => n.relation === "supplier" || n.relation === "customer")
    .map((n) => {
      const links = n.links as RiskLink[];
      const dollars = Math.max(0, ...links.map((l) => linkDollars(l, revenue) ?? 0));
      const share = Math.max(0, ...links.map((l) => l.share_pct ?? 0));
      const best = [...links].sort((a, b) => (linkDollars(b, revenue) ?? 0) - (linkDollars(a, revenue) ?? 0) || (b.share_pct ?? 0) - (a.share_pct ?? 0))[0];
      return {
        key: n.key,
        name: n.name,
        ticker: n.ticker,
        relation: n.relation,
        dollars: dollars > 0 ? dollars : null,
        share: share > 0 ? share : null,
        detail: best?.detail ?? "",
        sole: links.some((l) => l.single_source),
        filings: new Set(links.map((l) => l.accn)).size,
      };
    })
    .sort((a, b) => (b.dollars ?? 0) - (a.dollars ?? 0) || (b.share ?? 0) - (a.share ?? 0) || a.name.localeCompare(b.name));
}

export interface SupplySankey {
  nodes: { id: string; label: string; column: number }[];
  links: { source: string; target: string; value: number }[];
  columns: string[];
  /** Keys of the parties drawn as their own node. */
  drawn: string[];
  /** Parties with a dollar figure that were folded into an "others" node, per side. */
  folded: { supplier: number; customer: number };
  /** Parties left out because no filing states a dollar figure for them. */
  undisclosed: number;
}

export const FOCUS_ID = "focus";
const short = (name: string) => (name.length > 26 ? `${name.slice(0, 25).trimEnd()}…` : name);

/**
 * The flow to draw, or null when no relationship has a dollar figure. Each side shows its largest
 * `perSide` parties and folds the rest into one node, so small flows never become unreadable slivers.
 * A side with no dollar figures is dropped, leaving two stages.
 */
export function buildSupplySankey(focusName: string, parties: FlowParty[], perSide = 8): SupplySankey | null {
  const side = (relation: "supplier" | "customer") => parties.filter((p) => p.relation === relation && p.dollars != null);
  const sup = side("supplier");
  const cus = side("customer");
  if (!sup.length && !cus.length) return null;
  const nodes: SupplySankey["nodes"] = [];
  const links: SupplySankey["links"] = [];
  const drawn: string[] = [];
  const focusCol = sup.length ? 1 : 0;
  const place = (list: FlowParty[], column: number, toFocus: boolean, othersId: string) => {
    const top = list.slice(0, perSide);
    const rest = list.slice(perSide);
    for (const p of top) {
      nodes.push({ id: p.key, label: short(p.name), column });
      drawn.push(p.key);
      links.push(toFocus ? { source: p.key, target: FOCUS_ID, value: p.dollars as number } : { source: FOCUS_ID, target: p.key, value: p.dollars as number });
    }
    if (rest.length) {
      const value = rest.reduce((s, p) => s + (p.dollars as number), 0);
      nodes.push({ id: othersId, label: `${rest.length} ${rest.length === 1 ? "other" : "others"}`, column });
      links.push(toFocus ? { source: othersId, target: FOCUS_ID, value } : { source: FOCUS_ID, target: othersId, value });
    }
    return rest.length;
  };
  const foldedSup = sup.length ? place(sup, 0, true, "others:supplier") : 0;
  nodes.push({ id: FOCUS_ID, label: short(focusName), column: focusCol });
  const foldedCus = cus.length ? place(cus, focusCol + 1, false, "others:customer") : 0;
  return {
    nodes,
    links,
    columns: [...(sup.length ? ["Suppliers"] : []), "Company", ...(cus.length ? ["Customers"] : [])],
    drawn,
    folded: { supplier: foldedSup, customer: foldedCus },
    undisclosed: parties.filter((p) => p.dollars == null).length,
  };
}
