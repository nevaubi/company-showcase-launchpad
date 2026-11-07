import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import chicago from "@/assets/chicago-lasalle.mp4.asset.json";

export const Route = createFileRoute("/mockups/landing-hero")({
  head: () => ({
    meta: [
      { title: "Landing hero mockup · Filed Under" },
      { name: "description", content: "Internal test page: cinematic Chicago hero and PDF-reader source demos for Filed Under." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Landing hero mockup · Filed Under" },
      { property: "og:description", content: "Internal cinematic hero concept for the Filed Under landing page." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..800;1,6..72,300..800&display=swap" },
    ],
  }),
  component: Mockup,
});

const SERIF = { fontFamily: "'Newsreader', Georgia, serif" } as const;
const TIMES = { fontFamily: "'Times New Roman', Times, serif" } as const;
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p: number, a: number, b: number) => clamp((p - a) / (b - a));
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

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
        setP(clamp(-r.top / Math.max(1, r.height - window.innerHeight)));
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
  return (
    <div className="bg-paper text-foreground">
      <Hero />
      <Reader />
      <Close />
    </div>
  );
}

/* ---------------- Hero: cinematic Chicago ---------------- */
function Hero() {
  const [ref, p] = useScrollProgress<HTMLDivElement>();
  return (
    <div ref={ref} className="relative" style={{ height: "170vh" }}>
      <section className="sticky top-0 h-screen overflow-hidden bg-ink text-ink-foreground">
        <video
          src={chicago.url} autoPlay muted loop playsInline
          className="absolute inset-0 size-full object-cover"
          style={{ transform: `scale(${1.08 + p * 0.12})`, filter: `brightness(${0.75 - p * 0.35})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-ink/70 via-ink/10 to-ink/90" />
        <div className="absolute inset-0 opacity-[0.07] mix-blend-overlay paper-grain" />

        {/* Masthead */}
        <header className="relative z-10 border-b border-ink-foreground/20">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-ink-foreground/70">
            <span>Chicago · 41.8781° N, 87.6298° W</span>
            <span style={SERIF} className="text-xl normal-case tracking-tight text-ink-foreground">Filed Under</span>
            <Link to="/" className="hover:text-ink-foreground">Back to site</Link>
          </div>
        </header>

        <div className="relative z-10 mx-auto flex h-[calc(100%-7rem)] max-w-7xl flex-col justify-end px-6 pb-16"
          style={{ transform: `translateY(${-p * 80}px)`, opacity: 1 - seg(p, 0.35, 0.8) }}>
          <div className="font-mono text-[11px] uppercase tracking-[0.25em] text-highlight animate-rise">LaSalle Street · Since 1848, prices were set here</div>
          <h1 style={SERIF} className="mt-4 max-w-5xl text-6xl font-medium leading-[0.92] tracking-[-0.02em] md:text-8xl xl:text-[9rem]">
            <Reveal d={100}>The market</Reveal>{" "}
            <Reveal d={260}><em className="font-light">reads the record.</em></Reveal>
          </h1>
          <div className="mt-8 flex flex-wrap items-end justify-between gap-6">
            <p style={SERIF} className="max-w-lg text-xl leading-snug text-ink-foreground/80 animate-rise [animation-delay:500ms]">
              Equity research where every figure opens the filing, release or investor deck it came from — down to the line.
            </p>
            <div className="flex gap-8 font-mono text-xs uppercase tracking-wider text-ink-foreground/70 animate-rise [animation-delay:700ms]">
              {[["1,844", "Companies"], ["74K", "IR documents"], ["2.9M", "Sourced facts"]].map(([v, l]) => (
                <div key={l}><div className="text-2xl tabular-nums text-ink-foreground">{v}</div>{l}</div>
              ))}
            </div>
          </div>
        </div>
        <Tape />
      </section>
    </div>
  );
}

function Reveal({ children, d }: { children: ReactNode; d: number }) {
  return (
    <span className="inline-block overflow-hidden align-bottom">
      <span className="inline-block animate-[rise_1100ms_cubic-bezier(0.2,0.7,0.2,1)_both]" style={{ animationDelay: `${d}ms` }}>{children}</span>
    </span>
  );
}

function Tape() {
  const items = [...TAPE, ...TAPE];
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 overflow-hidden border-t border-ink-foreground/20 bg-ink/60 py-2 backdrop-blur">
      <div className="flex w-max animate-ticker gap-10 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.15em] text-ink-foreground/80">
        {items.map((t, i) => <span key={i} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-highlight" />{t}</span>)}
      </div>
    </div>
  );
}

/* ---------------- PDF reader showcase ---------------- */
type Example = {
  id: string; claim: string; value: string; where: string;
  file: string; pages: number; page: number; Doc: (p: { hl: number }) => ReactNode;
};

// Illustrative mock documents, recreated for the demo.
const EXAMPLES: Example[] = [
  { id: "10k", claim: "Apple · FY2024 net sales", value: "$391.0B", where: "10-K · Item 8 · p.28", file: "aapl-20240928.pdf", pages: 121, page: 28, Doc: Doc10K },
  { id: "8k", claim: "NVIDIA · Q3 FY25 revenue", value: "$35.1B", where: "8-K · Exhibit 99.1 · p.1", file: "nvda-q3fy25-ex991.pdf", pages: 14, page: 1, Doc: DocRelease },
  { id: "f4", claim: "Insider sale · CFO", value: "12,500 sh", where: "Form 4 · Table I · p.1", file: "form4-mock.pdf", pages: 2, page: 1, Doc: DocForm4 },
];

function Reader() {
  const [ref, p] = useScrollProgress<HTMLDivElement>();
  const n = EXAMPLES.length;
  const idx = Math.min(n - 1, Math.floor(p * n));
  const local = ease(seg(p * n - idx, 0.1, 0.7));
  const ex = EXAMPLES[idx];
  return (
    <div ref={ref} className="relative" style={{ height: `${n * 110}vh` }}>
      <section className="sticky top-0 grid h-screen grid-cols-1 items-center gap-8 overflow-hidden px-6 py-10 lg:grid-cols-[0.8fr_1.4fr] mx-auto max-w-7xl">
        <div className="min-w-0">
          <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-negative">Click to source</div>
          <h2 style={SERIF} className="mt-3 text-4xl font-medium leading-[0.98] tracking-tight md:text-6xl">
            Click the number.<br /><em className="font-light">Land on the line.</em>
          </h2>
          <div className="mt-8 space-y-2">
            {EXAMPLES.map((e, i) => (
              <div key={e.id} className={`border-l-2 py-2 pl-4 transition-all duration-500 ${i === idx ? "border-ink" : "border-rule opacity-40"}`}>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{e.claim}</div>
                <div className="flex items-baseline gap-3">
                  <span className={`font-mono text-2xl tabular-nums ${i === idx ? "bg-highlight px-1 text-highlight-foreground" : ""}`}>{e.value}</span>
                  <span className="font-mono text-[11px] text-link">{e.where} →</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-6 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Illustrative mock documents</p>
        </div>

        {/* The reader */}
        <div className="min-w-0 overflow-hidden rounded-lg border border-ink/80 bg-ink shadow-lift">
          <div className="flex items-center gap-3 border-b border-ink-foreground/10 px-3 py-2 font-mono text-[11px] text-ink-foreground/80">
            <div className="flex gap-1.5"><span className="size-2.5 rounded-full bg-ink-foreground/20" /><span className="size-2.5 rounded-full bg-ink-foreground/20" /><span className="size-2.5 rounded-full bg-ink-foreground/20" /></div>
            <span className="truncate">{ex.file}</span>
            <span className="ml-auto hidden sm:inline">Page <span className="rounded bg-ink-foreground/10 px-1.5">{ex.page}</span> / {ex.pages}</span>
            <span className="hidden md:inline">− 125% +</span>
            <span className="rounded bg-highlight px-1.5 text-highlight-foreground">1 of 1</span>
          </div>
          <div className="flex h-[min(68vh,620px)]">
            <aside className="hidden w-20 shrink-0 space-y-3 overflow-hidden border-r border-ink-foreground/10 p-3 md:block">
              {[0, 1, 2, 3, 4].map((t) => (
                <div key={t} className={`aspect-[8.5/11] rounded-sm bg-paper p-1.5 ${t === 1 ? "ring-2 ring-highlight" : "opacity-50"}`}>
                  {[...Array(7)].map((_, k) => <div key={k} className="mb-1 h-0.5 bg-rule" style={{ width: `${60 + ((k * 37 + t * 11) % 40)}%` }} />)}
                </div>
              ))}
            </aside>
            <div className="relative flex-1 overflow-hidden bg-ink-muted/40 p-6">
              <div key={ex.id} className="mx-auto max-w-[560px] animate-rise bg-card px-10 py-9 text-[12.5px] leading-relaxed text-card-foreground shadow-paper"
                style={{ transform: `translateY(${-local * 40}px)`, ...TIMES }}>
                <ex.Doc hl={local} />
                <div className="mt-8 text-center text-[10px] text-muted-foreground">{ex.page}</div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Hl({ t, children }: { t: number; children: ReactNode }) {
  return (
    <span className="relative inline-block px-0.5">
      <span aria-hidden className="absolute inset-0 origin-left bg-highlight/80" style={{ transform: `scaleX(${t})` }} />
      <span className="relative">{children}</span>
      {t > 0.95 && <span className="absolute -right-2 -top-2 size-2 rounded-full bg-negative animate-pulse-dot" />}
    </span>
  );
}

function Doc10K({ hl }: { hl: number }) {
  const rows: [string, string, string, string, boolean?][] = [
    ["Products", "294,866", "298,085", "316,199"],
    ["Services", "96,169", "85,200", "78,129"],
    ["Total net sales", "391,035", "383,285", "394,328", true],
  ];
  return (
    <>
      <div className="text-center font-bold uppercase">Apple Inc.</div>
      <div className="text-center font-bold uppercase">Consolidated Statements of Operations</div>
      <div className="text-center text-[11px]">(In millions, except number of shares and per-share amounts)</div>
      <table className="mt-5 w-full tabular-nums">
        <thead><tr className="border-b border-foreground text-[11px]"><th /><th className="text-right font-bold">2024</th><th className="text-right font-bold">2023</th><th className="text-right font-bold">2022</th></tr></thead>
        <tbody>
          <tr><td className="pt-2 italic" colSpan={4}>Net sales:</td></tr>
          {rows.map(([l, a, b, c, tot]) => (
            <tr key={l} className={tot ? "border-t border-foreground font-bold" : ""}>
              <td className={tot ? "py-1 pl-6" : "py-1 pl-3"}>{l}</td>
              <td className="py-1 text-right">{tot ? <Hl t={hl}>{a}</Hl> : a}</td><td className="py-1 text-right">{b}</td><td className="py-1 text-right">{c}</td>
            </tr>
          ))}
          <tr><td className="pt-3 italic" colSpan={4}>Cost of sales:</td></tr>
          <tr><td className="py-1 pl-3">Products</td><td className="text-right">185,233</td><td className="text-right">189,282</td><td className="text-right">201,471</td></tr>
          <tr><td className="py-1 pl-3">Services</td><td className="text-right">25,119</td><td className="text-right">24,855</td><td className="text-right">22,075</td></tr>
          <tr className="border-t border-foreground font-bold"><td className="py-1 pl-6">Gross margin</td><td className="text-right">180,683</td><td className="text-right">169,148</td><td className="text-right">170,782</td></tr>
        </tbody>
      </table>
      <p className="mt-5 text-[11px] text-muted-foreground">See accompanying Notes to Consolidated Financial Statements.</p>
    </>
  );
}

function DocRelease({ hl }: { hl: number }) {
  return (
    <>
      <div className="text-right text-[11px]">Exhibit 99.1</div>
      <div className="mt-2 text-center text-base font-bold">NVIDIA Announces Financial Results for Third Quarter Fiscal 2025</div>
      <ul className="mt-4 list-disc space-y-1 pl-5">
        <li>Record quarterly revenue of <Hl t={hl}>$35.1 billion</Hl>, up 17% from Q2 and up 94% from a year ago</li>
        <li>Record quarterly Data Center revenue of $30.8 billion, up 17% from Q2 and up 112% from a year ago</li>
      </ul>
      <p className="mt-4 indent-6">SANTA CLARA, Calif., Nov. 20, 2024 — NVIDIA today reported revenue for the third quarter ended October 27, 2024, of $35.1 billion, up 17% from the previous quarter and up 94% from a year ago.</p>
      <p className="mt-3 indent-6">For the quarter, GAAP earnings per diluted share were $0.78, up 16% from the previous quarter and up 111% from a year ago.</p>
      <p className="mt-3 indent-6 text-muted-foreground">“The age of AI is in full steam, propelling a global shift to NVIDIA computing,” said Jensen Huang, founder and CEO of NVIDIA…</p>
    </>
  );
}

function DocForm4({ hl }: { hl: number }) {
  return (
    <>
      <div className="flex items-start justify-between border-b-2 border-foreground pb-1">
        <div className="text-2xl font-bold">FORM 4</div>
        <div className="text-right text-[10px] leading-tight">UNITED STATES SECURITIES AND EXCHANGE COMMISSION<br />Washington, D.C. 20549</div>
      </div>
      <div className="mt-1 text-center text-[11px] font-bold">STATEMENT OF CHANGES IN BENEFICIAL OWNERSHIP</div>
      <div className="mt-3 grid grid-cols-2 gap-px border border-foreground bg-foreground text-[11px]">
        <div className="bg-card p-1.5"><b>1. Name of Reporting Person</b><br />Doe, Jane (mock)</div>
        <div className="bg-card p-1.5"><b>5. Relationship</b><br />X Officer: Chief Financial Officer</div>
      </div>
      <div className="mt-4 text-[11px] font-bold">Table I — Non-Derivative Securities Acquired, Disposed of, or Beneficially Owned</div>
      <table className="mt-1 w-full border border-foreground text-[11px] tabular-nums">
        <thead><tr className="border-b border-foreground"><th className="p-1 text-left">Title</th><th className="p-1">Date</th><th className="p-1">Code</th><th className="p-1">Amount</th><th className="p-1">(A)/(D)</th><th className="p-1">Price</th></tr></thead>
        <tbody>
          <tr><td className="p-1">Common Stock</td><td className="p-1 text-center">11/03/2026</td><td className="p-1 text-center">S<sup>(1)</sup></td><td className="p-1 text-center"><Hl t={hl}>12,500</Hl></td><td className="p-1 text-center">D</td><td className="p-1 text-center">$184.20</td></tr>
          <tr><td className="p-1">Common Stock</td><td className="p-1 text-center">11/03/2026</td><td className="p-1 text-center">M</td><td className="p-1 text-center">4,000</td><td className="p-1 text-center">A</td><td className="p-1 text-center">$0</td></tr>
        </tbody>
      </table>
      <p className="mt-3 text-[10.5px]">(1) The sale was effected pursuant to a Rule 10b5-1 trading plan adopted on May 12, 2026.</p>
    </>
  );
}

/* ---------------- Close ---------------- */
function Close() {
  return (
    <section className="border-t-2 border-ink px-6 py-28 text-center">
      <div className="mx-auto mb-6 inline-block -rotate-3 border-2 border-negative px-3 py-1 font-mono text-xs uppercase tracking-[0.3em] text-negative">Filed under: verified</div>
      <h2 style={SERIF} className="text-5xl font-medium leading-[0.95] tracking-tight md:text-7xl">Stop trusting numbers.<br /><em className="font-light">Start checking them.</em></h2>
      <div className="mt-8 flex justify-center gap-3">
        <Link to="/auth" className="bg-ink px-5 py-2.5 font-mono text-xs uppercase tracking-[0.18em] text-ink-foreground transition-opacity hover:opacity-85">Start reading</Link>
        <Link to="/pricing" className="border border-ink px-5 py-2.5 font-mono text-xs uppercase tracking-[0.18em] transition-colors hover:bg-muted">Pricing</Link>
      </div>
    </section>
  );
}
