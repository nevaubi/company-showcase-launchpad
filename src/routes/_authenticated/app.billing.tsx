import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LIMITS, TIER_LABEL, trialDaysLeft, type Tier } from "@/lib/billing/plans";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getStripeEnvironment } from "@/lib/stripe";
import { createPortalSession } from "@/lib/payments.functions";

export const Route = createFileRoute("/_authenticated/app/billing")({
  head: () => ({
    meta: [
      { title: "Billing and plan — Filed Under" },
      { name: "description", content: "Your Filed Under plan, trial and AI usage." },
      { property: "og:title", content: "Billing and plan — Filed Under" },
      { property: "og:description", content: "Your Filed Under plan, trial and AI usage." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BillingPage,
});

function BillingPage() {
  const q = useQuery({
    queryKey: ["billing", "me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      const uid = u.user!.id;
      const day = new Date().toISOString().slice(0, 10);
      const month = day.slice(0, 7);
      const [tier, wl, usage, sub] = await Promise.all([
        supabase.rpc("effective_tier", { _user: uid }),
        supabase.from("waitlist").select("decided_at, created_at, status").eq("user_id", uid).maybeSingle(),
        supabase.from("usage_counters").select("kind, period, used").eq("user_id", uid).in("period", [day, month]),
        supabase.from("subscriptions").select("status, current_period_end, cancel_at_period_end").eq("user_id", uid).maybeSingle(),
      ]);
      const used = (k: string, p: string) => usage.data?.find((r) => r.kind === k && r.period === p)?.used ?? 0;
      const approved = wl.data?.status === "approved" ? new Date(wl.data.decided_at ?? wl.data.created_at) : null;
      return { tier: (tier.data ?? "none") as Tier, approved, agent: used("agent", day), report: used("report", month), sub: sub.data };
    },
  });
  const d = q.data;
  const qc = useQueryClient();
  // Back from checkout: the webhook lands within seconds, so poll the plan briefly.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("checkout")) return;
    toast.success("Payment received — activating your plan…");
    let n = 0;
    const t = setInterval(() => {
      n++;
      qc.invalidateQueries({ queryKey: ["billing"] });
      if (n >= 6) clearInterval(t);
    }, 3000);
    window.history.replaceState(null, "", "/app/billing");
    return () => clearInterval(t);
  }, [qc]);
  const portal = useServerFn(createPortalSession);
  const openPortal = async () => {
    try {
      const r = await portal({ data: { returnUrl: window.location.href, environment: getStripeEnvironment() } });
      if ("error" in r) throw new Error(r.error);
      window.open(r.url, "_blank");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        eyebrow="Account"
        title="Billing and plan"
        description="Your plan, trial and AI usage. Reading company data is unlimited on every plan."
        actions={d?.sub ? <Button variant="outline" onClick={openPortal}>Manage billing</Button> : undefined}
      />
      {d && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="Your plan" className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-xl">{TIER_LABEL[d.tier]}</span>
              {d.tier === "trial" && d.approved && <Badge variant="secondary">{trialDaysLeft(d.approved, new Date())} days left</Badge>}
            </div>
            {d.sub && d.sub.current_period_end && (d.tier === "research" || d.tier === "pro") && (
              <p className="mt-2 text-sm text-muted-foreground">
                {d.sub.cancel_at_period_end || d.sub.status === "canceled" ? "Ends on " : "Renews on "}
                {new Date(d.sub.current_period_end).toLocaleDateString()}
              </p>
            )}
            {d.sub?.status === "past_due" && <p className="mt-2 text-sm text-destructive">Your last payment failed. Use Manage billing to update your card.</p>}
            {d.tier === "expired" && <p className="mt-2 text-sm text-muted-foreground">Your trial has ended. Your saved work is kept; AI tools and exports are locked until your access is renewed.</p>}
          </Panel>
          <Panel title="Usage" className="min-w-0">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt>Assistant questions today</dt><dd className="tabular-nums">{d.agent} / {LIMITS[d.tier].agent}</dd></div>
              <div className="flex justify-between"><dt>Custom AI reports this month</dt><dd className="tabular-nums">{d.report} / {LIMITS[d.tier].report}</dd></div>
            </dl>
          </Panel>
          <Panel title="Access & pricing" className="min-w-0 md:col-span-2">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="font-medium">Approved trial</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Access is granted by approval. Request a trial and we'll review it — your trial starts when you accept.
                </p>
                <Button className="mt-3" asChild>
                  <Link to="/auth">Request a trial</Link>
                </Button>
              </div>
              <div>
                <p className="font-medium">Custom pricing</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  For teams, wealth managers and institutions we put together custom pricing. Tell us what you need.
                </p>
                <Button className="mt-3" variant="outline" asChild>
                  <a href="mailto:admin@filedunder.ai?subject=Filed%20Under%20pricing">Contact us</a>
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      )}
    </div>
  );
}
