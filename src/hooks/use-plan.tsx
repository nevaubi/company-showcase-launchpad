import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { canUse, trialDaysLeft, type Feature, type Tier } from "@/lib/billing/plans";

export interface PlanInfo {
  tier: Tier;
  approvedAt: Date | null;
  sub: { status: string; current_period_end: string | null; cancel_at_period_end: boolean; tier: string } | null;
}

export const planQuery = {
  queryKey: ["billing", "plan"],
  staleTime: 60_000,
  queryFn: async (): Promise<PlanInfo> => {
    const { data: u } = await supabase.auth.getUser();
    const uid = u.user?.id;
    if (!uid) return { tier: "none", approvedAt: null, sub: null };
    const [tier, wl, sub] = await Promise.all([
      supabase.rpc("effective_tier", { _user: uid }),
      supabase.from("waitlist").select("decided_at, created_at, status").eq("user_id", uid).maybeSingle(),
      supabase.from("subscriptions").select("status, current_period_end, cancel_at_period_end, tier").eq("user_id", uid).maybeSingle(),
    ]);
    const approvedAt = wl.data?.status === "approved" ? new Date(wl.data.decided_at ?? wl.data.created_at) : null;
    return { tier: (tier.data ?? "none") as Tier, approvedAt, sub: sub.data ?? null };
  },
};

export function usePlan() {
  return useQuery(planQuery);
}

/** Returns a guard: call it before a plan-gated action; false means it showed an upgrade prompt. */
export function useFeatureGate() {
  const { data } = usePlan();
  const navigate = useNavigate();
  return (feature: Feature): boolean => {
    if (data && canUse(data.tier, feature)) return true;
    const need = feature === "exports" || feature === "alerts" ? "Research or Pro" : "Pro";
    toast(`This needs the ${need} plan`, {
      description: data?.tier === "expired" ? "Your free trial has ended." : "Upgrade to unlock it.",
      action: { label: "See plans", onClick: () => navigate({ to: "/app/billing" }) },
    });
    return false;
  };
}

/** Trial countdown (last 5 days) and trial-ended notice, shown above every app page. */
export function TrialBanner() {
  const { data } = usePlan();
  if (!data) return null;
  let text: string | null = null;
  if (data.tier === "trial" && data.approvedAt) {
    const left = trialDaysLeft(data.approvedAt, new Date());
    if (left <= 5) text = `Your free trial ends in ${left} day${left === 1 ? "" : "s"}.`;
  } else if (data.tier === "expired") {
    text = "Your free trial has ended — you can still browse, but AI tools and exports are locked.";
  } else if (data.sub?.status === "past_due") {
    text = "Your last payment failed. Update your card to keep your plan.";
  }
  if (!text) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted px-3 py-2 text-sm" data-agent-ignore>
      <span>{text}</span>
      <Link to="/app/billing" className="font-medium underline underline-offset-2">See plans</Link>
    </div>
  );
}
