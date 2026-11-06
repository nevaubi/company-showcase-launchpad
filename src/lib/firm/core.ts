/** Firm workspace rules shared by the UI and tests. The database enforces the same rules. */

export type FirmRole = "owner" | "admin" | "analyst" | "viewer";
export type Rating = "buy" | "overweight" | "hold" | "underweight" | "sell" | "not_rated";

export const ROLES: FirmRole[] = ["owner", "admin", "analyst", "viewer"];
export const ROLE_LABEL: Record<FirmRole, string> = { owner: "Owner", admin: "Admin", analyst: "Analyst", viewer: "Viewer" };
export const ROLE_HELP: Record<FirmRole, string> = {
  owner: "Everything, including ownership and deleting the firm",
  admin: "Members, invites, branding, templates and the restricted list",
  analyst: "Coverage, notes, reports and shared research",
  viewer: "Read-only access to firm coverage, notes and reports",
};

export const RATINGS: Rating[] = ["buy", "overweight", "hold", "underweight", "sell", "not_rated"];
export const RATING_LABEL: Record<Rating, string> = {
  buy: "Buy", overweight: "Overweight", hold: "Hold", underweight: "Underweight", sell: "Sell", not_rated: "Not rated",
};
export const RATING_TONE: Record<Rating, "positive" | "negative" | "neutral"> = {
  buy: "positive", overweight: "positive", hold: "neutral", underweight: "negative", sell: "negative", not_rated: "neutral",
};
export const PRIORITY_LABEL: Record<number, string> = { 1: "High", 2: "Normal", 3: "Low" };

export function roleRank(r: FirmRole): number {
  return r === "owner" ? 4 : r === "admin" ? 3 : r === "analyst" ? 2 : 1;
}

/** True when `role` is at least `min`. */
export function canAct(role: FirmRole | null | undefined, min: FirmRole): boolean {
  return !!role && roleRank(role) >= roleRank(min);
}

/** Roles `actor` may assign to someone currently holding `current`. Mirrors set_firm_member_role. */
export function assignableRoles(actor: FirmRole | null | undefined, current: FirmRole): FirmRole[] {
  if (actor === "owner") return ROLES;
  if (actor === "admin" && current !== "owner") return ["admin", "analyst", "viewer"];
  return [];
}

/** Whether `actor` may remove a member with `target` role (self-removal = leaving). */
export function canRemove(actor: FirmRole | null | undefined, target: FirmRole, self: boolean, owners: number): boolean {
  if (target === "owner" && owners <= 1) return false;
  if (self) return true;
  if (target === "owner") return actor === "owner";
  return canAct(actor, "admin");
}

export function isEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

/** Upside to target as a fraction, null without both prices. */
export function upside(price: number | null | undefined, target: number | null | undefined): number | null {
  if (!price || !target || price <= 0) return null;
  return target / price - 1;
}

export interface FirmBranding {
  /** Main brand color for covers, headings and table rules (hex). */
  primary?: string;
  /** Secondary color for highlights and charts (hex). */
  accent?: string;
  /** Report typeface family. */
  font?: "sans" | "serif" | "mono";
  /** Legal disclaimer printed on every report. */
  disclaimer?: string;
  /** Short footer line, e.g. "For internal use only". */
  footer?: string;
  /** Print the preparing analyst's name on covers. */
  signature?: boolean;
}

export const DEFAULT_BRANDING: Required<FirmBranding> = {
  primary: "#1d1d1b",
  accent: "#c9a227",
  font: "sans",
  disclaimer:
    "This report was prepared from public SEC filings and market data for internal research purposes. It is not investment advice. Figures cite their source filings; estimates and market data are labeled.",
  footer: "Internal research — not for distribution",
  signature: true,
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Brand settings with invalid or missing values replaced by defaults. */
export function resolveBranding(b: FirmBranding | null | undefined): Required<FirmBranding> {
  const x = b ?? {};
  return {
    primary: x.primary && HEX.test(x.primary) ? x.primary : DEFAULT_BRANDING.primary,
    accent: x.accent && HEX.test(x.accent) ? x.accent : DEFAULT_BRANDING.accent,
    font: x.font === "serif" || x.font === "mono" || x.font === "sans" ? x.font : DEFAULT_BRANDING.font,
    disclaimer: typeof x.disclaimer === "string" ? x.disclaimer.slice(0, 1200) : DEFAULT_BRANDING.disclaimer,
    footer: typeof x.footer === "string" ? x.footer.slice(0, 120) : DEFAULT_BRANDING.footer,
    signature: typeof x.signature === "boolean" ? x.signature : DEFAULT_BRANDING.signature,
  };
}

/** WCAG relative luminance of a #rrggbb color. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Text color (dark or light) that reads on top of `hex`. */
export function readableOn(hex: string): "#ffffff" | "#111111" {
  return luminance(HEX.test(hex) ? hex : DEFAULT_BRANDING.primary) > 0.4 ? "#111111" : "#ffffff";
}

export function activityText(action: string, detail: Record<string, unknown>, name: (id: string) => string): string {
  switch (action) {
    case "firm.created": return `created the firm`;
    case "member.joined": return `joined as ${ROLE_LABEL[detail.role as FirmRole] ?? "member"}`;
    case "member.left": return `left the firm`;
    case "member.removed": return `removed ${name(String(detail.user_id))}`;
    case "member.role": return `changed ${name(String(detail.user_id))} from ${ROLE_LABEL[detail.from as FirmRole]} to ${ROLE_LABEL[detail.to as FirmRole]}`;
    case "coverage.added": return `added coverage`;
    case "coverage.removed": return `dropped coverage`;
    case "note.added": return `wrote a note`;
    case "invite.sent": return `invited ${String(detail.email ?? "someone")} as ${ROLE_LABEL[detail.role as FirmRole] ?? "member"}`;
    case "invite.revoked": return `revoked the invite for ${String(detail.email ?? "someone")}`;
    case "firm.renamed": return `renamed the firm to ${String(detail.to ?? "")}`;
    case "firm.branding": return detail.logo ? `updated the logo and report branding` : `updated report branding`;
    case "coverage.updated": {
      const parts: string[] = [];
      const pair = (k: string) => detail[k] as [unknown, unknown] | undefined;
      const r = pair("rating"); if (r) parts.push(`rating ${RATING_LABEL[r[0] as Rating]} → ${RATING_LABEL[r[1] as Rating]}`);
      const t = pair("target_price"); if (t) parts.push(`target ${t[0] == null ? "none" : `$${t[0]}`} → ${t[1] == null ? "none" : `$${t[1]}`}`);
      const a = pair("analyst_id"); if (a) parts.push(`analyst → ${a[1] ? name(String(a[1])) : "unassigned"}`);
      const x = pair("restricted"); if (x) parts.push(x[1] ? `added to restricted list${detail.reason ? ` (${detail.reason})` : ""}` : "removed from restricted list");
      const p = pair("priority"); if (p) parts.push(`priority ${PRIORITY_LABEL[Number(p[1])]}`);
      return parts.length ? parts.join(", ") : "updated coverage";
    }
    default: return action.replace(/[._]/g, " ");
  }
}
