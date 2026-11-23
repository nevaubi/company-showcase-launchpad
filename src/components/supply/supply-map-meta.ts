import { logoUrl } from "@/components/app/company-logo";
import { isTradeLink, normText, type NodeRisk, type Relation, type RiskLink, type ShockImpact } from "@/lib/supply/core";
import type { SupplyOverlay } from "@/lib/supply/url-state";

export const RELATION_COLOR: Record<Relation | "focus", string> = {
  customer: "var(--chart-1)",
  supplier: "var(--chart-3)",
  /* partners were green like suppliers; cyan keeps the four relations apart in both themes (contrast on card: 3.4:1 light, 7.9:1 dark) */
  partner: "var(--chart-6)",
  competitor: "var(--negative)",
  focus: "var(--foreground)",
};
export const RELATION_LABEL: Record<Relation, string> = { customer: "Customers", supplier: "Suppliers", partner: "Partners", competitor: "Competitors" };
export const RELATION_ONE: Record<Relation, string> = { customer: "Customer", supplier: "Supplier", partner: "Partner", competitor: "Competitor" };
/** Reading order shared by both views: what comes in, what goes out, then the ties that are not flows. */
export const RELATION_ORDER = ["supplier", "customer", "partner", "competitor"] as const;

/**
 * Marker shape per relation, so the four relations stay apart without colour: the globe draws its markers in these shapes
 * and every legend, heading and filter chip repeats them.
 */
export type MarkShape = "circle" | "square" | "diamond" | "triangle";
export const RELATION_SHAPE: Record<Relation, MarkShape> = { supplier: "circle", customer: "square", partner: "diamond", competitor: "triangle" };
/**
 * Line style per relation, shared by the network connectors and the globe arcs: supply flows are solid with a direction,
 * partnerships are dashed and run both ways, competition is dotted and carries no direction.
 */
export const RELATION_DASH: Record<Relation, number[]> = { supplier: [], customer: [], partner: [6, 3], competitor: [1.5, 3.5] };

const LOGO_DEV = import.meta.env.VITE_LOVABLE_CONNECTOR_LOGO_DEV_API_KEY as string | undefined;

/** Logo for a counterparty outside coverage (covered tickers use the bundled marks). */
export function externalLogo(domain: string | null, ticker: string | null) {
  if (ticker && logoUrl(ticker)) return undefined;
  if (LOGO_DEV) {
    if (domain) return `https://img.logo.dev/${domain}?token=${LOGO_DEV}&size=96&format=png`;
    if (ticker) return `https://img.logo.dev/ticker/${ticker}?token=${LOGO_DEV}&size=96&format=png`;
    return undefined;
  }
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : undefined;
}

/** Risk overlays shared by the globe and network views (the values the address carries, see url-state.ts). */
export type Overlay = SupplyOverlay;
/** True when a name is flagged by the chosen overlay. */
export function overlayHit(overlay: Overlay, risk: NodeRisk | undefined): boolean {
  if (!risk) return false;
  return (overlay === "single" && risk.singleSource) || (overlay === "concentration" && risk.concentrated) || (overlay === "geo" && risk.hotspots.length > 0) || (overlay === "dollars" && risk.dollars != null);
}
/** Key a shock impact is stored under: the ticker when there is one, else the normalised name. */
export const impactKey = (n: { ticker: string | null; name: string }) => n.ticker ?? normText(n.name);
/**
 * The shock result for a name on the map. The simulation walks supplier and customer trade links only, and keys its results
 * by ticker; a partner, a competitor or a financing tie that shares a ticker with a reached supplier is not reached itself.
 */
export function impactOf(impacts: Map<string, ShockImpact> | null | undefined, n: { ticker: string | null; name: string; relation: string; links: unknown[] }): ShockImpact | undefined {
  if (!impacts || (n.relation !== "supplier" && n.relation !== "customer")) return undefined;
  if (!(n.links as RiskLink[]).some(isTradeLink)) return undefined;
  return impacts.get(impactKey(n));
}
