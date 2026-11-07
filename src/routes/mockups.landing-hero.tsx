import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export const Route = createFileRoute("/mockups/landing-hero")({
  head: () => ({
    meta: [
      { title: "Landing hero mockups · Filed Under" },
      { name: "description", content: "Internal test page with landing hero design concepts for Filed Under." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Landing hero mockups · Filed Under" },
      { property: "og:description", content: "Internal design concepts for the Filed Under landing page." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MockupsPage,
});

type Fact = { label: string; value: string; concept: string; period: string };
type Co = { ticker: string; name: string; form: string; filed: string; accession: string; facts: Fact[] };

// Figures as reported in each company's latest annual 10-K at time of writing.
const COMPANIES: Co[] = [
  {
    ticker: "AAPL", name: "Apple Inc.", form: "10-K", filed: "2024-11-01", accession: "0000320193-24-000123",
    facts: [
      { label: "Net sales", value: "$391.0B", concept: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", period: "FY2024" },
      { label: "Net income", value: "$93.7B", concept: "us-gaap:NetIncomeLoss", period: "FY2024" },
    ],
  },
  {
    ticker: "NVDA", name: "NVIDIA Corp.", form: "10-K", filed: "2025-02-26", accession: "0001045810-25-000023",
    facts: [
      { label: "Revenue", value: "$130.5B", concept: "us-gaap:Revenues", period: "FY2025" },
      { label: "Net income", value: "$72.9B", concept: "us-gaap:NetIncomeLoss", period: "FY2025" },
    ],
  },
  {
    ticker: "MSFT", name: "Microsoft Corp.", form: "10-K", filed: "2024-07-30", accession: "0000950170-24-087843",
    facts: [
      { label: "Revenue", value: "$245.1B", concept: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax", period: "FY2024" },
      { label: "Net income", value: "$88.1B", concept: "us-gaap:NetIncomeLoss", period: "FY2024" },
    ],
  },
];

const CONCEPTS = ["Forensic terminal", "Confluence matrix", "Living desk"] as const;

function MockupsPage() {
  const [concept, setConcept] = useState<(typeof CONCEPTS)[number]>(CONCEPTS[0]);
  return (
    <div className="min-h-screen bg-paper text-foreground">
      <div className="sticky top-0 z-20 border-b border-rule bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2 text-xs">
          <span className="font-mono uppercase tracking-wider text-muted-foreground">Mockup · not live</span>
          <div className="ml-auto flex gap-1 rounded-md border border-rule p-0.5">
            {CONCEPTS.map((c) => (
              <button key={c} onClick={() => setConcept(c)}
                className={`rounded px-2.5 py-1 transition-colors ${concept === c ? "bg-ink text-ink-foreground" : "hover:bg-muted"}`}>
                {c}
              </button>
            ))}
          </div>
          <Link to="/" className="text-link underline-offset-2 hover:underline">Back to site</Link>
        </div>
      </div>
      <div key={concept} className="animate-rise">
        {concept === "Forensic terminal" && <Terminal />}
        {concept === "Confluence matrix" && <Matrix />}
        {concept === "Living desk" && <Desk />}
      </div>
    </div>
  );
}

/* ---------- Concept 1: click a number, the filing opens beside it ---------- */
function Terminal() {
  const [i, setI] = useState(0);
  const [f, setF] = useState<number | null>(null);
  const co = COMPANIES[i];
  const fact = f === null ? null : co.facts[f];
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-4 py-16 lg:grid-cols-[1.1fr_1fr]">
      <div className="min-w-0">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Equity research, filed under its source</p>
        <h1 className="mt-4 font-display text-4xl leading-[1.05] tracking-tight md:text-6xl">
          Every number <span className="hl-sweep">opens its filing.</span>
        </h1>
        <p className="mt-5 max-w-md text-muted-foreground">
          Click any figure on the right. You land on the exact SEC line it came from — accession, concept and period.
        </p>
        <div className="mt-8 flex gap-2">
          {COMPANIES.map((c, k) => (
            <button key={c.ticker} onClick={() => { setI(k); setF(null); }}
              className={`rounded-md border px-3 py-1.5 font-mono text-sm transition-all ${k === i ? "border-ink bg-ink text-ink-foreground" : "border-rule hover:border-ink"}`}>
              {c.ticker}
            </button>
          ))}
        </div>
      </div>
      <div className="min-w-0 rounded-lg border border-rule bg-card shadow-paper">
        <div className="flex items-center justify-between border-b border-rule px-4 py-2 text-xs">
          <span className="font-medium">{co.name}</span>
          <span className="font-mono text-muted-foreground">{co.form} · filed {co.filed}</span>
        </div>
        <div className="grid grid-cols-2 divide-x divide-rule">
          {co.facts.map((x, k) => (
            <button key={x.label} onClick={() => setF(k)}
              className={`group p-4 text-left transition-colors ${f === k ? "bg-highlight-soft" : "hover:bg-muted"}`}>
              <div className="text-xs text-muted-foreground">{x.label} · {x.period}</div>
              <div className="mt-1 font-mono text-2xl tabular-nums">
                <span className={f === k ? "hl-sweep" : "border-b border-dashed border-ink-muted"}>{x.value}</span>
              </div>
              <div className="mt-2 text-[11px] text-link opacity-0 transition-opacity group-hover:opacity-100">View source →</div>
            </button>
          ))}
        </div>
        <div className="border-t border-rule p-4 font-mono text-xs">
          {fact ? (
            <div key={`${i}-${f}`} className="animate-rise space-y-1.5">
              <Row k="Accession" v={co.accession} />
              <Row k="Concept" v={fact.concept} />
              <Row k="Period" v={fact.period} />
              <Row k="Value" v={fact.value} hl />
            </div>
          ) : (
            <p className="text-muted-foreground">↑ Click a number to trace it.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ k, v, hl }: { k: string; v: string; hl?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="w-20 shrink-0 text-muted-foreground">{k}</span>
      <span className={`min-w-0 break-all ${hl ? "bg-highlight px-1 text-highlight-foreground" : ""}`}>{v}</span>
    </div>
  );
}

/* ---------- Concept 2: layers of evidence light up together ---------- */
const LAYERS = ["Financials", "Insider trades", "Filing changes", "Supply chain", "Gov. contracts", "IR KPIs"];
function Matrix() {
  const [hot, setHot] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setHot((h) => (h + 1) % COMPANIES.length), 2200);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="mx-auto max-w-6xl px-4 py-16">
      <h1 className="max-w-3xl font-display text-4xl leading-[1.05] tracking-tight md:text-6xl">
        When the evidence <span className="hl-sweep">lines up</span>, you see it first.
      </h1>
      <p className="mt-5 max-w-xl text-muted-foreground">
        Six independent source layers per company. A signal only lights when it traces back to a document.
      </p>
      <div className="mt-10 overflow-x-auto rounded-lg border border-rule bg-card shadow-paper">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-rule text-xs text-muted-foreground">
              <th className="p-3 text-left font-normal">Company</th>
              {LAYERS.map((l) => <th key={l} className="p-3 text-center font-normal">{l}</th>)}
            </tr>
          </thead>
          <tbody>
            {COMPANIES.map((c, r) => (
              <tr key={c.ticker} className={`border-b border-rule last:border-0 transition-colors ${r === hot ? "bg-highlight-soft" : ""}`}>
                <td className="p-3 font-mono">{c.ticker}</td>
                {LAYERS.map((l, k) => (
                  <td key={l} className="p-3 text-center">
                    <span
                      className={`inline-block size-2.5 rounded-full transition-all duration-500 ${r === hot ? "bg-ink scale-125" : "bg-rule"}`}
                      style={{ transitionDelay: r === hot ? `${k * 90}ms` : "0ms" }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 font-mono text-[11px] text-muted-foreground">Illustrative animation — the dots are not live signals.</p>
    </section>
  );
}

/* ---------- Concept 3: the assistant works in front of you ---------- */
const STEPS = [
  "Opening NVDA 10-K (filed 2025-02-26)",
  "Reading us-gaap:Revenues for FY2025",
  "Cross-checking IR data center segment",
  "Scanning supply chain for single-source suppliers",
  "Writing cited summary",
];
function Desk() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x >= STEPS.length + 2 ? 0 : x + 1)), 900);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-16 lg:grid-cols-2">
      <div className="min-w-0">
        <h1 className="font-display text-4xl leading-[1.05] tracking-tight md:text-6xl">
          An analyst that <span className="hl-sweep">shows its work.</span>
        </h1>
        <p className="mt-5 max-w-md text-muted-foreground">
          Ask anything. Watch it open filings, check numbers and cite every line it writes.
        </p>
        <div className="mt-8 inline-flex items-center gap-2 rounded-md border border-rule px-3 py-2 text-sm">
          <kbd className="rounded border border-rule px-1.5 font-mono text-xs">⌘J</kbd> Ask the assistant
        </div>
      </div>
      <div className="min-w-0 rounded-lg border border-rule bg-card p-4 shadow-panel">
        <div className="rounded-md bg-muted px-3 py-2 text-sm">How dependent is NVIDIA on a single supplier?</div>
        <ol className="mt-4 space-y-2">
          {STEPS.map((s, k) => (
            <li key={s} className={`flex items-center gap-2 text-sm transition-opacity duration-300 ${k < n ? "opacity-100" : "opacity-0"}`}>
              <span className={`size-1.5 rounded-full ${k === n - 1 ? "bg-highlight animate-pulse-dot" : "bg-positive"}`} />
              <span className={k === n - 1 ? "text-shimmer" : "text-muted-foreground"}>{s}</span>
            </li>
          ))}
        </ol>
        <div className={`mt-4 border-t border-rule pt-3 text-sm transition-opacity duration-500 ${n > STEPS.length ? "opacity-100" : "opacity-0"}`}>
          NVIDIA reported <span className="bg-highlight px-1 text-highlight-foreground">$130.5B</span> of FY2025 revenue
          <sup className="ml-0.5 font-mono text-link">[1]</sup> and names a single foundry partner for its wafers.
          <sup className="ml-0.5 font-mono text-link">[2]</sup>
        </div>
      </div>
    </section>
  );
}
