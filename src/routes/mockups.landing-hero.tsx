import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import chicago from "@/assets/chicago-lasalle.mp4.asset.json";
import { PdfViewer } from "@/components/mockups/pdf-viewer";

export const Route = createFileRoute("/mockups/landing-hero")({
  head: () => ({
    meta: [
      { title: "Landing hero mockup · Filed Under" },
      { name: "description", content: "Internal test page: landing hero concept for Filed Under." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Landing hero mockup · Filed Under" },
      { property: "og:description", content: "Internal landing hero concept for Filed Under." },
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
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

/** Scroll-linked motion without React re-renders: eased value written straight to the DOM. */
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

function Mockup() {
  return (
    <div className="bg-paper text-foreground antialiased">
      <Hero />
      <Sources />
      <Close />
    </div>
  );
}

/* ---------------- Hero ---------------- */
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
          className="absolute inset-0 size-full object-cover will-change-transform animate-[rise_2200ms_cubic-bezier(0.16,1,0.3,1)_both]" />
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

function Line({ children, d }: { children: React.ReactNode; d: number }) {
  return (
    <span className="block overflow-hidden pb-[0.08em]">
      <span className="block animate-[rise_1600ms_cubic-bezier(0.16,1,0.3,1)_both]" style={{ animationDelay: `${d}ms` }}>{children}</span>
    </span>
  );
}

/* ---------------- Sources (real PDFs) ---------------- */
// Recreated filing pages, typeset as PDFs for illustration (Form 4 issuer is fictional).
const DOCS = [
  { id: "aapl", label: "Apple Inc.", metric: "Total net sales, FY2024", value: "$391,035M", ref: "Form 10-K · Consolidated Statements of Operations", file: "/mockups/aapl-10k-p28.pdf", name: "aapl-20240928_10-K.pdf", page: 28, pages: 121, find: "391,035" },
  { id: "nvda", label: "NVIDIA Corporation", metric: "Revenue, Q3 FY2025", value: "$35,082M", ref: "Form 8-K · Exhibit 99.1", file: "/mockups/nvda-q3fy25-ex991.pdf", name: "nvda-20241120_ex99-1.pdf", page: 1, pages: 14, find: "$35,082" },
  { id: "f4", label: "Example Holdings Corp.", metric: "Disposition by CFO, Rule 10b5-1", value: "12,500 sh", ref: "Form 4 · Table I", file: "/mockups/form4-exhc.pdf", name: "exhc-form4-20261105.pdf", page: 1, pages: 2, find: "12,500" },
];

function Sources() {
  const wrap = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const last = useRef(0);
  useSmoothScroll(wrap, (p) => {
    const i = Math.min(DOCS.length - 1, Math.floor(p * DOCS.length * 0.999));
    if (i !== last.current) { last.current = i; setIdx(i); }
  });
  const d = DOCS[idx];
  return (
    <div ref={wrap} className="relative" style={{ height: `${DOCS.length * 100}vh` }}>
      <section className="sticky top-0 mx-auto grid h-screen max-w-7xl grid-cols-1 items-center gap-12 px-8 lg:grid-cols-[0.75fr_1.25fr]">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Provenance</div>
          <h2 style={SERIF} className="mt-4 text-[clamp(2.25rem,4vw,3.5rem)] font-light leading-[1.02] tracking-[-0.02em]">
            Each figure opens<br /><em>at its source line.</em>
          </h2>
          <ol className="mt-12 border-t border-rule">
            {DOCS.map((x, i) => (
              <li key={x.id} className="relative border-b border-rule py-4">
                <span className="absolute left-0 top-0 h-px bg-ink transition-[width] duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)]" style={{ width: i === idx ? "100%" : "0%" }} />
                <div className={`transition-opacity duration-700 ${i === idx ? "opacity-100" : "opacity-35"}`}>
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-[13px]">{x.label}</span>
                    <span className="font-mono text-[15px] tabular-nums">{x.value}</span>
                  </div>
                  <div className="mt-1 flex justify-between gap-4 text-[11px] text-muted-foreground">
                    <span>{x.metric}</span><span>{x.ref}</span>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Recreated documents · for illustration</p>
        </div>
        <PdfViewer doc={d} />
      </section>
    </div>
  );
}

/* ---------------- Close ---------------- */
function Close() {
  return (
    <section className="border-t border-rule px-8 py-36">
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
