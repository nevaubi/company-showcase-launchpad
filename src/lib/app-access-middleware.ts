import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Feature } from "@/lib/billing/plans";

/**
 * Signed in AND allowed into the product (approved waitlist, admin or demo).
 * Use on every server function that returns research data or spends AI credits,
 * so the waiting list holds even when the server is called directly.
 */
export const requireAppAccess = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { data, error } = await context.supabase.rpc("has_app_access", { _user: context.userId });
    if (error || !data) throw new Response("Forbidden: waiting list", { status: 403 });
    return next();
  });

const FEATURE_NAME: Record<Feature, string> = {
  exports: "Exports", alerts: "Alerts", deep_mode: "Deep mode", browser: "Cloud browsers",
  web_research: "Web research", scheduled_briefs: "Scheduled briefs",
};

/** Same as requireAppAccess, plus the caller's plan must include the feature (checked in the database). */
export function requireFeature(feature: Feature) {
  return createMiddleware({ type: "function" })
    .middleware([requireAppAccess])
    .server(async ({ next, context }) => {
      const { data } = await context.supabase.rpc("require_feature", { _feature: feature });
      if (!data) throw new Error(`${FEATURE_NAME[feature]} ${feature === "exports" || feature === "alerts" ? "needs the Research or Pro plan" : "needs the Pro plan"} — upgrade on the Billing page.`);
      return next();
    });
}
