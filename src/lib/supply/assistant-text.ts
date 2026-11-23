// What the research assistant's supply tools say about each name: the same verified claims the views show (stated share,
// stated flow or other figure with its kind, sole-source wording or a stated dependency, non-trade nature, named regions),
// the filing it rests on, and the app address that opens the name selected. Pure, no browser/Node APIs.
import { copies, linkDollarsFrom, statedRegions, type GraphNode, type RiskLink } from "./core";
import { KIND_WORD, NATURE_WORD, nodeFacts } from "./describe";
import { selectionParam, supplyHref } from "./url-state";

const usd = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B` : `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`);

/** One line per name for `get_supply_chain`. */
export function supplyNodeLine(focus: string, n: GraphNode, revenue: Record<string, number | undefined>): string {
  const f = nodeFacts(n);
  const l = n.links[0] as RiskLink;
  const d = linkDollarsFrom(l, revenue);
  const parts = [`${n.relation.toUpperCase()} ${n.name}${n.ticker ? ` (${n.ticker})` : ""}: ${l.detail}`];
  if (f.share != null) parts.push(`stated share ${f.share}%`);
  if (f.flow) parts.push(`stated ${KIND_WORD[f.flow.kind]} ${usd(f.flow.value)}`);
  else if (d?.from === "share") parts.push(`≈${usd(d.dollars)} (share × SEC revenue)`);
  if (f.other) parts.push(`stated ${KIND_WORD[f.other.kind]} ${usd(f.other.value)}, not a flow`);
  if (f.singleSource) parts.push("SINGLE SOURCE (sole-source wording)");
  else if (f.dependency) parts.push("stated dependency (no sole-source wording)");
  const nature = n.relation === "competitor" ? null : NATURE_WORD[f.nature];
  if (nature) parts.push(`${nature.toLowerCase()}, not a trade flow`);
  const regions = [...new Set((n.links as RiskLink[]).flatMap((x) => statedRegions(x)))];
  if (regions.length) parts.push(`regions named: ${regions.join(", ")}`);
  if (l.risk) parts.push(`risk: ${l.risk}`);
  const filings = [...new Set((n.links as RiskLink[]).flatMap((x) => copies(x)).map((x) => `${x.form} ${x.accn}`))];
  parts.push(`per ${l.ticker} ${filings.join(" + ")}: "${l.quote}"`);
  parts.push(`open: ${supplyHref({ t: focus, sel: selectionParam(n) })}`);
  return parts.join(" | ");
}
