import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import chicago from "@/assets/chicago-lasalle.mp4.asset.json";
import { PdfViewer } from "@/components/mockups/pdf-viewer";

export const Route = createFileRoute("/mockups/landing-hero")({
  head: () => ({
    meta: [
      { title: "Landing hero mockup · Filed Under" },
      { name: "description", content: "Internal test page: landing page concept for Filed Under." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Landing hero mockup · Filed Under" },
      { property: "og:description", content: "Internal landing page concept for Filed Under." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&display=swap" },
    ],
  }),
  component: Mockup,
});

const SERIF = { fontFamily: "'Newsreader', Georgia, serif" } as const;
const EASE = "ease-[cubic-bezier(0.16,1,0.3,1)]";
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

function useSmoothScroll(el: React.RefObject<HTMLElement | null>, apply: (p: number) => void) {
  useEffect(() => {
    let cur = 0, raf = 0;
    const tick = () => {
      const node = el.current;
      if (node) {
        const r = node.getBoundingClientRect();
        const target = clamp(-r.top / Math.max(1, r.height - window.innerHeight));
        cur += (target - cur) * 0.09;
        if (Math.abs(target - cur) < 0.0005) cur = target;
        apply(cur);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

function useInView<T extends HTMLElement>(threshold = 0.25) {
  const ref = useRef<T>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, on] as const;
}

function Mockup() {
  return (
    <div className="bg-paper text-foreground antialiased">
      <Hero />
      <Sources />
      <Figures />
      <Feature n="02" kicker="Supply chain" title={<>The network,<br /><em>drawn from the 10-K.</em></>}
        body="Suppliers, customers and partners are extracted from annual reports and kept only when the supporting sentence appears verbatim in the filing. Exposure, concentration and regional risk are measured on the same graph.">
        <SupplyGraph />
      </Feature>
      <Feature n="03" kicker="Filing redlines" flip title={<>What changed,<br /><em>sentence by sentence.</em></>}
        body="Consecutive 10-K and 10-Q filings are aligned section by section and compared word by word. Material edits to risk factors, guidance language and accounting policies are scored and surfaced.">
        <Redline />
      </Feature>
      <Feature n="04" kicker="Investor relations" title={<>Segments and KPIs,<br /><em>cell by cell.</em></>}
        body="Earnings releases, supplements and presentation decks are read into structured series. Each data point retains a locator to the exact table cell or slide it was taken from.">
        <KpiChart />
      </Feature>
      <Feature n="05" kicker="Research agent" flip title={<>An analyst that<br /><em>cites its work.</em></>}
        body="The research agent navigates filings, statements and external sources across multiple steps, verifies figures before stating them, and attaches a citation to every sentence it writes.">
        <Agent />
      </Feature>
      <Close />
    </div>
  );
}

/* ================= Hero ================= */
function Hero() {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const shade = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  useSmoothScroll(wrap, (p) => {
    if (video.current) video.current.style.transform = `translate3d(0,${p * 6}%,0) scale(${1.04 + p * 0.1})`;
    if (shade.current) shade.current.style.opacity = String(0.35 + p * 0.6);
    if (copy.current) {
      copy.current.style.transform = `translate3d(0,${-p * 60}px,0)`;
      copy.current.style.opacity = String(1 - clamp((p - 0.25) / 0.45));
    }
  });
  return (
    <div ref={wrap} className="relative h-[160vh]">
      <section className="sticky top-0 h-screen overflow-hidden bg-ink text-ink-foreground">
        <video ref={video} src={chicago.url} autoPlay muted loop playsInline preload="auto"
          className="absolute inset-0 size-full object-cover will-change-transform" />
        <div ref={shade} className="absolute inset-0 bg-ink will-change-[opacity]" style={{ opacity: 0.35 }} />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-ink/40" />
        <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-8 py-6">
          <span style={SERIF} className="text-lg tracking-tight">Filed Under</span>
          <nav className="flex gap-8 text-[13px] text-ink-foreground/70">
            <Link to="/pricing" className="transition-colors duration-300 hover:text-ink-foreground">Pricing</Link>
            <Link to="/auth" className="transition-colors duration-300 hover:text-ink-foreground">Sign in</Link>
          </nav>
        </header>
        <div ref={copy} className="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-7xl px-8 pb-20 will-change-transform">
          <h1 style={SERIF} className="max-w-4xl text-[clamp(3rem,7.5vw,7rem)] font-light leading-[0.98] tracking-[-0.025em]">
            <Line d={200}>Primary-source</Line>
            <Line d={380}><em className="font-light">equity research.</em></Line>
          </h1>
          <div className="mt-10 flex items-center gap-6 animate-[rise_1400ms_cubic-bezier(0.16,1,0.3,1)_900ms_both]">
            <Link to="/auth" className="bg-ink-foreground px-6 py-3 text-[13px] font-medium text-ink transition-opacity duration-300 hover:opacity-85">Request access</Link>
            <span className="h-px w-16 bg-ink-foreground/30" />
            <span className="text-[13px] text-ink-foreground/60">Every figure resolves to its filing.</span>
          </div>
        </div>
      </section>
    </div>
  );
}

function Line({ children, d }: { children: ReactNode; d: number }) {
  return (
    <span className="block overflow-hidden pb-[0.08em]">
      <span className="block animate-[rise_1600ms_cubic-bezier(0.16,1,0.3,1)_both]" style={{ animationDelay: `${d}ms` }}>{children}</span>
    </span>
  );
}

/* ================= Provenance ================= */
// Recreated filing pages, typeset as PDFs for illustration (Form 4 issuer is fictional).
type Row = [string, string];
const DOCS = [
  {
    id: "aapl", co: "Apple Inc.", tk: "AAPL", table: "Income statement · FY2024 · $M",
    rows: [["Total net sales", "391,035"], ["Gross margin", "180,683"], ["Operating income", "123,216"], ["Net income", "93,736"]] as Row[],
    file: "/mockups/aapl-10k-p28.pdf", name: "aapl-20240928_10-K.pdf", page: 28, pages: 121, find: "391,035",
    chain: [["Form", "10-K"], ["Accession", "0000320193-24-000123"], ["Concept", "us-gaap:Revenues"], ["Period", "FY ended 2024-09-28"]],
  },
  {
    id: "nvda", co: "NVIDIA Corporation", tk: "NVDA", table: "Quarterly results · Q3 FY2025 · $M",
    rows: [["Revenue", "35,082"], ["Gross margin", "74.6%"], ["Operating income", "21,869"], ["Net income", "19,309"]] as Row[],
    file: "/mockups/nvda-q3fy25-ex991.pdf", name: "nvda-20241120_ex99-1.pdf", page: 1, pages: 14, find: "$35,082",
    chain: [["Form", "8-K · EX-99.1"], ["Filed", "2024-11-20"], ["Locator", "Table 1 · Row 1 · Col 1"], ["Period", "Q ended 2024-10-27"]],
  },
  {
    id: "f4", co: "Example Holdings Corp.", tk: "EXHC", table: "Insider activity · November 2026",
    rows: [["Shares disposed · CFO", "12,500"], ["Weighted avg. price", "$184.20"], ["Held after transaction", "73,910"], ["Plan", "Rule 10b5-1"]] as Row[],
    file: "/mockups/form4-exhc.pdf", name: "exhc-form4-20261105.pdf", page: 1, pages: 2, find: "12,500",
    chain: [["Form", "4"], ["Table", "I · Non-derivative"], ["Code", "S · Open-market sale"], ["Filed", "2026-11-05"]],
  },
];

function Sources() {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const path = useRef<SVGPathElement>(null);
  const dotA = useRef<SVGCircleElement>(null);
  const dotB = useRef<SVGCircleElement>(null);
  const [idx, setIdx] = useState(0);
  const [lit, setLit] = useState(false);
  const last = useRef(0);

  useSmoothScroll(wrap, (p) => {
    const i = Math.min(DOCS.length - 1, Math.floor(p * DOCS.length * 0.999));
    if (i !== last.current) { last.current = i; setIdx(i); }
    // Connector from the active app cell to the highlighted run in the PDF.
    const s = stage.current, a = s?.querySelector("[data-src-cell]"), b = s?.querySelector("[data-pdf-hit]");
    if (!s || !a || !b || !path.current) return;
    const o = s.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const x1 = ra.right - o.left + 6, y1 = ra.top + ra.height / 2 - o.top;
    const x2 = rb.left - o.left - 4, y2 = rb.top + rb.height / 2 - o.top;
    const mx = (x1 + x2) / 2;
    path.current.setAttribute("d", `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
    dotA.current?.setAttribute("cx", String(x1)); dotA.current?.setAttribute("cy", String(y1));
    dotB.current?.setAttribute("cx", String(x2)); dotB.current?.setAttribute("cy", String(y2));
  });

  const d = DOCS[idx];
  return (
    <div ref={wrap} className="relative" style={{ height: `${DOCS.length * 110}vh` }}>
      <section ref={stage} className="sticky top-0 mx-auto grid h-screen max-w-7xl grid-cols-1 content-center gap-x-16 gap-y-6 px-8 lg:grid-cols-[0.72fr_1.28fr]">
        <div className="min-w-0 self-center">
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            <span className="tabular-nums text-foreground">01</span><span className="h-px w-8 bg-rule" />Provenance
          </div>
          <h2 style={SERIF} className="mt-4 text-[clamp(2.25rem,4vw,3.5rem)] font-light leading-[1.02] tracking-[-0.02em]">
            Each figure opens<br /><em>at its source line.</em>
          </h2>

          {/* App-side card */}
          <div key={d.id} className={`mt-10 border border-rule bg-card shadow-paper animate-[rise_900ms_cubic-bezier(0.16,1,0.3,1)_both]`}>
            <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
              <div className="flex items-center gap-2.5">
                <span className="grid size-6 place-items-center bg-ink font-mono text-[9px] text-ink-foreground">{d.tk.slice(0, 2)}</span>
                <span className="text-[13px] font-medium">{d.co}</span>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">{d.tk}</span>
            </div>
            <div className="px-4 pt-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{d.table}</div>
            <table className="w-full text-[13px]">
              <tbody>
                {d.rows.map(([l, v], i) => (
                  <tr key={l} className="border-b border-rule last:border-0">
                    <td className={`px-4 py-2.5 ${i === 0 ? "" : "text-muted-foreground"}`}>{l}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span {...(i === 0 ? { "data-src-cell": "" } : {})}
                        className={`relative inline-block font-mono tabular-nums transition-colors duration-700 ${i === 0 && lit ? "text-highlight-foreground" : ""}`}>
                        {i === 0 && <span className={`absolute -inset-x-1.5 -inset-y-0.5 origin-left bg-highlight transition-transform duration-700 ${EASE} ${lit ? "scale-x-100" : "scale-x-0"}`} />}
                        <span className="relative">{v}</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Provenance chain */}
          <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3">
            {d.chain.map(([k, v], i) => (
              <div key={d.id + k} className={`border-t border-rule pt-2 transition-all duration-700 ${EASE} ${lit ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
                style={{ transitionDelay: lit ? `${500 + i * 110}ms` : "0ms" }}>
                <dt className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{k}</dt>
                <dd className="mt-0.5 truncate font-mono text-[11.5px]">{v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6 flex items-center gap-2">
            {DOCS.map((x, i) => (
              <span key={x.id} className="h-0.5 flex-1 overflow-hidden bg-rule">
                <span className={`block h-full bg-ink transition-[width] duration-[1200ms] ${EASE}`} style={{ width: i < idx ? "100%" : i === idx ? (lit ? "100%" : "20%") : "0%" }} />
              </span>
            ))}
            <span className="ml-2 font-mono text-[10px] tabular-nums text-muted-foreground">{idx + 1}/{DOCS.length}</span>
          </div>
        </div>

        <div className="min-w-0 self-center">
          <PdfViewer doc={d} onLit={setLit} />
          <p className="mt-3 text-right text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Recreated documents · for illustration</p>
        </div>

        {/* Connector */}
        <svg className="pointer-events-none absolute inset-0 hidden size-full lg:block" aria-hidden>
          <path ref={path} pathLength={1} fill="none" className="stroke-ink" strokeWidth="1"
            style={{ strokeDasharray: 1, strokeDashoffset: lit ? 0 : 1, transition: lit ? "stroke-dashoffset 900ms cubic-bezier(0.65,0,0.35,1) 150ms" : "none" }} />
          <circle ref={dotA} r="3" className={`fill-ink transition-opacity duration-300 ${lit ? "opacity-100" : "opacity-0"}`} />
          <circle ref={dotB} r="3" className={`fill-ink transition-opacity duration-300 ${lit ? "opacity-100 delay-1000" : "opacity-0"}`} />
        </svg>
      </section>
    </div>
  );
}

/* ================= Figures band ================= */
function Figures() {
  const [ref, on] = useInView<HTMLDivElement>(0.4);
  const items = [["1,844", "US companies covered"], ["74,400", "Investor-relations documents"], ["2.9M", "Sourced IR data points"], ["8", "Primary-source datasets"]];
  return (
    <section ref={ref} className="border-y border-rule bg-card">
      <div className="mx-auto grid max-w-7xl grid-cols-2 px-8 md:grid-cols-4">
        {items.map(([v, l], i) => (
          <div key={l} className={`border-rule py-12 pr-6 transition-all duration-1000 ${EASE} ${i ? "md:border-l md:pl-8" : ""} ${on ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"}`} style={{ transitionDelay: `${i * 120}ms` }}>
            <div style={SERIF} className="text-5xl font-light tabular-nums tracking-tight">{v}</div>
            <div className="mt-2 text-[12px] text-muted-foreground">{l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ================= Feature frame ================= */
function Feature({ n, kicker, title, body, children, flip }: { n: string; kicker: string; title: ReactNode; body: string; children: ReactNode; flip?: boolean }) {
  const [ref, on] = useInView<HTMLElement>(0.2);
  return (
    <section ref={ref} className="border-b border-rule">
      <div className={`mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 px-8 py-32 lg:grid-cols-[0.8fr_1.2fr] ${flip ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <div className={`min-w-0 transition-all duration-1000 ${EASE} ${on ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"}`}>
          <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
            <span className="tabular-nums text-foreground">{n}</span><span className="h-px w-8 bg-rule" />{kicker}
          </div>
          <h2 style={SERIF} className="mt-4 text-[clamp(2.25rem,4vw,3.5rem)] font-light leading-[1.02] tracking-[-0.02em]">{title}</h2>
          <p className="mt-6 max-w-md text-[15px] leading-relaxed text-muted-foreground">{body}</p>
        </div>
        <div className={`min-w-0 transition-all delay-200 duration-[1200ms] ${EASE} ${on ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"}`} data-on={on}>
          <Visible on={on}>{children}</Visible>
        </div>
      </div>
    </section>
  );
}
function Visible({ on, children }: { on: boolean; children: ReactNode }) {
  return <div className={on ? "group/vis is-on" : "group/vis"}>{children}</div>;
}
const Panel = ({ children, label }: { children: ReactNode; label: string }) => (
  <div className="border border-rule bg-card shadow-paper">
    <div className="flex items-center justify-between border-b border-rule px-4 py-2.5 text-[11px] text-muted-foreground">
      <span>{label}</span><span className="font-mono">Illustrative</span>
    </div>
    {children}
  </div>
);

/* ---- Supply graph ---- */
function SupplyGraph() {
  const center = { x: 300, y: 190 };
  const nodes = [
    { l: "TSMC", r: "Foundry", x: 90, y: 70, k: "supplier" }, { l: "SK hynix", r: "HBM memory", x: 105, y: 200, k: "supplier" },
    { l: "Foxconn", r: "Assembly", x: 110, y: 320, k: "supplier" }, { l: "Microsoft", r: "Customer", x: 510, y: 80, k: "customer" },
    { l: "Meta", r: "Customer", x: 530, y: 200, k: "customer" }, { l: "Amazon", r: "Customer", x: 500, y: 315, k: "customer" },
  ];
  return (
    <Panel label="NVDA · Counterparty network">
      <svg viewBox="0 0 600 380" className="block w-full">
        {[60, 120, 180].map((r) => <circle key={r} cx={center.x} cy={center.y} r={r} className="fill-none stroke-rule" strokeDasharray="2 4" />)}
        {nodes.map((n, i) => (
          <g key={n.l}>
            <path d={`M${center.x},${center.y} Q${(center.x + n.x) / 2},${center.y} ${n.x},${n.y}`} pathLength={1} fill="none"
              className={`${n.k === "supplier" ? "stroke-ink" : "stroke-link"} transition-[stroke-dashoffset] duration-[1400ms] ease-[cubic-bezier(0.65,0,0.35,1)] [stroke-dashoffset:1] group-[.is-on]/vis:[stroke-dashoffset:0]`}
              strokeWidth="1.2" strokeDasharray="1" style={{ transitionDelay: `${300 + i * 120}ms` }} />
          </g>
        ))}
        {nodes.map((n, i) => (
          <g key={n.l + "n"} className="opacity-0 transition-opacity duration-700 group-[.is-on]/vis:opacity-100" style={{ transitionDelay: `${900 + i * 120}ms` }}>
            <circle cx={n.x} cy={n.y} r="5" className={n.k === "supplier" ? "fill-ink" : "fill-link"} />
            <text x={n.x + (n.x < 300 ? -12 : 12)} y={n.y - 2} textAnchor={n.x < 300 ? "end" : "start"} className="fill-foreground text-[13px]">{n.l}</text>
            <text x={n.x + (n.x < 300 ? -12 : 12)} y={n.y + 13} textAnchor={n.x < 300 ? "end" : "start"} className="fill-muted-foreground font-mono text-[9.5px] uppercase tracking-wider">{n.r}</text>
          </g>
        ))}
        <circle cx={center.x} cy={center.y} r="28" className="fill-ink" />
        <text x={center.x} y={center.y + 4} textAnchor="middle" className="fill-ink-foreground font-mono text-[12px]">NVDA</text>
      </svg>
      <div className="flex gap-6 border-t border-rule px-4 py-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-ink" />Supplier</span>
        <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-link" />Customer</span>
        <span className="ml-auto">Each edge opens its source sentence</span>
      </div>
    </Panel>
  );
}

/* ---- Redline ---- */
function Redline() {
  const del = "transition-colors duration-700 group-[.is-on]/vis:bg-negative-soft group-[.is-on]/vis:text-negative group-[.is-on]/vis:line-through";
  const ins = "transition-colors duration-700 group-[.is-on]/vis:bg-positive-soft group-[.is-on]/vis:text-positive";
  return (
    <Panel label="Item 1A · Risk Factors · 10-K FY2025 vs FY2024">
      <div className="space-y-5 p-6 font-serif text-[14.5px] leading-[1.7]" style={SERIF}>
        <p>
          A significant portion of our revenue is derived from a{" "}
          <span className={del} style={{ transitionDelay: "500ms" }}>limited number of</span>{" "}
          <span className={ins} style={{ transitionDelay: "800ms" }}>small number of large</span>{" "}
          customers, and the loss of{" "}
          <span className={del} style={{ transitionDelay: "1100ms" }}>any one</span>{" "}
          <span className={ins} style={{ transitionDelay: "1400ms" }}>one or more</span>{" "}
          of these customers could materially harm our results.
        </p>
        <p className="text-muted-foreground">
          Export controls{" "}
          <span className={ins} style={{ transitionDelay: "1700ms" }}>, including licensing requirements introduced during the fiscal year,</span>{" "}
          may limit our ability to sell certain products in specific regions.
        </p>
      </div>
      <div className="grid grid-cols-3 border-t border-rule text-[11px]">
        {[["Change score", "0.82"], ["Words added", "+19"], ["Words removed", "−5"]].map(([k, v]) => (
          <div key={k} className="border-r border-rule px-4 py-3 last:border-0">
            <div className="text-muted-foreground">{k}</div><div className="mt-0.5 font-mono text-[13px] tabular-nums">{v}</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

/* ---- KPI chart ---- */
function KpiChart() {
  const q = ["Q1", "Q2", "Q3", "Q4", "Q1", "Q2", "Q3", "Q4"];
  const a = [42, 48, 55, 61, 66, 74, 83, 92];
  const b = [18, 19, 19, 21, 22, 22, 24, 25];
  return (
    <Panel label="Segment revenue · indexed · from earnings releases">
      <div className="flex h-64 items-end gap-3 px-6 pb-4 pt-8">
        {q.map((x, i) => (
          <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
            <div className="mx-auto flex h-full w-[46%] flex-col justify-end gap-0.5">
              <div className={`w-full origin-bottom scale-y-0 bg-ink transition-transform duration-1000 ${EASE} group-[.is-on]/vis:scale-y-100 ${i === 7 ? "outline outline-2 outline-offset-2 outline-highlight" : ""}`}
                style={{ height: `${a[i]}%`, transitionDelay: `${300 + i * 70}ms` }} />
              <div className={`w-full origin-bottom scale-y-0 bg-ink-muted transition-transform duration-1000 ${EASE} group-[.is-on]/vis:scale-y-100`}
                style={{ height: `${b[i]}%`, transitionDelay: `${360 + i * 70}ms` }} />
            </div>
            <span className="font-mono text-[10px] text-muted-foreground">{x}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-rule px-4 py-2.5 font-mono text-[11px]">
        <span className="bg-highlight px-1.5 text-highlight-foreground">Q4 · Segment A</span>
        <span className="text-muted-foreground">→ EX-99.2 · Table 3 · Row 4 · Col 2</span>
      </div>
    </Panel>
  );
}

/* ---- Agent ---- */
function Agent() {
  const steps = ["Reading Form 10-K · Item 7", "Reconciling segment totals with IR supplement", "Checking counterparty disclosures", "Composing cited summary"];
  return (
    <Panel label="Research agent">
      <div className="p-6">
        <div className="border-l-2 border-ink pl-4 text-[14px]">Assess customer concentration and its trend over the last two fiscal years.</div>
        <ol className="mt-6 space-y-3">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3 text-[13px] opacity-0 transition-opacity duration-500 group-[.is-on]/vis:opacity-100" style={{ transitionDelay: `${400 + i * 450}ms` }}>
              <span className="grid size-4 place-items-center rounded-full border border-ink/30 font-mono text-[8px]">{i + 1}</span>
              <span className={i === steps.length - 1 ? "text-shimmer" : "text-muted-foreground"}>{s}</span>
            </li>
          ))}
        </ol>
        <div className="mt-6 border-t border-rule pt-5 text-[14px] leading-relaxed opacity-0 transition-opacity duration-1000 group-[.is-on]/vis:opacity-100" style={{ ...SERIF, transitionDelay: "2400ms" }}>
          Two direct customers represented a combined share of revenue above the prior year
          <sup className="ml-0.5 font-mono text-[10px] text-link">[1]</sup>, and the risk-factor language was broadened accordingly
          <sup className="ml-0.5 font-mono text-[10px] text-link">[2]</sup>.
          <div className="mt-4 flex gap-2 font-sans text-[11px]">
            <span className="border border-rule px-2 py-1 font-mono">[1] 10-K · Note 16</span>
            <span className="border border-rule px-2 py-1 font-mono">[2] 10-K · Item 1A</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/* ================= Close ================= */
function Close() {
  return (
    <section className="px-8 py-36">
      <div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-10">
        <h2 style={SERIF} className="text-[clamp(2.5rem,5vw,4.5rem)] font-light leading-[1] tracking-[-0.02em]">Research<br /><em>you can audit.</em></h2>
        <div className="flex gap-3">
          <Link to="/auth" className="bg-ink px-6 py-3 text-[13px] font-medium text-ink-foreground transition-opacity duration-300 hover:opacity-85">Request access</Link>
          <Link to="/pricing" className="border border-ink/20 px-6 py-3 text-[13px] transition-colors duration-300 hover:border-ink">Pricing</Link>
        </div>
      </div>
    </section>
  );
}
