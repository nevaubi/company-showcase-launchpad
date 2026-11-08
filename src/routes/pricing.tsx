import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Loader2 } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { Button } from "@/components/ui/button";
import { useDemoSignIn } from "@/hooks/use-demo-sign-in";
import { cn } from "@/lib/utils";
import { LIMITS, PRICES } from "@/lib/billing/plans";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Filed Under" },
      {
        name: "description",
        content: "14-day free trial, then Research ($39/mo) or Pro ($129/mo). Source-linked US equity research with an AI research agent.",
      },
      { property: "og:title", content: "Pricing — Filed Under" },
      { property: "og:description", content: "14-day free trial, then Research or Pro. Every number links to its SEC source." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Pricing,
});

const PLANS = [
  {
    name: "Free trial",
    price: "$0",
    cadence: "for 14 days",
    blurb: "Everything to evaluate the platform once you're off the waiting list.",
    cta: "Join the waiting list",
    features: [
      "Every covered company: financials, filings, IR data, valuation",
      "Click-to-source on every value",
      `${LIMITS.trial.agent} research-agent questions a day`,
      `${LIMITS.trial.report} custom AI reports`,
      "Read-only after 14 days — your saved work stays",
    ],
  },
  {
    name: "Research",
    price: `$${PRICES.research.monthly}`,
    cadence: `per month · $${PRICES.research.yearly}/yr`,
    blurb: "For investors who read and verify.",
    cta: "Start with a free trial",
    features: [
      "Everything in the trial, without the time limit",
      "Unlimited report library",
      "Excel and Word exports",
      `${LIMITS.research.agent} research-agent questions a day`,
      `${LIMITS.research.report} custom AI reports a month`,
      "Basic alerts",
    ],
  },
  {
    name: "Pro",
    price: `$${PRICES.pro.monthly}`,
    cadence: `per month · $${PRICES.pro.yearly.toLocaleString()}/yr`,
    blurb: "For analysts who want the work done for them.",
    cta: "Start with a free trial",
    featured: true,
    features: [
      "Everything in Research",
      `${LIMITS.pro.agent} research-agent questions a day, deep mode`,
      `${LIMITS.pro.report} custom AI reports a month`,
      "Web research and cloud browsers in the agent",
      "Scheduled AI briefs and digests",
    ],
  },
];

function Pricing() {
  const demo = useDemoSignIn();
  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 pb-24 pt-16">
        <div className="max-w-2xl">
          <p className="eyebrow">Pricing</p>
          <h1 className="mt-4 font-display text-6xl leading-[1]">Pay for depth, not for the data.</h1>
          <p className="mt-5 text-muted-foreground">
            The filings are public. What you pay for is the work of turning them into tables you can trust — and the tools to
            reason over them.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-3">
          {PLANS.map((p) => (
            <section
              key={p.name}
              className={cn(
                "flex flex-col rounded-2xl border bg-card p-8 shadow-paper",
                p.featured && "border-foreground/30 shadow-lift ring-1 ring-foreground/10",
              )}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{p.name}</h2>
                {p.featured && <span className="rounded bg-highlight px-2 py-0.5 text-[11px] font-medium text-highlight-foreground">Most popular</span>}
              </div>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="num text-5xl font-medium tracking-tight">{p.price}</span>
                <span className="text-sm text-muted-foreground">{p.cadence}</span>
              </p>
              <p className="mt-3 text-sm text-muted-foreground">{p.blurb}</p>
              <ul className="mt-8 flex-1 space-y-3 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-8" variant={p.featured ? "default" : "outline"} size="lg">
                <Link to="/auth" search={{ mode: "signup" }}>
                  {p.cta}
                </Link>
              </Button>
            </section>
          ))}
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card px-6 py-5">
          <p className="text-sm">
            <span className="font-medium">Not sure yet?</span>{" "}
            <span className="text-muted-foreground">Open the shared demo workspace — no signup.</span>
          </p>
          <Button variant="highlight" onClick={() => demo.signIn()} disabled={demo.pending}>
            {demo.pending && <Loader2 className="animate-spin" />} Open the demo
          </Button>
        </div>
        <section className="mt-24 grid grid-cols-1 gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <h2 className="font-display text-4xl">Questions</h2>
          <dl className="divide-y border-y">
            {[
              ["Where does the data come from?", "SEC EDGAR (XBRL company facts, inline-XBRL filings, Form 4, 8-K), Yahoo Finance for prices and FRED for macro. Every financial value carries its accession number."],
              ["How are quarterly cash flows calculated?", "10-Qs report cash flow year-to-date. We derive each discrete quarter by subtracting the prior year-to-date figure, and the source panel shows both parts."],
              ["Is this investment advice?", "No. Filed Under is a research tool. Verify anything important in the source document — that's what the panel is for."],
              ["Can I cancel anytime?", "Yes. Cancel from the Billing page; your plan keeps working until the end of the period you paid for."],
            ].map(([q, a]) => (
              <div key={q} className="py-5">
                <dt className="font-medium">{q}</dt>
                <dd className="mt-2 text-sm text-muted-foreground">{a}</dd>
              </div>
            ))}
          </dl>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
