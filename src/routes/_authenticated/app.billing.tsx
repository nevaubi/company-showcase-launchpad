import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LIMITS, PRICES, TIER_LABEL, trialDaysLeft, type Tier } from "@/lib/billing/plans";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { EmbeddedCheckout, EmbeddedCheckoutProvider } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createCheckoutSession, createPortalSession } from "@/lib/payments.functions";

function Checkout({ priceId }: { priceId: string }) {
  const create = useServerFn(createCheckoutSession);
  const fetchClientSecret = async () => {
    const r = await create({
      data: { priceId: priceId as never, returnUrl: `${window.location.origin}/app/billing?checkout=done`, environment: getStripeEnvironment() },
    });
    if ("error" in r) throw new Error(r.error);
    return r.clientSecret;
  };
  return (
    <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
      <EmbeddedCheckout />
    </EmbeddedCheckoutProvider>
  );
}

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
  const [yearly, setYearly] = useState(false);
  const [priceId, setPriceId] = useState<string | null>(null);
  const portal = useServerFn(createPortalSession);
  const testMode = (import.meta.env.VITE_PAYMENTS_CLIENT_TOKEN as string | undefined)?.startsWith("pk_test_");
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
      {testMode && <p className="mb-3 rounded-md border bg-muted px-3 py-2 text-center text-xs text-muted-foreground">Payments in the preview are in test mode — use card 4242 4242 4242 4242.</p>}
      <PageHeader
        eyebrow="Account"
        title="Billing and plan"
        description="Your plan, trial and AI usage. Reading company data is unlimited on every plan."
        actions={
          <>
            <div className="flex items-center gap-2 text-sm"><span>Monthly</span><Switch checked={yearly} onCheckedChange={setYearly} aria-label="Yearly billing" /><span>Yearly</span></div>
            {d?.sub && <Button variant="outline" onClick={openPortal}>Manage billing</Button>}
          </>
        }
      />
      <Dialog open={!!priceId} onOpenChange={(o) => !o && setPriceId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogTitle>Checkout</DialogTitle>
          {priceId && <Checkout priceId={priceId} />}
        </DialogContent>
      </Dialog>
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
              <Button className="mt-4 w-full" disabled={d.tier === t} onClick={() => setPriceId(`${t}_${yearly ? "yearly" : "monthly"}`)}>
                {d.tier === t ? "Current plan" : `Subscribe ${yearly ? "yearly" : "monthly"}`}
              </Button>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
