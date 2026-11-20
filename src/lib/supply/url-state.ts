// What the supply-chain page keeps in its address, so a copied link reopens the same picture: the company, the view,
// the selected name, the risk overlay, the depth and the analysis tab. Values are validated and an unknown value is
// dropped (the page falls back to its saved or default state) rather than breaking the page. Pure, no browser/Node APIs.
import { z } from "zod";
import { entityKey } from "./entity";
import { RELATIONS, type GraphNode, type HopNode, type Relation } from "./core";

export const SUPPLY_VIEWS = ["network", "globe", "chain"] as const;
export type SupplyView = (typeof SUPPLY_VIEWS)[number];
export const SUPPLY_OVERLAYS = ["none", "single", "concentration", "geo", "dollars"] as const;
export type SupplyOverlay = (typeof SUPPLY_OVERLAYS)[number];
export const SUPPLY_TABS = ["evidence", "reactions", "changes", "shock", "exposure"] as const;
export type SupplyTab = (typeof SUPPLY_TABS)[number];

/** Search params of /app/supply-chain. Each one is optional and a bad value is ignored, never an error page. */
export const supplySearch = z.object({
  t: z.string().max(10).optional().catch(undefined),
  view: z.enum(SUPPLY_VIEWS).optional().catch(undefined),
  /** the selected name: "relation:TICKER" or "relation:Name" (see `selectionParam`), or a second-order node key */
  sel: z.string().max(160).optional().catch(undefined),
  overlay: z.enum(SUPPLY_OVERLAYS).optional().catch(undefined),
  depth: z.coerce.number().int().min(1).max(2).optional().catch(undefined),
  tab: z.enum(SUPPLY_TABS).optional().catch(undefined),
});
export type SupplySearch = z.infer<typeof supplySearch>;

const isHop2 = (n: GraphNode | HopNode): n is HopNode => (n as HopNode).hop === 2;

/** How a selected name is written in the address: readable for first-order names, the node key for second-order ones. */
export function selectionParam(n: GraphNode | HopNode): string {
  if (isHop2(n)) return n.key;
  return `${n.relation}:${n.ticker ?? n.name}`;
}

/**
 * The node a `sel` value points at: an exact node key, else "relation:TICKER" / "relation:Name" (the name compared without
 * corporate suffixes, so "Kioxia" finds "Kioxia Corporation"), else a bare ticker or name, first match in graph order.
 */
export function resolveSelection(nodes: (GraphNode | HopNode)[], sel: string | null | undefined): string | null {
  const raw = sel?.trim();
  if (!raw) return null;
  const exact = nodes.find((n) => n.key === raw);
  if (exact) return exact.key;
  const at = raw.indexOf(":");
  const head = at > 0 ? raw.slice(0, at).toLowerCase() : "";
  const rel = (RELATIONS as string[]).includes(head) ? (head as Relation) : null;
  const value = rel ? raw.slice(at + 1).trim() : raw;
  if (!value) return null;
  const want = entityKey(value, null);
  const hit = nodes.find((n) => !isHop2(n) && (!rel || n.relation === rel) && ((n.ticker != null && n.ticker.toUpperCase() === value.toUpperCase()) || entityKey(n.name, null) === want));
  return hit?.key ?? null;
}

/** The address of a supply-chain picture, for the assistant and for shared links. Defaults are left out. */
export function supplyHref(s: SupplySearch): string {
  const q = new URLSearchParams();
  if (s.t) q.set("t", s.t.toUpperCase());
  if (s.view && s.view !== "network") q.set("view", s.view);
  if (s.sel) q.set("sel", s.sel);
  if (s.overlay && s.overlay !== "none") q.set("overlay", s.overlay);
  if (s.depth === 2) q.set("depth", "2");
  if (s.tab && s.tab !== "evidence") q.set("tab", s.tab);
  const qs = q.toString();
  return qs ? `/app/supply-chain?${qs}` : "/app/supply-chain";
}
