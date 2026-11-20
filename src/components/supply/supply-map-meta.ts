import { logoUrl } from "@/components/app/company-logo";
import { normText, type NodeRisk, type Relation } from "@/lib/supply/core";

export const RELATION_COLOR: Record<Relation | "focus", string> = {
  customer: "var(--chart-1)",
  supplier: "var(--chart-3)",
  partner: "var(--positive)",
  competitor: "var(--negative)",
  focus: "var(--foreground)",
};
export const RELATION_LABEL: Record<Relation, string> = { customer: "Customers", supplier: "Suppliers", partner: "Partners", competitor: "Competitors" };

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

/** Risk overlays shared by the globe and network views. */
export type Overlay = "none" | "single" | "concentration" | "geo" | "dollars";
/** True when a name is flagged by the chosen overlay. */
export function overlayHit(overlay: Overlay, risk: NodeRisk | undefined): boolean {
  if (!risk) return false;
  return (overlay === "single" && risk.singleSource) || (overlay === "concentration" && risk.concentrated) || (overlay === "geo" && risk.hotspots.length > 0) || (overlay === "dollars" && risk.dollars != null);
}
/** Key a shock impact is stored under: the ticker when there is one, else the normalised name. */
export const impactKey = (n: { ticker: string | null; name: string }) => n.ticker ?? normText(n.name);
