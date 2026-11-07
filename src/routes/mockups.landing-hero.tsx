import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

export const Route = createFileRoute("/mockups/landing-hero")({
  head: () => ({
    meta: [
      { title: "Landing hero mockup · Filed Under" },
      { name: "description", content: "Internal test page: editorial, scroll-driven landing hero concept for Filed Under." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Landing hero mockup · Filed Under" },
      { property: "og:description", content: "Internal editorial hero concept for the Filed Under landing page." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..800;1,6..72,300..800&display=swap",
      },
    ],
  }),
  component: Mockup,
});

const SERIF = { fontFamily: "'Newsreader', Georgia, serif" } as const;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
/** progress of p inside [a,b] → 0..1 */
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

// Illustrative figures for the mockup (FY2024 Apple 10-K); verify before production use.
const ROWS = [
  { t: "AAPL", n: "Apple", rev: "391.0", ni: "93.7", chg: "+2.0%" },
  { t: "MSFT", n: "Microsoft", rev: "245.1", ni: "88.1", chg: "+15.7%" },
  { t: "NVDA", n: "NVIDIA", rev: "130.5", ni: "72.9", chg: "+114%" },
  { t: "AMZN", n: "Amazon", rev: "638.0", ni: "59.2", chg: "+11.0%" },
  { t: "JPM", n: "JPMorgan", rev: "180.6", ni: "58.5", chg: "+12.0%" },
  { t: "GOOGL", n: "Alphabet", rev: "350.0", ni: "100.1", chg: "+13.9%" },
];
const TAPE = ["AAPL 10-K", "NVDA 8-K EX-99.1", "JPM FORM 4", "MSFT 10-Q", "TSLA 13G/A", "AMZN DEF 14A", "LMT USASPENDING", "PFE CLINICALTRIALS", "GE IR DECK p.14", "COST 10-Q"];

function useScrollProgress<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setP(clamp(-r.top / (r.height - window.innerHeight)));
      });
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); };
  }, []);
  return [ref, p] as const;
}

function Mockup() {
  const [ref, p] = useScrollProgress<HTMLDivElement>();

  // Scene timings
  const s1 = ease(seg(p, 0.0, 0.18));   // headline settles, page recedes
  const s2 = ease(seg(p, 0.18, 0.4));  // camera pushes into the AAPL revenue cell
  const s3 = ease(seg(p, 0.4, 0.62));  // filing slides in, highlighter sweeps
  const s4 = ease(seg(p, 0.62, 0.82)); // pull back: the stack of source layers
  const s5 = ease(seg(p, 0.85, 1));    // close + CTA

  const zoom = 1 + s2 * 1.4 - s3 * 0.5 - s4 * 0.9;
  const pageFade = 1 - s2 * 0.9;

  return (
    <div className="bg-paper text-foreground">
      {/* Masthead */}
      <header className="border-b-2 border-ink">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span>Saturday, 7 November 2026</span>
          <span className="hidden sm:inline">Mockup · not the live site</span>
          <Link to="/" className="hover:text-foreground">Back to site</Link>
        </div>
        <div className="mx-auto max-w-7xl border-t border-rule px-6 py-3 text-center">
          <div style={SERIF} className="text-4xl font-semibold tracking-tight md:text-5xl">Filed Under</div>
        </div>
        <Tape />
      </header>

      {/* Cinematic scroll stage */}
      <div ref={ref} className="relative" style={{ height: "520vh" }}>
        <div className="sticky top-0 h-screen overflow-hidden">
          {/* Layer A: the broadsheet front page */}
          <div
            className="absolute inset-0 mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 pt-10 will-change-transform lg:grid-cols-[1.35fr_1fr]"
            style={{
              transform: `translateX(${-s3 * 28 + s4 * 28}%) scale(${zoom})`,
              transformOrigin: "82% 17%",
              opacity: 1 - Math.min(0.94, s4 * 2),
            }}
          >
            <div className="min-w-0" style={{ opacity: pageFade }}>
              <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-negative">Research · Provenance</div>
              <h1 style={SERIF} className="mt-3 text-5xl font-medium leading-[0.95] tracking-[-0.02em] md:text-7xl xl:text-8xl">
                <Word d={0}>Every</Word> <Word d={80}>number</Word> <Word d={160}>has</Word>{" "}
                <Word d={240}><em className="font-normal">a source.</em></Word>
              </h1>
              <p style={SERIF} className="mt-6 max-w-xl text-xl leading-snug text-muted-foreground md:text-2xl" >
                US equity research where each figure traces to the SEC filing, the agency record or the investor deck it came from.
              </p>
              <div className="mt-8 grid max-w-xl grid-cols-3 border-y border-rule font-mono text-xs">
                {[["1,844", "companies"], ["2.9M", "IR facts"], ["74K", "IR documents"]].map(([v, l]) => (
                  <div key={l} className="border-r border-rule py-3 pr-3 last:border-0 [&:not(:first-child)]:pl-3">
                    <div className="text-xl tabular-nums text-foreground">{v}</div>
                    <div className="uppercase tracking-wider text-muted-foreground">{l}</div>
                  </div>
                ))}
              </div>
              <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground" style={{ opacity: 1 - s1 * 1.5 }}>
                ↓ Scroll to trace a number
              </div>
            </div>

            {/* Data table — the "camera" pushes into AAPL revenue */}
            <div className="min-w-0 border-t-2 border-ink pt-2">
              <div className="flex items-baseline justify-between">
                <span style={SERIF} className="text-lg font-semibold">Annual results</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">$bn · latest FY</span>
              </div>
              <table className="mt-2 w-full font-mono text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-ink text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-1.5 text-left font-normal">Co.</th>
                    <th className="py-1.5 text-right font-normal">Revenue</th>
                    <th className="py-1.5 text-right font-normal">Net inc.</th>
                    <th className="py-1.5 text-right font-normal">YoY</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r, i) => {
                    const target = i === 0;
                    return (
                      <tr key={r.t} className="border-b border-rule" style={{ opacity: target ? 1 : 1 - s2 * 0.85 }}>
                        <td className="py-2"><span className="text-foreground">{r.t}</span> <span className="hidden text-muted-foreground xl:inline">{r.n}</span></td>
                        <td className="py-2 text-right">
                          <span className="relative inline-block px-1">
                            {target && (
                              <span aria-hidden className="absolute inset-0 origin-left bg-highlight"
                                style={{ transform: `scaleX(${s2 >= 1 ? 1 : s2 * 0.15 + s3})`, opacity: Math.min(1, s2 * 2) }} />
                            )}
                            <span className="relative">{r.rev}</span>
                          </span>
                        </td>
                        <td className="py-2 text-right">{r.ni}</td>
                        <td className={`py-2 text-right ${r.chg.startsWith("+") ? "text-positive" : "text-negative"}`}>{r.chg}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p style={SERIF} className="mt-3 text-sm italic text-muted-foreground">Click any figure on Filed Under to open its filing.</p>
            </div>
          </div>

          {/* Layer B: the filing itself, sliding in from the right */}
          <div
            className="pointer-events-none absolute inset-y-0 right-0 flex w-full items-center justify-end px-6 md:w-[58%]"
            style={{ transform: `translateX(${(1 - s3) * 110 + s4 * 110}%)`, opacity: s3 * (1 - s4) }}
          >
            <article className="w-full max-w-xl border border-ink bg-card shadow-lift">
              <div className="flex items-center justify-between border-b border-ink bg-ink px-4 py-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-foreground">
                <span>Form 10-K · Apple Inc.</span><span>Filed 2024-11-01</span>
              </div>
              <div className="p-5">
                <div style={SERIF} className="text-center text-sm font-semibold uppercase tracking-wider">Consolidated Statements of Operations</div>
                <div className="mt-1 text-center font-mono text-[10px] text-muted-foreground">(In millions, except per-share amounts)</div>
                <table className="mt-4 w-full font-mono text-[13px] tabular-nums">
                  <tbody>
                    <FilingRow l="Net sales: Products" v="294,866" />
                    <FilingRow l="Net sales: Services" v="96,169" />
                    <tr className="border-t border-ink">
                      <td className="py-1.5 font-semibold">Total net sales</td>
                      <td className="py-1.5 text-right">
                        <span className="relative inline-block px-1">
                          <span aria-hidden className="absolute inset-0 origin-left bg-highlight" style={{ transform: `scaleX(${seg(s3, 0.5, 1)})` }} />
                          <span className="relative font-semibold">391,035</span>
                        </span>
                      </td>
                    </tr>
                    <FilingRow l="Cost of sales" v="210,352" muted />
                  </tbody>
                </table>
                <dl className="mt-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 border-t border-rule pt-3 font-mono text-[11px]" style={{ opacity: seg(s3, 0.6, 1) }}>
                  <dt className="text-muted-foreground">Accession</dt><dd>0000320193-24-000123</dd>
                  <dt className="text-muted-foreground">Concept</dt><dd className="break-all">us-gaap:RevenueFromContractWith…</dd>
                  <dt className="text-muted-foreground">Period</dt><dd>FY2024 · 52 weeks to 28 Sep 2024</dd>
                </dl>
              </div>
            </article>
          </div>

          {/* Layer C: the stack of sources */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6" style={{ opacity: s4 * (1 - s5) }}>
            <div className="w-full max-w-4xl">
              <div style={SERIF} className="mb-6 text-center text-3xl font-medium md:text-5xl" >Not one source. <em className="font-normal">Eight.</em></div>
              <div className="grid grid-cols-2 border-l border-t border-ink md:grid-cols-4">
                {[
                  ["SEC XBRL", "Statements"], ["Form 4", "Insiders"], ["8-K / EX-99", "Releases"], ["IR decks", "KPIs by cell"],
                  ["10-K text", "Supply chain"], ["USAspending", "Contracts"], ["Redlines", "What changed"], ["FRED", "Macro"],
                ].map(([a, b], i) => (
                  <div key={a} className="border-b border-r border-ink bg-paper p-4"
                    style={{ transform: `translateY(${(1 - seg(s4, i * 0.06, 0.5 + i * 0.06)) * 40}px)`, opacity: seg(s4, i * 0.06, 0.5 + i * 0.06) }}>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{b}</div>
                    <div style={SERIF} className="mt-1 text-xl font-medium">{a}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Layer D: close */}
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center" style={{ opacity: s5, transform: `translateY(${(1 - s5) * 30}px)`, pointerEvents: s5 > 0.5 ? "auto" : "none" }}>
            <div>
              <div className="mx-auto mb-6 inline-block -rotate-3 border-2 border-negative px-3 py-1 font-mono text-xs uppercase tracking-[0.3em] text-negative">Filed under: verified</div>
              <h2 style={SERIF} className="text-5xl font-medium leading-[0.95] tracking-tight md:text-7xl">Read the market<br /><em className="font-normal">from the record.</em></h2>
              <div className="mt-8 flex justify-center gap-3">
                <Link to="/auth" className="bg-ink px-5 py-2.5 font-mono text-xs uppercase tracking-[0.18em] text-ink-foreground transition-opacity hover:opacity-85">Start reading</Link>
                <Link to="/pricing" className="border border-ink px-5 py-2.5 font-mono text-xs uppercase tracking-[0.18em] transition-colors hover:bg-muted">Pricing</Link>
              </div>
            </div>
          </div>

          {/* Scene progress rail */}
          <div className="absolute bottom-6 left-6 hidden font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground md:block">
            {["Front page", "The number", "The filing", "The record", "Begin"].map((l, i) => {
              const on = Math.min(4, Math.floor(p * 5)) === i;
              return <div key={l} className={`flex items-center gap-2 py-0.5 transition-colors ${on ? "text-foreground" : ""}`}>
                <span className={`h-px transition-all ${on ? "w-8 bg-ink" : "w-3 bg-rule"}`} />{String(i + 1).padStart(2, "0")} {l}
              </div>;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function Word({ children, d }: { children: React.ReactNode; d: number }) {
  return <span className="inline-block animate-rise" style={{ animationDelay: `${d}ms` }}>{children}</span>;
}

function FilingRow({ l, v, muted }: { l: string; v: string; muted?: boolean }) {
  return (
    <tr className={muted ? "text-muted-foreground" : ""}>
      <td className="py-1.5">{l}</td><td className="py-1.5 text-right">{v}</td>
    </tr>
  );
}

function Tape() {
  const items = [...TAPE, ...TAPE];
  return (
    <div className="overflow-hidden border-t border-ink bg-ink py-1.5 text-ink-foreground">
      <div className="flex w-max animate-ticker gap-8 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.15em]">
        {items.map((t, i) => (
          <span key={i} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-highlight" />{t}</span>
        ))}
      </div>
    </div>
  );
}
