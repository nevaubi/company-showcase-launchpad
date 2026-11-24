// One part of the supply picture kept lit while the rest is dimmed: every counterparty of one kind ("suppliers only"),
// one counterparty, or one pathway from upstream to downstream. The page keeps it in the address (`iso`, url-state.ts),
// turns it here into the keys each view lights and the words it shows, and every table and evidence list follows it.
// Pure: no React, no browser/Node APIs.
import { entityKey, RELATIONS, type GraphNode, type HopNode, type Relation } from "./core";
import type { Chain, ChainEdge, ChainNode } from "./chain";
import type { IsolateRequest } from "./isolate-contract";
import { resolveSelection, selectionParam } from "./url-state";

/** What is isolated, as the address carries it. */
export type Isolation =
  | { kind: "relation"; relation: Relation }
  /** one name, written the way a selection is (`selectionParam`): "supplier:TSM", "customer:Kioxia Corporation", or a second-order key */
  | { kind: "node"; node: string }
  /** one pathway as entity keys (ticker, else the normalised name), upstream to downstream, the company itself in its place */
  | { kind: "path"; keys: string[] };

const SEP = ">";
/** A pathway is at most three tiers either side of the company. */
const MAX_PATH = 7;

/** `iso` in the address: "rel:supplier", "node:supplier:TSM", "path:ENTG>TSM>NVDA>HPE". */
export function isolationParam(i: Isolation | null | undefined): string | undefined {
  if (!i) return undefined;
  if (i.kind === "relation") return `rel:${i.relation}`;
  if (i.kind === "node") return i.node ? `node:${i.node}` : undefined;
  return i.keys.length > 1 ? `path:${i.keys.join(SEP)}` : undefined;
}

/** Reads `iso` back. Anything it cannot read is no isolation, never an error. */
export function parseIsolation(raw: string | null | undefined): Isolation | null {
  const s = raw?.trim();
  if (!s) return null;
  const at = s.indexOf(":");
  if (at < 1) return null;
  const head = s.slice(0, at), rest = s.slice(at + 1).trim();
  if (!rest) return null;
  if (head === "rel") return (RELATIONS as string[]).includes(rest) ? { kind: "relation", relation: rest as Relation } : null;
  if (head === "node") return { kind: "node", node: rest };
  if (head !== "path") return null;
  const keys = rest.split(SEP).map((k) => k.trim()).filter(Boolean);
  return keys.length > 1 && keys.length <= MAX_PATH ? { kind: "path", keys } : null;
}

export interface IsolateContext {
  /** ticker of the company the page is about */
  focus: string;
  focusName?: string;
  graph: GraphNode[];
  hop2: HopNode[];
  /** the chain as drawn (Chain view). Without it a pathway is matched against the names on the map only. */
  chain?: Chain | null;
  /** names by entity key (ticker, else the normalised name) for a pathway's label, so Chain, Network and Globe say the same
      words whether or not they draw the name: the covered universe and the second-order names at any depth */
  names?: Record<string, string>;
  /** how many tiers the map draws (Network and Globe); a pathway through a tier beyond it says so in `needsDepth` */
  mapDepth?: 1 | 2;
}

const isHop2 = (n: GraphNode | HopNode): n is HopNode => (n as HopNode).hop === 2;
/** One identity for a name on the map and in the chain: its ticker, else its normalised name (which is the chain's node key). */
export const nodeId = (n: Pick<GraphNode, "name" | "ticker">): string => (n.ticker ? n.ticker.toUpperCase() : entityKey(n.name, null));
const sideOf = (relation: string): -1 | 0 | 1 => (relation === "supplier" ? -1 : relation === "customer" ? 1 : 0);
const sameKeys = (a: string[], b: string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** A place on a pathway: which side of the company and how many links away. */
interface Step { id: string; side: -1 | 1; depth: number }

/** Keys of any kind (map node keys, second-order keys, chain keys, the company itself) as places on one pathway. */
function steps(keys: string[], ctx: IsolateContext): Step[] {
  const F = ctx.focus.toUpperCase();
  const out: Step[] = [];
  const add = (id: string, side: -1 | 1, depth: number) => {
    if (depth >= 1 && !out.some((s) => s.side === side && s.depth === depth)) out.push({ id, side, depth });
  };
  const clean = keys.map((k) => k.trim()).filter(Boolean);
  const at = clean.findIndex((k) => k === "focus" || k.toUpperCase() === F);
  if (at >= 0) {
    /* the company is in its place: everything before it is upstream (nearest last), everything after is downstream */
    clean.slice(0, at).reverse().forEach((id, i) => add(id, -1, i + 1));
    clean.slice(at + 1).forEach((id, i) => add(id, 1, i + 1));
    return out;
  }
  const all = [...ctx.graph, ...ctx.hop2];
  for (const k of clean) {
    const n = all.find((x) => x.key === k);
    if (n) {
      if (isHop2(n)) {
        const parent = ctx.graph.find((x) => x.key === n.parent);
        const side = parent ? sideOf(parent.relation) : 0;
        if (parent && side) { add(nodeId(parent), side, 1); add(nodeId(n), side, 2); }
      } else {
        const side = sideOf(n.relation);
        if (side) add(nodeId(n), side, 1);
      }
      continue;
    }
    const c = ctx.chain?.nodes.find((x) => x.key === k);
    if (c && c.tier !== 0) {
      /* a chain key alone: bring the names between it and the company */
      for (const key of chainPath(ctx.chain as Chain, c.key)) {
        const tier = (ctx.chain as Chain).nodes.find((x) => x.key === key)?.tier ?? 0;
        if (tier !== 0) add(key, tier < 0 ? -1 : 1, Math.abs(tier));
      }
      continue;
    }
    const direct = ctx.graph.find((x) => sideOf(x.relation) !== 0 && nodeId(x) === k);
    if (direct) add(nodeId(direct), sideOf(direct.relation) as -1 | 1, 1);
  }
  return out;
}

const orderedKeys = (s: Step[], focus: string): string[] => {
  const up = s.filter((x) => x.side < 0).sort((a, b) => b.depth - a.depth).map((x) => x.id);
  const down = s.filter((x) => x.side > 0).sort((a, b) => a.depth - b.depth).map((x) => x.id);
  return up.length || down.length ? [...up, focus.toUpperCase(), ...down] : [];
};

/** A pathway request's keys in the address form: entity keys, upstream to downstream, the company in its place. Empty when nothing on it is a supplier or customer tie. */
export function canonicalPath(keys: string[], ctx: IsolateContext): string[] {
  return orderedKeys(steps(keys, ctx), ctx.focus).slice(0, MAX_PATH);
}

/** The pathway from a chain node to the company along the links that placed it, upstream to downstream. */
export function chainPath(chain: Chain, key: string): string[] {
  const byKey = new Map(chain.nodes.map((n) => [n.key, n]));
  const start = byKey.get(key);
  if (!start) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let n: ChainNode | undefined = start; n && !seen.has(n.key); n = n.via ? byKey.get(n.via) : undefined) {
    seen.add(n.key);
    out.push(n.key);
  }
  return start.tier <= 0 ? out : out.reverse();
}

/** The pathway through one stated link: the link itself, then on to the company along the links that placed its nearer end. */
export function chainEdgePath(chain: Chain, edge: Pick<ChainEdge, "from" | "to">): string[] {
  const tier = (k: string) => chain.nodes.find((n) => n.key === k)?.tier;
  const a = tier(edge.from), b = tier(edge.to);
  if (a == null || b == null) return [];
  return b <= 0 ? [edge.from, ...chainPath(chain, edge.to)] : [...chainPath(chain, edge.from), edge.to];
}

/**
 * Joins a newly picked half pathway with the one already isolated: a pick upstream keeps the downstream half and the
 * other way round, so a supplier and then a customer make one pathway through the company. Picking the same half again
 * drops it. Null when nothing is left.
 */
export function joinPath(current: string[] | null | undefined, next: string[], focus: string): string[] | null {
  const F = focus.toUpperCase();
  const split = (keys: string[]) => {
    const at = keys.findIndex((k) => k.toUpperCase() === F);
    return at < 0 ? { up: keys, down: [] as string[] } : { up: keys.slice(0, at), down: keys.slice(at + 1) };
  };
  const cur = current?.length ? split(current) : { up: [], down: [] }, nx = split(next);
  const up = nx.up.length ? (sameKeys(nx.up, cur.up) ? [] : nx.up) : cur.up;
  const down = nx.down.length ? (sameKeys(nx.down, cur.down) ? [] : nx.down) : cur.down;
  return up.length || down.length ? [...up, F, ...down] : null;
}

/**
 * What the page isolates after a request from a view or a control. The same request twice clears it (a pressed control
 * releases); a request that names nothing the page shows leaves things as they are.
 */
export function nextIsolation(current: Isolation | null, request: IsolateRequest, ctx: IsolateContext): Isolation | null {
  if (request.kind === "clear") return null;
  if (request.kind === "relation") {
    return current?.kind === "relation" && current.relation === request.relation ? null : { kind: "relation", relation: request.relation };
  }
  if (request.kind === "node") {
    const n = [...ctx.graph, ...ctx.hop2].find((x) => x.key === request.key);
    if (!n) return current;
    const node = selectionParam(n);
    return current?.kind === "node" && current.node === node ? null : { kind: "node", node };
  }
  const keys = canonicalPath(request.keys, ctx);
  if (!keys.length) return current;
  const joined = joinPath(current?.kind === "path" ? current.keys : null, keys, ctx.focus);
  return joined ? { kind: "path", keys: joined } : null;
}

/** What an isolation lights, resolved against the names the page shows. */
export interface Isolated {
  isolation: Isolation;
  /** keys of the first- and second-order names to keep lit; the company itself is always lit */
  lit: ReadonlySet<string>;
  /** what is isolated, in a few words: "Suppliers only", "TSMC", "TSMC to Microsoft" */
  label: string;
  /** set for a relation isolation: rows of that relation belong to it even when their name is not on the map */
  relation: Relation | null;
  /** key of the one name that is isolated (a name isolation), else null */
  node: string | null;
  /** chain node keys to keep lit, the company included; null when the isolation says nothing about the chain */
  chainNodes: ReadonlySet<string> | null;
  /** chain edge keys to keep lit */
  chainEdges: ReadonlySet<string> | null;
  /** one pathway in order (chain node keys, upstream to downstream) for the path strip; empty when no single pathway is isolated */
  path: string[];
  /** why the chain is left whole, when it is */
  chainNote: string | null;
  /** set on the map views when the pathway names a tier the current depth does not draw: the depth that draws it, and the name there */
  needsDepth: { depth: 2; name: string } | null;
}

const ONLY: Record<Relation, string> = { supplier: "Suppliers only", customer: "Customers only", partner: "Partners only", competitor: "Competitors only" };

/** The keys and words for an isolation, or null when it names nothing the page shows (the page then shows everything). */
export function resolveIsolation(isolation: Isolation | null | undefined, ctx: IsolateContext): Isolated | null {
  if (!isolation) return null;
  const F = ctx.focus.toUpperCase();
  const chain = ctx.chain ?? null;
  const all: (GraphNode | HopNode)[] = [...ctx.graph, ...ctx.hop2];
  const lit = new Set<string>();
  const within = (nodes: Set<string>) => new Set((chain?.edges ?? []).filter((e) => nodes.has(e.from) && nodes.has(e.to)).map((e) => e.key));
  const base = { isolation, lit, relation: null, node: null as string | null, chainNodes: null, chainEdges: null, path: [] as string[], chainNote: null, needsDepth: null } satisfies Partial<Isolated>;

  if (isolation.kind === "relation") {
    const r = isolation.relation;
    for (const n of ctx.graph) if (n.relation === r) lit.add(n.key);
    for (const h of ctx.hop2) if (lit.has(h.parent)) lit.add(h.key);
    const side = sideOf(r);
    if (!chain) return { ...base, label: ONLY[r], relation: r };
    if (!side) return { ...base, label: ONLY[r], relation: r, chainNote: "The chain shows suppliers and customers only" };
    const nodes = new Set(chain.nodes.filter((n) => n.tier === 0 || Math.sign(n.tier) === side).map((n) => n.key));
    return { ...base, label: ONLY[r], relation: r, chainNodes: nodes, chainEdges: within(nodes) };
  }

  if (isolation.kind === "node") {
    const key = resolveSelection(all, isolation.node);
    const n = key ? all.find((x) => x.key === key) : undefined;
    if (!n) return null;
    lit.add(n.key);
    const parent = isHop2(n) ? ctx.graph.find((x) => x.key === n.parent) : undefined;
    if (isHop2(n)) lit.add(n.parent);
    else for (const h of ctx.hop2) if (h.parent === n.key) lit.add(h.key);
    const label = isHop2(n) ? `${n.name} via ${parent?.name ?? "a direct link"}` : n.name;
    base.node = n.key;
    if (!chain) return { ...base, label };
    const side = sideOf(isHop2(n) ? (parent?.relation ?? "") : n.relation), depth = isHop2(n) ? 2 : 1;
    const id = nodeId(n);
    const c = side ? (chain.nodes.find((x) => x.key === id && x.tier === side * depth) ?? chain.nodes.find((x) => x.key === id && Math.sign(x.tier) === side)) : undefined;
    if (!c) return { ...base, label, chainNote: `${n.name} is not in the chain as drawn` };
    const path = chainPath(chain, c.key);
    /* its links to the company, and what hangs off it further out */
    const nodes = new Set(path);
    for (const x of chain.nodes) if (chainPath(chain, x.key).includes(c.key)) nodes.add(x.key);
    return { ...base, label, chainNodes: nodes, chainEdges: within(nodes), path };
  }

  const F_NAME = ctx.focusName ?? ctx.names?.[F] ?? F;
  /* one name per key whatever the view: the universe and second-order names first, then what the chain or map draws */
  const known = (id: string): string | null =>
    id === F ? F_NAME : (ctx.names?.[id] ?? chain?.nodes.find((x) => x.key === id)?.name ?? all.find((x) => nodeId(x) === id)?.name ?? null);
  /* a key that names nothing anywhere (a mistyped or stale address) is dropped before anything is labelled */
  const resolves = (raw: string) => {
    const k = raw.trim();
    return k === "focus" || all.some((x) => x.key === k) || !!chain?.nodes.some((n) => n.key === k) || known(k) != null || known(k.toUpperCase()) != null;
  };
  const st = steps(isolation.keys.filter(resolves), ctx);
  const keys = orderedKeys(st, F);
  if (!keys.length) return null;
  const nameOf = (id: string) => known(id) ?? id;
  for (const side of [-1, 1] as const) {
    const s1 = st.find((s) => s.side === side && s.depth === 1);
    const first = s1 && ctx.graph.find((n) => sideOf(n.relation) === side && nodeId(n) === s1.id);
    if (!first) continue;
    lit.add(first.key);
    const s2 = st.find((s) => s.side === side && s.depth === 2);
    const child = s2 && ctx.hop2.find((h) => h.parent === first.key && nodeId(h) === s2.id);
    if (child) lit.add(child.key);
  }
  /* the same places in the chain: a name counts only at the tier the pathway gives it */
  const at = keys.indexOf(F);
  const inChain = chain ? keys.filter((k, i) => i === at || chain.nodes.some((n) => n.key === k && n.tier === i - at)) : [];
  const label = `${nameOf(keys[0])} to ${nameOf(keys[keys.length - 1])}`;
  if (!chain) {
    /* a second-order name on a map that draws one tier: lit as far as the map goes, and the status offers the deeper map */
    const deep = ctx.mapDepth === 1 ? st.find((s) => s.depth === 2) : undefined;
    const needsDepth = deep ? { depth: 2 as const, name: nameOf(deep.id) } : null;
    if (!lit.size && !needsDepth) return null;
    return { ...base, label, path: keys, needsDepth };
  }
  if (!lit.size && inChain.length < 2) return null;
  if (inChain.length < 2) return { ...base, label, path: keys, chainNote: "This pathway is not in the chain as drawn" };
  const pairs = new Set(inChain.slice(1).map((k, i) => `${inChain[i]}>${k}`));
  return { ...base, label, chainNodes: new Set(inChain), chainEdges: new Set(chain.edges.filter((e) => pairs.has(e.key)).map((e) => e.key)), path: inChain };
}

/** Whether a row about a name belongs to what is isolated (everything does when nothing is isolated). */
export function isolatedHas(iso: Isolated | null | undefined, row: { key?: string | null; relation?: string | null }): boolean {
  if (!iso) return true;
  if (row.key != null && iso.lit.has(row.key)) return true;
  return iso.relation != null && row.relation === iso.relation;
}

/** One link of an isolated pathway: who sells to whom, with the stated link when a filing states it. */
export interface PathHop { from: ChainNode; to: ChainNode; edge: ChainEdge | null }
/** The links of a pathway in order, for the path strip. */
export function pathHops(chain: Chain, keys: string[]): PathHop[] {
  const byKey = new Map(chain.nodes.map((n) => [n.key, n]));
  const edges = new Map(chain.edges.map((e) => [e.key, e]));
  const out: PathHop[] = [];
  for (let i = 1; i < keys.length; i++) {
    const from = byKey.get(keys[i - 1]), to = byKey.get(keys[i]);
    if (from && to) out.push({ from, to, edge: edges.get(`${from.key}>${to.key}`) ?? null });
  }
  return out;
}
