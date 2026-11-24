import type { CompanyProfile } from "@/lib/financials/types";

/**
 * Website, IR address, founding year and description of a covered company as `getCompanyDetails` returns them from
 * the server-only coverage details. `origin` says where the description came from: `curated` (the hand-kept list),
 * `wikipedia` (first sentence of the article, generated list) or `sec` (a sentence built from SEC registration data).
 */
export interface CompanyDetails {
  website?: string;
  ir?: string;
  founded?: number;
  description?: string;
  origin?: DescriptionOrigin;
}

export type DescriptionOrigin = "curated" | "wikipedia" | "sec";

/** The fallback sentence `scripts/lib/coverage-details.ts` writes from SEC data ("... (SEC SIC 3576: ...)."). */
const SEC_SENTENCE = /\(SEC SIC [^)]*\)\.?$/;

/** Where a description of the coverage details comes from. */
export function descriptionOrigin(description: string, curated: boolean): DescriptionOrigin {
  if (curated) return "curated";
  return SEC_SENTENCE.test(description.trim()) ? "sec" : "wikipedia";
}

/** The four descriptive fields the page shows, each from the served profile first and the coverage details second. */
export interface AboutFields {
  website: string | null;
  ir: string | null;
  founded: number | null;
  /** From the served profile (origin `profile`) or from the coverage details with their origin. */
  description: { text: string; origin: DescriptionOrigin | "profile" } | null;
}

const text = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

/** True when the served profile lacks at least one of the four fields, so the details are worth asking for. */
export function needsDetails(p: Pick<CompanyProfile, "website" | "investorRelations" | "description" | "founded">): boolean {
  return !text(p.website) || !text(p.investorRelations) || !text(p.description) || !p.founded;
}

/** Each field from the profile when it has one, otherwise from the details; never mixes a field across the two. */
export function aboutFields(p: Pick<CompanyProfile, "website" | "investorRelations" | "description" | "founded">, d: CompanyDetails | null | undefined): AboutFields {
  const own = text(p.description);
  const other = text(d?.description);
  return {
    website: text(p.website) ?? text(d?.website),
    ir: text(p.investorRelations) ?? text(d?.ir),
    founded: p.founded || d?.founded || null,
    description: own
      ? { text: own, origin: "profile" }
      : other
        ? { text: other, origin: d?.origin ?? descriptionOrigin(other, false) }
        : null,
  };
}

/** The About panel's subtitle: where the left column's text and the facts come from, stated truthfully. */
export function aboutSubtitle(opts: { wikipedia: boolean; description: AboutFields["description"] }): string {
  if (opts.wikipedia || opts.description?.origin === "wikipedia") return "Summary from Wikipedia · facts from SEC EDGAR";
  if (opts.description?.origin === "sec") return "Summary built from SEC registration data · facts from SEC EDGAR";
  return "Facts from SEC EDGAR";
}
