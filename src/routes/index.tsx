import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BookOpenText,
  Bot,
  Database,
  FileSearch,
  FileSpreadsheet,
  Globe2,
  LineChart,
  Loader2,
  Sigma,
  UserRoundSearch,
} from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { AttributionDemo } from "@/components/site/attribution-demo";
import { Button } from "@/components/ui/button";
import { useDemoSignIn } from "@/hooks/use-demo-sign-in";
import { CompanyLogo } from "@/components/app/company-logo";
import { fmtCompactUsd, fmtPct } from "@/lib/format";
import type { Universe } from "@/lib/financials/types";
import { COVERAGE } from "@/lib/coverage";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Filed Under — every number, filed under its source" },
      {
        name: "description",
        content:
          "Equity research where every figure opens the SEC filing it came from, scrolled to the line and highlighted. Financials, filings, technicals, macro and an AI research agent.",
      },
      { property: "og:title", content: "Filed Under — every number, filed under its source" },
      {
        property: "og:description",
        content: "Source-linked financials, filings, technicals and macro for US equities, with one-click attribution to the original document.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Filed Under — every number, filed under its source" },
      { name: "twitter:description", content: "Source-linked equity research on SEC EDGAR, Yahoo Finance and FRED." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const demo = useDemoSignIn();
  return (
    <div className="paper-grain min-h-screen">
      <SiteHeader />
      <main>
        <Hero onDemo={() => demo.signIn()} pending={demo.pending} />
        <CoverageBand />
        <HowItWorks />
        <Product />
        <Sources />
        <Manifesto />
        <ClosingCta onDemo={() => demo.signIn()} pending={demo.pending} />
      </main>
      <SiteFooter />
    </div>
  );
}

function Hero({ onDemo, pending }: { onDemo: () => void; pending: boolean }) {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 pb-20 pt-14 lg:pt-20">
        <div className="grid grid-cols-1 items-end gap-10 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="animate-rise">
            <p className="eyebrow">US equity research · with receipts</p>
            <h1 className="mt-5 font-display text-[3.4rem] leading-[0.96] tracking-[-0.015em] sm:text-[4.8rem] xl:text-[5.6rem]">
              Every number, <span className="hl-sweep italic">filed under</span> its source.
            </h1>
          </div>
          <div className="animate-rise [animation-delay:80ms]">
            <p className="max-w-lg text-[1.0625rem] leading-relaxed text-muted-foreground">
              Filed Under rebuilds company financials straight from SEC filings. Click any figure — in a table, a chart or an
              AI answer — and the original 10-K or 10-Q opens beside it, scrolled to the exact line and highlighted.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button size="lg" variant="highlight" onClick={onDemo} disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : null}
                Open the live demo <ArrowRight />
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/auth" search={{ mode: "signup" }}>
                  Create a free account
                </Link>
              </Button>
            </div>
          </div>
        </div>
        <div className="mt-14 animate-rise [animation-delay:150ms]">
          <AttributionDemo />
        </div>
        <dl className="mt-10 grid grid-cols-2 gap-6 border-t pt-6 sm:grid-cols-4">
          {[
            ["23,000+", "SEC filings indexed across 25 companies"],
            ["19 years", "of XBRL statement history"],
            ["2,170", "Form 4 insider transactions parsed"],
            ["35", "FRED macro series"],
          ].map(([k, v]) => (
            <div key={v}>
              <dt className="num text-xl font-medium">{k}</dt>
              <dd className="mt-1 text-xs text-muted-foreground">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function CoverageBand() {
  const q = useQuery({
    queryKey: ["universe"],
    queryFn: async () => (await (await fetch("/data/universe.json")).json()) as Universe,
    staleTime: Infinity,
  });
  const byTicker = new Map((q.data?.companies ?? []).map((c) => [c.ticker, c]));
  return (
    <section className="border-y bg-card/70">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="eyebrow">Now covering</p>
          <p className="text-xs text-muted-foreground">Trailing-twelve-month revenue, from 10-Q and 10-K filings</p>
        </div>
        <ul className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-6">
          {COVERAGE.map((c) => {
            const u = byTicker.get(c.ticker);
            return (
              <li key={c.ticker} className="flex items-center gap-3 bg-card px-4 py-4">
                <CompanyLogo ticker={c.ticker} src={u?.logo} size="sm" />
                <div className="min-w-0">
                  <p className="num text-sm font-semibold">{c.ticker}</p>
                  <p className="num text-xs text-muted-foreground">
                    {u?.revenueTTM ? fmtCompactUsd(u.revenueTTM) : "—"}
                    {u?.revenueGrowthYoY != null && (
                      <span className={cn("ml-1.5", u.revenueGrowthYoY >= 0 ? "text-positive" : "text-negative")}>
                        {fmtPct(u.revenueGrowthYoY, 0, true)}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: "01",
      title: "Pull the primary record",
      body: "XBRL company facts, inline-XBRL filings, Form 4 insider reports and 8-K earnings releases come straight from EDGAR. Prices from Yahoo Finance, macro from FRED.",
    },
    {
      n: "02",
      title: "Rebuild the statements",
      body: "Income, balance sheet and cash flow, annual and quarterly, back to 2007. Missing fourth quarters are derived — and the formula shows its parts.",
    },
    {
      n: "03",
      title: "Click to the line",
      body: "Every cell carries its accession number, XBRL concept and period. A panel opens the filing and highlights the exact tagged fact.",
    },
  ];
  return (
    <section id="product" className="mx-auto max-w-7xl scroll-mt-20 px-6 py-24">
      <div className="max-w-2xl">
        <p className="eyebrow">How it works</p>
        <h2 className="mt-4 font-display text-5xl leading-[1.02]">Research you can audit in one click.</h2>
      </div>
      <ol className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border md:grid-cols-3">
        {steps.map((s) => (
          <li key={s.n} className="bg-card p-8">
            <p className="num text-sm text-muted-foreground">{s.n}</p>
            <h3 className="mt-6 text-xl font-semibold">{s.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Product() {
  const features = [
    {
      icon: Sigma,
      title: "Wide financial tables",
      body: "Seventy line items across statements and KPIs, annual and quarterly, with margins, growth and returns computed from cited parts.",
      span: "lg:col-span-2",
      visual: <MiniTable />,
    },
    {
      icon: LineChart,
      title: "Technicals",
      body: "Daily and intraday bars, moving averages, RSI, MACD and Bollinger bands, benchmark-relative strength and earnings-day reactions.",
      visual: <MiniChart />,
    },
    {
      icon: Globe2,
      title: "Macro, from the source",
      body: "Rates, inflation, labor, liquidity and credit from FRED, with the Treasury curve against a year ago.",
    },
    {
      icon: Bot,
      title: "A research agent that shows its work",
      body: "Ask a question; watch it call SEC, price and macro tools in a loop, compute, and answer with citations you can open.",
    },
    {
      icon: UserRoundSearch,
      title: "Insider trade following",
      body: "Form 4 transactions parsed from XML — who sold, at what price, under which 10b5-1 plan.",
    },
    {
      icon: BookOpenText,
      title: "Theses that keep score",
      body: "Write a long or short case, log catalysts and updates, and track it against the price since you filed it.",
    },
    {
      icon: FileSpreadsheet,
      title: "Docs and sheets with an AI pane",
      body: "Draft notes and build models in-browser; the assistant edits with you and pulls cited data on request.",
      span: "lg:col-span-2",
    },
  ];
  return (
    <section className="border-t bg-secondary/40">
      <div className="mx-auto max-w-7xl px-6 py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <p className="eyebrow">The workspace</p>
            <h2 className="mt-4 font-display text-5xl leading-[1.02]">One desk for filings, prices and ideas.</h2>
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Built for analysts who'd rather check the footnote than trust the screen.
          </p>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <article key={f.title} className={cn("flex flex-col rounded-xl border bg-card p-6 shadow-paper", f.span)}>
              <f.icon className="size-5" />
              <h3 className="mt-5 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              {f.visual && <div className="mt-6 flex-1">{f.visual}</div>}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function MiniTable() {
  const rows = [
    ["Revenue", "57,006", "68,127", "81,615", "96,221"],
    ["Gross margin", "73.4%", "75.0%", "74.9%", "75.0%"],
    ["Operating income", "36,010", "44,299", "53,536", "63,734"],
    ["Free cash flow", "22,115", "34,904", "48,587", "21,400"],
  ];
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between border-b bg-secondary/60 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>NVDA · quarterly · $M</span>
        <span className="num">Q3 FY26 → Q2 FY27</span>
      </div>
      <table className="num w-full text-[12px]">
        <tbody>
          {rows.map(([k, ...v], i) => (
            <tr key={k} className="border-b last:border-0">
              <td className="px-3 py-1.5 font-sans">{k}</td>
              {v.map((x, j) => (
                <td key={j} className="px-3 py-1.5 text-right">
                  <span className={cn(i === 0 && j === 3 && "rounded-sm bg-highlight px-1")}>{x}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MiniChart() {
  const pts = [32, 35, 33, 38, 41, 39, 44, 47, 45, 52, 50, 55, 58, 54, 60, 63];
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${(i / (pts.length - 1)) * 100},${40 - ((p - min) / (max - min)) * 34 - 3}`).join("");
  return (
    <svg viewBox="0 0 100 40" className="h-24 w-full text-chart-1" preserveAspectRatio="none" aria-hidden>
      <path d={`${d}L100,40L0,40Z`} fill="currentColor" opacity={0.08} />
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <line x1="0" x2="100" y1="22" y2="22" className="text-chart-2" stroke="currentColor" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Sources() {
  const sources = [
    { icon: Database, name: "SEC EDGAR XBRL", note: "Company facts API — every tagged value with accession and period" },
    { icon: FileSearch, name: "Inline XBRL documents", note: "10-K / 10-Q HTML with segment facts located by element ID" },
    { icon: UserRoundSearch, name: "Form 4 XML", note: "Insider transactions, codes, prices and post-trade holdings" },
    { icon: FileText2, name: "8-K Item 2.02", note: "Earnings press releases (Exhibit 99.1)" },
    { icon: LineChart, name: "Yahoo Finance", note: "Daily and intraday bars for stocks, indices and sector ETFs" },
    { icon: Globe2, name: "FRED (St. Louis Fed)", note: "Rates, inflation, labor, liquidity, credit, recessions" },
  ];
  return (
    <section id="sources" className="mx-auto max-w-7xl scroll-mt-20 px-6 py-24">
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="eyebrow">Sources</p>
          <h2 className="mt-4 font-display text-5xl leading-[1.02]">Authoritative, public, and cited.</h2>
          <p className="mt-5 max-w-md text-muted-foreground">
            No black-box data vendor in the middle. If a number can't be traced to a document, it doesn't make the table.
          </p>
        </div>
        <ul className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2">
          {sources.map((s) => (
            <li key={s.name} className="bg-card p-5">
              <s.icon className="size-4" />
              <p className="mt-3 font-medium">{s.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.note}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function FileText2(props: { className?: string }) {
  return <FileSearch {...props} />;
}

function Manifesto() {
  return (
    <section className="relative overflow-hidden bg-ink text-ink-foreground">
      <div className="ruled pointer-events-none absolute inset-0 opacity-[0.05]" />
      <div className="relative mx-auto max-w-5xl px-6 py-24 text-center">
        <p className="eyebrow !text-ink-muted">Our standard</p>
        <p className="mt-6 font-display text-[2.6rem] leading-[1.1] sm:text-6xl">
          Research is only as good as its <em className="text-highlight">footnotes</em>.
        </p>
        <p className="mx-auto mt-6 max-w-xl text-ink-muted">
          So we made the footnote the interface: the accession number, the XBRL tag, the period, and the page — one click
          from every figure.
        </p>
      </div>
    </section>
  );
}

function ClosingCta({ onDemo, pending }: { onDemo: () => void; pending: boolean }) {
  return (
    <section className="mx-auto max-w-7xl px-6 py-24">
      <div className="flex flex-col items-start justify-between gap-8 rounded-2xl border bg-card p-10 shadow-paper md:flex-row md:items-center">
        <div>
          <h2 className="font-display text-4xl">See it on real filings.</h2>
          <p className="mt-2 text-muted-foreground">The demo workspace covers 25 large US companies across tech, banks, healthcare, energy and retail, sample theses and the research agent.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button size="lg" variant="highlight" onClick={onDemo} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />} Open the live demo
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link to="/pricing">See plans</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
