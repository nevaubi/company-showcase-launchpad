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
      <Feature n="02" kicker="Supply chain" title={<>Every dependency,<br /><em>with the sentence behind it.</em></>}
        body="Suppliers, sub-suppliers and customers are read from annual reports and kept only when the supporting sentence appears verbatim. Each edge carries its quote, its share of revenue where disclosed, and the regional risk it concentrates.">
        <SupplyGraph />
      </Feature>
      <Feature n="03" kicker="Filing redlines" flip title={<>What changed,<br /><em>sentence by sentence.</em></>}
        body="Each filing is aligned to the prior one section by section and compared word by word. Changes are scored and tied to the dollar amounts they disclose, so a new export licence requirement surfaces next to the charge it caused.">
        <Redline />
      </Feature>
      <Feature n="04" kicker="Investor relations" title={<>Segments and KPIs,<br /><em>cell by cell.</em></>}
        body="Earnings releases, supplements and decks are read into quarterly series that tie back to the 10-Q. Every bar keeps a locator to the table cell it was read from.">
        <KpiChart />
      </Feature>
      <Feature n="05" kicker="Research agent" flip title={<>An analyst that<br /><em>cites its work.</em></>}
        body="The agent reads filings across companies, navigates the platform, runs its own calculations and returns a chart and a conclusion where every figure is cited.">
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
                        {i === 0 && lit && <span className="pointer-events-none absolute -left-3 top-1/2 size-5 -translate-y-1/2 rounded-full border border-ink animate-[ping_900ms_cubic-bezier(0,0,0.2,1)_1_both]" />}
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
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px]">
            {["Value matches document text", "Period aligned", "Units verified"].map((c, i) => (
              <li key={d.id + c} className={`flex items-center gap-1.5 transition-all duration-500 ${lit ? "opacity-100" : "opacity-0"}`} style={{ transitionDelay: lit ? `${1000 + i * 160}ms` : "0ms" }}>
                <span className="text-positive">✓</span>{c}
              </li>
            ))}
          </ul>

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

/* ================= Feature frame ================= */
function Feature({ n, kicker, title, body, children, flip }: { n: string; kicker: string; title: ReactNode; body: string; children: ReactNode; flip?: boolean }) {
  const [ref, on] = useInView<HTMLElement>(0.2);
  return (
    <section ref={ref} className="border-b border-rule">
      <div className={`mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 px-8 py-32 ${flip ? "lg:grid-cols-[1.2fr_0.8fr] lg:[&>*:first-child]:order-2" : "lg:grid-cols-[0.8fr_1.2fr]"}`}>
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

/* ---- shared: cycle an index while visible ---- */
function useCycle(on: boolean, n: number, ms: number, startDelay = 1600) {
  const [i, setI] = useState(-1);
  useEffect(() => {
    if (!on) return;
    let t: ReturnType<typeof setInterval> | undefined;
    const s = setTimeout(() => { setI(0); t = setInterval(() => setI((x) => (x + 1) % n), ms); }, startDelay);
    return () => { clearTimeout(s); if (t) clearInterval(t); };
  }, [on, n, ms, startDelay]);
  return i;
}
function useOn() { const [ref, on] = useInView<HTMLDivElement>(0.35); return [ref, on] as const; }

/* ---- Supply chain ---- */
type SNode = { id: string; l: string; role: string; geo: string; x: number; y: number; side: "s" | "c" | "t2" };
const SN: SNode[] = [
  { id: "asml", l: "ASML", role: "EUV lithography", geo: "NL", x: 60, y: 70, side: "t2" },
  { id: "abf", l: "Ajinomoto", role: "ABF substrate film", geo: "JP", x: 60, y: 300, side: "t2" },
  { id: "tsmc", l: "TSMC", role: "Wafers · CoWoS", geo: "TW", x: 210, y: 110, side: "s" },
  { id: "hynix", l: "SK hynix", role: "HBM3E", geo: "KR", x: 210, y: 210, side: "s" },
  { id: "fii", l: "Foxconn", role: "Systems assembly", geo: "TW", x: 210, y: 310, side: "s" },
  { id: "c-a", l: "Customer A", role: "12% of revenue", geo: "US", x: 560, y: 95, side: "c" },
  { id: "c-b", l: "Customer B", role: "11% of revenue", geo: "US", x: 560, y: 190, side: "c" },
  { id: "c-c", l: "Customer C", role: "11% of revenue", geo: "US", x: 560, y: 285, side: "c" },
];
const SE = [
  { from: "tsmc", w: 3, quote: "We utilize foundries, such as Taiwan Semiconductor Manufacturing Company Limited, or TSMC, and Samsung Electronics Co., Ltd., or Samsung, to produce our semiconductor wafers.", src: "10-K FY2025 · Item 1 · Manufacturing", risk: "Taiwan Strait · single-region advanced packaging", tier: "Critical" },
  { from: "hynix", w: 2.4, quote: "We obtain memory from SK Hynix Inc., Micron Technology, Inc., and Samsung.", src: "10-K FY2025 · Item 1 · Manufacturing", risk: "HBM supply allocated through 2026", tier: "High" },
  { from: "c-a", w: 2.2, quote: "Sales to direct customers A, B and C accounted for 12%, 11% and 11% of total revenue, respectively.", src: "10-K FY2025 · Note 16 · Concentration", risk: "Top three direct customers = 34% of revenue", tier: "High" },
  { from: "fii", w: 1.8, quote: "We utilize contract manufacturers, such as Hon Hai Precision Industry Co., Ltd., to assemble our systems.", src: "10-K FY2025 · Item 1 · Manufacturing", risk: "Assembly footprint TW · MX · VN", tier: "Elevated" },
];
const nodeOf = (id: string) => SN.find((n) => n.id === id)!;
const C = { x: 385, y: 200 };

function SupplyGraph() {
  const [ref, on] = useOn();
  const i = useCycle(on, SE.length, 3400);
  const e = SE[Math.max(0, i)];
  const act = i >= 0 ? e.from : "";
  const lineTo = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const mx = (a.x + b.x) / 2; return `M${a.x},${a.y} C${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`;
  };
  return (
    <div ref={ref}>
      <Panel label="NVDA · Counterparty network · tier 2 → customers">
        <div className="grid grid-cols-5 border-b border-rule px-4 py-2 font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">
          <span>Tier 2</span><span className="text-center">Tier 1</span><span className="col-span-2 text-center">Issuer</span><span className="text-right">Direct customers</span>
        </div>
        <svg viewBox="0 0 640 380" className="block w-full">
          {[["tsmc", "asml"], ["tsmc", "abf"]].map(([a, b], k) => (
            <path key={a + b} d={lineTo(nodeOf(b), nodeOf(a))} fill="none" strokeDasharray="3 4" strokeWidth="1"
              className={`stroke-ink-muted transition-opacity duration-700 ${on ? "opacity-100" : "opacity-0"}`} style={{ transitionDelay: `${1100 + k * 150}ms` }} />
          ))}
          {SN.filter((n) => n.side !== "t2").map((n, k) => {
            const w = SE.find((x) => x.from === n.id)?.w ?? (n.side === "c" ? 2 : 1.4);
            const hot = act === n.id;
            return (
              <path key={n.id} d={n.side === "c" ? lineTo(C, n) : lineTo(n, C)} pathLength={1} fill="none" strokeDasharray="1"
                strokeWidth={hot ? w + 1 : w}
                className={`${hot ? "stroke-highlight" : n.side === "c" ? "stroke-link/60" : "stroke-ink/50"} transition-[stroke-dashoffset,stroke,stroke-width] duration-[1200ms] ease-[cubic-bezier(0.65,0,0.35,1)]`}
                style={{ strokeDashoffset: on ? 0 : 1, transitionDelay: on && i < 0 ? `${300 + k * 110}ms` : "0ms" }} />
            );
          })}
          {act && (() => { const n = nodeOf(act); const d = n.side === "c" ? lineTo(C, n) : lineTo(n, C); return (
            <circle key={act + i} r="3.5" className="fill-ink"><animateMotion dur="1.6s" repeatCount="indefinite" path={d} /></circle>
          ); })()}
          {SN.map((n, k) => {
            const hot = act === n.id, left = n.side !== "c";
            return (
              <g key={n.id} className={`transition-opacity duration-700 ${on ? "opacity-100" : "opacity-0"}`} style={{ transitionDelay: `${800 + k * 90}ms` }}>
                <rect x={left ? n.x - 50 : n.x - 6} y={n.y - 17} width="112" height="34" rx="2"
                  className={`${hot ? "fill-highlight-soft stroke-ink" : "fill-card stroke-rule"} transition-colors duration-500`} />
                <text x={left ? n.x - 42 : n.x + 2} y={n.y - 2} className="fill-foreground text-[11.5px] font-medium">{n.l}</text>
                <text x={left ? n.x - 42 : n.x + 2} y={n.y + 10} className="fill-muted-foreground font-mono text-[8.5px]">{n.role}</text>
                <text x={left ? n.x + 55 : n.x + 99} y={n.y - 4} textAnchor="end" className="fill-muted-foreground font-mono text-[8px]">{n.geo}</text>
              </g>
            );
          })}
          <rect x={C.x - 44} y={C.y - 26} width="88" height="52" className="fill-ink" />
          <text x={C.x} y={C.y - 2} textAnchor="middle" className="fill-ink-foreground font-mono text-[13px]">NVDA</text>
          <text x={C.x} y={C.y + 13} textAnchor="middle" className="fill-ink-muted font-mono text-[8px] uppercase tracking-widest">issuer</text>
        </svg>
        <div className="grid min-h-[132px] grid-cols-1 border-t border-rule sm:grid-cols-[1fr_200px]">
          <div key={i} className="animate-[rise_700ms_cubic-bezier(0.16,1,0.3,1)_both] px-5 py-4">
            <div className="font-mono text-[10px] text-muted-foreground">{i >= 0 ? e.src : "Loading edges…"}</div>
            {i >= 0 && <p style={SERIF} className="mt-1.5 text-[14px] leading-snug">“<span className="bg-highlight-soft">{e.quote}</span>”</p>}
          </div>
          {i >= 0 && (
            <div key={"r" + i} className="animate-[rise_700ms_cubic-bezier(0.16,1,0.3,1)_120ms_both] border-rule px-5 py-4 text-[11px] sm:border-l">
              <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Dependency</div>
              <div className="mt-1 font-medium">{e.tier}</div>
              <div className="mt-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Region watch</div>
              <div className="mt-1 leading-snug">{e.risk}</div>
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}

/* ---- Redline ---- */
function Redline() {
  const [ref, on] = useOn();
  const del = "transition-colors duration-700 group-[.is-on]/r:bg-negative-soft group-[.is-on]/r:text-negative group-[.is-on]/r:line-through";
  const ins = "transition-colors duration-700 group-[.is-on]/r:bg-positive-soft group-[.is-on]/r:text-positive";
  const toc = [["Item 1A · Export controls", 0.91, true], ["Item 7 · Gross margin", 0.74, false], ["Note 3 · Inventory", 0.62, false], ["Item 1A · Customer concentration", 0.31, false], ["Item 2 · Properties", 0.04, false]] as const;
  return (
    <div ref={ref} className={on ? "group/r is-on" : "group/r"}>
      <Panel label="NVDA · 10-Q Q1 FY2026 vs 10-K FY2025">
        <div className="grid grid-cols-1 md:grid-cols-[190px_1fr]">
          <ul className="border-b border-rule py-2 text-[11px] md:border-b-0 md:border-r">
            {toc.map(([s, v, a], k) => (
              <li key={s} className={`flex items-center gap-2 px-3 py-1.5 ${a ? "bg-highlight-soft" : "text-muted-foreground"}`}>
                <span className="min-w-0 flex-1 truncate">{s}</span>
                <span className="h-1 w-8 overflow-hidden bg-rule"><span className={`block h-full bg-ink transition-[width] duration-1000 ${EASE}`} style={{ width: on ? `${v * 100}%` : 0, transitionDelay: `${300 + k * 100}ms` }} /></span>
              </li>
            ))}
          </ul>
          <div className="space-y-4 p-5 text-[14px] leading-[1.7]" style={SERIF}>
            <p>
              On April 9, 2025, the USG informed us that a license is required for exports of our{" "}
              <span className={del} style={{ transitionDelay: "500ms" }}>H100</span>{" "}
              <span className={ins} style={{ transitionDelay: "800ms" }}>H20 integrated circuits and any other circuits achieving the H20’s memory bandwidth, interconnect bandwidth, or combination thereof</span>{" "}
              to China, including Hong Kong and Macau.
            </p>
            <p>
              <span className={ins} style={{ transitionDelay: "1300ms" }}>We incurred a $4.5 billion charge in the first quarter of fiscal year 2026 associated with H20 excess inventory and purchase obligations as the demand for H20 diminished.</span>
            </p>
            <p className="text-muted-foreground">
              Data Center revenue from China{" "}
              <span className={del} style={{ transitionDelay: "1700ms" }}>may decline</span>{" "}
              <span className={ins} style={{ transitionDelay: "1900ms" }}>declined significantly</span>{" "}
              as a percentage of total Data Center revenue.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-4 border-t border-rule text-[11px]">
          {[["Severity", "High"], ["Linked $", "$4.5B charge"], ["Section score", "0.91"], ["Net words", "+46"]].map(([k, v]) => (
            <div key={k} className="border-r border-rule px-4 py-3 last:border-0">
              <div className="text-muted-foreground">{k}</div><div className="mt-0.5 font-mono text-[12.5px] tabular-nums">{v}</div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ---- IR KPIs ---- */
const KQ = ["Q1 25", "Q2 25", "Q3 25", "Q4 25", "Q1 26", "Q2 26", "Q3 26"];
const DC = [22604, 26272, 30771, 35580, 39112, 41096, 51215];
const GM = [2647, 2880, 3279, 2544, 3763, 4287, 4265];
const fmt = (v: number) => v.toLocaleString("en-US");
function KpiChart() {
  const [ref, on] = useOn();
  const i = useCycle(on, KQ.length, 1500, 1800);
  const sel = i < 0 ? KQ.length - 1 : i;
  const max = 56000;
  return (
    <div ref={ref}>
      <Panel label="NVDA · Revenue by market platform · $M · from EX-99.1 & CFO commentary">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_230px]">
          <div className="relative flex h-72 items-end gap-2 px-5 pb-3 pt-10">
            {[0.25, 0.5, 0.75].map((g) => <div key={g} className="pointer-events-none absolute inset-x-5 border-t border-dashed border-rule" style={{ bottom: `calc(${g * 100}% * 0.82 + 28px)` }} />)}
            {KQ.map((q, k) => (
              <div key={q} className="relative flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                {k === sel && <span className="absolute -top-1 whitespace-nowrap bg-ink px-1.5 py-0.5 font-mono text-[10px] text-ink-foreground" style={{ bottom: `calc(${(DC[k] + GM[k]) / max * 82}% + 30px)`, top: "auto" }}>{fmt(DC[k])}</span>}
                <div className="flex h-[82%] w-[62%] flex-col justify-end gap-px">
                  <div className={`w-full origin-bottom transition-[transform,background-color] duration-1000 ${EASE} ${k === sel ? "bg-highlight" : "bg-ink"}`}
                    style={{ height: `${DC[k] / max * 100}%`, transform: on ? "scaleY(1)" : "scaleY(0)", transitionDelay: i < 0 ? `${300 + k * 80}ms` : "0ms" }} />
                  <div className={`w-full origin-bottom bg-ink-muted transition-transform duration-1000 ${EASE}`}
                    style={{ height: `${GM[k] / max * 100}%`, transform: on ? "scaleY(1)" : "scaleY(0)", transitionDelay: `${360 + k * 80}ms` }} />
                </div>
                <span className={`font-mono text-[9.5px] ${k === sel ? "text-foreground" : "text-muted-foreground"}`}>{q}</span>
              </div>
            ))}
          </div>
          {/* Source table excerpt */}
          <div className="border-t border-rule md:border-l md:border-t-0">
            <div className="border-b border-rule px-3 py-2 font-mono text-[9.5px] text-muted-foreground">EX-99.1 · Revenue by market · {KQ[sel]}</div>
            <table className="w-full font-mono text-[10.5px]">
              <tbody>
                {[["Data Center", DC[sel], true], ["Gaming", GM[sel], false], ["Pro Visualization", null, false], ["Automotive", null, false]].map(([l, v, hl]) => (
                  <tr key={l as string} className="border-b border-rule">
                    <td className="px-3 py-2 text-muted-foreground">{l as string}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {hl ? <span key={sel} className="animate-[hl-sweep_700ms_ease-out_both] bg-highlight px-1 text-highlight-foreground">{fmt(v as number)}</span> : v ? fmt(v as number) : "···"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="space-y-1.5 px-3 py-3 font-mono text-[10px]">
              <div className="flex justify-between"><dt className="text-muted-foreground">Locator</dt><dd>t2 · r1 · c1</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Q/Q</dt><dd>{sel ? `${((DC[sel] / DC[sel - 1] - 1) * 100).toFixed(1)}%` : "—"}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">Ties to 10-Q</dt><dd className="text-positive">✓ segment note</dd></div>
            </dl>
          </div>
        </div>
        <div className="flex gap-5 border-t border-rule px-4 py-2.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-2"><span className="size-2 bg-ink" />Data Center</span>
          <span className="flex items-center gap-2"><span className="size-2 bg-ink-muted" />Gaming</span>
          <span className="ml-auto font-mono">Fiscal quarters</span>
        </div>
      </Panel>
    </div>
  );
}

/* ---- Agent ---- */
const STEPS = [
  { t: "search_filings", a: "MSFT · GOOGL · AMZN · META · latest 10-Q", r: "4 filings · cash-flow statements" },
  { t: "read_section", a: "Purchases of property and equipment", r: "4 values · 8 quarters each" },
  { t: "open_page", a: "/app/supply-chain?focus=NVDA", r: "3 direct customers ≥ 10% revenue" },
  { t: "run_python", a: "capex growth y/y · vs NVDA Data Center", r: "corr 0.94 · 8 quarters" },
];
const CAPEX = [["AMZN", 31.4, 91], ["MSFT", 24.2, 27], ["GOOGL", 22.4, 70], ["META", 17.0, 101]] as const;
function Agent() {
  const [ref, on] = useOn();
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on) return;
    const ts = [...STEPS.map((_, k) => 500 + k * 750), 500 + STEPS.length * 750 + 300].map((d, k) => setTimeout(() => setN(k + 1), d));
    return () => ts.forEach(clearTimeout);
  }, [on]);
  const done = n > STEPS.length;
  return (
    <div ref={ref}>
      <Panel label="Research agent · Deep">
        <div className="p-5">
          <div className="ml-auto max-w-[85%] bg-muted px-3.5 py-2.5 text-[13px]">Is hyperscaler capex still accelerating, and how exposed is NVIDIA if it slows?</div>
          <ol className="mt-5 space-y-2">
            {STEPS.map((s, k) => (
              <li key={s.t} className={`grid grid-cols-[16px_1fr] gap-x-3 text-[12px] transition-all duration-500 ${EASE} ${n > k ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}>
                <span className={`mt-1 grid size-4 place-items-center rounded-full border font-mono text-[8px] ${n > k + 1 ? "border-ink bg-ink text-ink-foreground" : "border-ink/30"}`}>{n > k + 1 ? "✓" : k + 1}</span>
                <div className="min-w-0">
                  <span className="font-mono text-[11px]">{s.t}</span> <span className={n === k + 1 ? "text-shimmer" : "text-muted-foreground"}>{s.a}</span>
                  {n > k + 1 && <div className="font-mono text-[10px] text-muted-foreground">→ {s.r}</div>}
                </div>
              </li>
            ))}
          </ol>
          <div className={`mt-5 border-t border-rule pt-4 transition-opacity duration-1000 ${done ? "opacity-100" : "opacity-0"}`}>
            <div className="mb-3 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Quarterly capex · $B · y/y</div>
            <div className="space-y-1.5">
              {CAPEX.map(([tk, v, g], k) => (
                <div key={tk} className="grid grid-cols-[44px_1fr_64px] items-center gap-2 font-mono text-[10.5px]">
                  <span>{tk}</span>
                  <span className="h-3 bg-rule/60"><span className={`block h-full bg-ink transition-[width] duration-1000 ${EASE}`} style={{ width: done ? `${v / 32 * 100}%` : 0, transitionDelay: `${k * 100}ms` }} /></span>
                  <span className="text-right tabular-nums">{v.toFixed(1)} <span className="text-positive">+{g}%</span></span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[13.5px] leading-relaxed" style={SERIF}>
              Combined capex rose to $95.0B, up roughly two-thirds year over year<sup className="ml-0.5 font-mono text-[9px] text-link">[1–4]</sup>.
              Three direct customers account for 34% of NVIDIA revenue<sup className="ml-0.5 font-mono text-[9px] text-link">[5]</sup>, so a
              10% capex cut maps to an estimated 6–8% Data Center revenue headwind<sup className="ml-0.5 font-mono text-[9px] text-link">[calc]</sup>.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5 font-mono text-[10px]">
              {["[1] AMZN 10-Q", "[2] MSFT 10-K", "[3] GOOGL 10-Q", "[4] META 10-Q", "[5] NVDA 10-K · Note 16", "[calc] python"].map((c) => <span key={c} className="border border-rule px-1.5 py-0.5">{c}</span>)}
            </div>
          </div>
        </div>
      </Panel>
    </div>
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
