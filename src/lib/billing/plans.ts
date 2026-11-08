/**
 * Plan rules shown in the app. The database (`effective_tier`, `plan_limit`, `consume_usage`)
 * enforces the same numbers; keep both in step and keep plans.test.ts passing.
 */
export type Tier = "trial" | "research" | "pro" | "expired" | "none";
export type UsageKind = "agent" | "report";

export const TRIAL_DAYS = 14;

export const PRICES = {
  research: { monthly: 39, yearly: 390 },
  pro: { monthly: 129, yearly: 1290 },
} as const;

/** agent = questions per UTC day; report = custom AI reports per UTC month. */
export const LIMITS: Record<Tier, Record<UsageKind, number>> = {
  trial: { agent: 10, report: 2 },
  research: { agent: 15, report: 5 },
  pro: { agent: 150, report: 60 },
  expired: { agent: 0, report: 0 },
  none: { agent: 0, report: 0 },
};

export type Feature = "exports" | "deep_mode" | "browser" | "web_research" | "scheduled_briefs" | "alerts";

const FEATURES: Record<Tier, Feature[]> = {
  trial: [],
  research: ["exports", "alerts"],
  pro: ["exports", "alerts", "deep_mode", "browser", "web_research", "scheduled_briefs"],
  expired: [],
  none: [],
};

export function canUse(tier: Tier, feature: Feature): boolean {
  return FEATURES[tier].includes(feature);
}

export interface TierInputs {
  isAdmin: boolean;
  approvedAt: Date | null;
  subscription: { tier: "research" | "pro"; status: string; periodEnd: Date | null } | null;
  now: Date;
}

/** Mirrors SQL effective_tier. */
export function effectiveTier(x: TierInputs): Tier {
  if (x.isAdmin) return "pro";
  const s = x.subscription;
  if (s && ["active", "trialing", "past_due"].includes(s.status) && (!s.periodEnd || s.periodEnd > x.now)) return s.tier;
  if (!x.approvedAt) return "none";
  const ends = x.approvedAt.getTime() + TRIAL_DAYS * 86_400_000;
  return x.now.getTime() < ends ? "trial" : "expired";
}

export function trialDaysLeft(approvedAt: Date, now: Date): number {
  const ms = approvedAt.getTime() + TRIAL_DAYS * 86_400_000 - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

/** Stripe price lookup keys look like "pro_monthly" / "research_yearly". */
export function tierFromPriceId(priceId: string | null | undefined): "research" | "pro" {
  return priceId?.startsWith("pro_") ? "pro" : "research";
}

export const TIER_LABEL: Record<Tier, string> = {
  trial: "Free trial", research: "Research", pro: "Pro", expired: "Trial ended", none: "No access",
};
