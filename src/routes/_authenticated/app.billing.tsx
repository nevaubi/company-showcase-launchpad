import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LIMITS, PRICES, TIER_LABEL, trialDaysLeft, type Tier } from "@/lib/billing/plans";

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
      const [tier, wl, usage] = await Promise.all([
        supabase.rpc("effective_tier", { _user: uid }),
        supabase.from("waitlist").select("decided_at, created_at, status").eq("user_id", uid).maybeSingle(),
        supabase.from("usage_counters").select("kind, period, used").eq("user_id", uid).in("period", [day, month]),
      ]);
      const used = (k: string, p: string) => usage.data?.find((r) => r.kind === k && r.period === p)?.used ?? 0;
      const approved = wl.data?.status === "approved" ? new Date(wl.data.decided_at ?? wl.data.created_at) : null;
      return { tier: (tier.data ?? "none") as Tier, approved, agent: used("agent", day), report: used("report", month) };
    },
  });
  const d = q.data;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Account" title="Billing and plan" description="Your plan, trial and AI usage. Reading company data is unlimited on every plan." />
      {d && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Panel title="Your plan" className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-display text-xl">{TIER_LABEL[d.tier]}</span>
              {d.tier === "trial" && d.approved && <Badge variant="secondary">{trialDaysLeft(d.approved, new Date())} days left</Badge>}
            </div>
            {d.tier === "expired" && <p className="mt-2 text-sm text-muted-foreground">Your trial has ended. Your saved work is kept; AI tools and exports are locked until you subscribe.</p>}
          </Panel>
          <Panel title="Usage" className="min-w-0">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt>Assistant questions today</dt><dd className="tabular-nums">{d.agent} / {LIMITS[d.tier].agent}</dd></div>
              <div className="flex justify-between"><dt>Custom AI reports this month</dt><dd className="tabular-nums">{d.report} / {LIMITS[d.tier].report}</dd></div>
            </dl>
          </Panel>
          {(["research", "pro"] as const).map((t) => (
            <Panel key={t} title={TIER_LABEL[t]} className="min-w-0">
              <p className="font-display text-2xl">${PRICES[t].monthly}<span className="text-sm text-muted-foreground">/mo</span></p>
              <p className="text-xs text-muted-foreground">or ${PRICES[t].yearly}/yr (two months free)</p>
              <ul className="mt-3 space-y-1 text-sm">
                <li>{LIMITS[t].agent} assistant questions a day</li>
                <li>{LIMITS[t].report} custom AI reports a month</li>
                <li>Excel and Word exports</li>
                {t === "pro" ? <li>Deep mode, web research, cloud browsers, scheduled briefs</li> : <li>Basic alerts</li>}
              </ul>
              <Button className="mt-4 w-full" disabled>Checkout coming soon</Button>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
