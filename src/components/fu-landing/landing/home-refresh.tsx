import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MousePointer2 } from "lucide-react";
import financialsShot from "@/assets/landing/nvidia_financials.webp.asset.json";
import irShot from "@/assets/landing/nvidia_ir.webp.asset.json";
import valuationShot from "@/assets/landing/nvidia_valuation.webp.asset.json";
import type { LandingStats } from "@/lib/landing-stats.functions";
import s from "./home-refresh.module.css";

/* ---------- Live platform counts ---------- */

const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString());

export function LiveCounts({ stats, companies }: { stats: LandingStats | null; companies: number }) {
  const items = [
    { v: companies, l: "US companies covered" },
    { v: stats?.irDocs, l: "investor-relations files stored" },
    { v: stats?.irFacts, l: "KPI and segment figures, each cited" },
    { v: stats?.supplyLinks, l: "supply-chain links quoted from filings" },
  ].filter((x): x is { v: number; l: string } => typeof x.v === "number" && x.v > 0);
  return (
    <section className={s.wrap} style={{ paddingBlock: "40px" }} aria-label="Platform counts">
      <div className={s.stats}>
        {items.map((x) => <div key={x.l} className={s.stat}><b>{fmt(x.v)}</b><span>{x.l}</span></div>)}
      </div>
      <p className={s.statsNote}>Live totals from the Filed Under database.</p>
    </section>
  );
}

/* ---------- Click-to-source animation (real NVIDIA FY2026 10-K figures) ---------- */

const ROWS = [
  { label: "Revenue", v: "$215,938M", concept: "us-gaap:Revenues", printed: "Revenue $ 215,938" },
  { label: "Gross profit", v: "$153,463M", concept: "us-gaap:GrossProfit", printed: "Gross profit 153,463" },
  { label: "Operating income", v: "$130,387M", concept: "us-gaap:OperatingIncomeLoss", printed: "Operating income 130,387" },
  { label: "Net income", v: "$120,067M", concept: "us-gaap:NetIncomeLoss", printed: "Net income $ 120,067" },
];
const ACCN = "0001045810-26-000021";
const FILING_URL = "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000021/nvda-20260125.htm";

export function ClickToSource() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  const [phase, setPhase] = useState<"move" | "open">("move");
  useEffect(() => {
    if (reduce) { setPhase("open"); return; }
    const t = setTimeout(() => {
      if (phase === "move") setPhase("open");
      else { setPhase("move"); setI((x) => (x + 1) % ROWS.length); }
    }, phase === "move" ? 1100 : 2800);
    return () => clearTimeout(t);
  }, [phase, reduce]);
  const row = ROWS[i];
  return (
    <section className={s.wrap} id="click-to-source" aria-labelledby="cts-title">
      <div className={s.split}>
        <div>
          <p className={s.eyebrow}>Click-to-source</p>
          <h2 id="cts-title" className={s.h2}>Click a number. See the filing it came from.</h2>
          <p className={s.body}>
            Every figure carries its SEC accession, XBRL concept and period. Click it and the original 10-K opens beside you,
            scrolled to the highlighted value. These are NVIDIA's real fiscal 2026 results.
          </p>
          <p className={s.body} style={{ fontSize: 14 }}>
            <a href={FILING_URL} target="_blank" rel="noreferrer">Open the 10-K on SEC.gov</a> · <a href="/companies/NVDA">See NVIDIA's sourced page</a>
          </p>
        </div>
        <div className={s.demo} aria-hidden="true">
          <table className={s.table}>
            <thead><tr><th>NVIDIA · Income statement</th><th>FY2026</th></tr></thead>
            <tbody>
              {ROWS.map((r, k) => (
                <tr key={r.label}><td>{r.label}</td><td><span className={s.num} data-on={k === i && phase === "open"}>{r.v}</span></td></tr>
              ))}
            </tbody>
          </table>
          {!reduce && (
            <motion.div
              className={s.cursor}
              initial={false}
              animate={{ left: phase === "move" ? "30%" : "44%", top: 62 + i * 46 + 18, scale: phase === "open" ? 0.85 : 1 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
              <MousePointer2 size={20} fill="currentColor" />
            </motion.div>
          )}
          <AnimatePresence>
            {phase === "open" && (
              <motion.div
                key={row.label}
                className={s.panel}
                initial={reduce ? { opacity: 0 } : { x: "100%" }}
                animate={reduce ? { opacity: 1 } : { x: 0 }}
                exit={reduce ? { opacity: 0 } : { x: "100%" }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <div className={s.panelHead}><span>Source</span><span>10-K · filed 2026-02-25</span></div>
                <p className={s.panelTitle}>{row.label} · FY2026</p>
                <p className={s.meta}>{ACCN}<br />{row.concept} · 2025-01-27 → 2026-01-25</p>
                <div className={s.doc}>
                  <div className={s.docLine} style={{ width: "92%" }} />
                  <div className={s.docLine} style={{ width: "70%" }} />
                  <div><span className={s.mark}>{row.printed}</span></div>
                  <div className={s.docLine} style={{ width: "84%" }} />
                  <div className={s.docLine} style={{ width: "60%" }} />
                  <div className={s.docLine} style={{ width: "76%" }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </section>
  );
}

/* ---------- Real product screenshots ---------- */

const SHOTS = [
  { id: "financials", label: "Financials", src: financialsShot.url, alt: "NVIDIA ten-year income statement and chart in Filed Under", caption: "Ten years of statements built from SEC XBRL data. Every cell opens its filing." },
  { id: "ir", label: "IR KPIs", src: irShot.url, alt: "NVIDIA investor-relations KPIs and segment revenue in Filed Under", caption: "Segment and KPI data read from earnings releases and decks, with tie-out checks against SEC revenue." },
  { id: "valuation", label: "Valuation", src: valuationShot.url, alt: "NVIDIA point-in-time valuation multiples in Filed Under", caption: "Point-in-time multiples: each week uses only fundamentals already filed by that date." },
];

export function ProductShots() {
  const [cur, setCur] = useState(SHOTS[0].id);
  const shot = SHOTS.find((x) => x.id === cur) ?? SHOTS[0];
  return (
    <section className={s.wrap} id="screens" aria-labelledby="screens-title">
      <p className={s.eyebrow}>Inside the product</p>
      <h2 id="screens-title" className={s.h2}>The real thing, on NVIDIA</h2>
      <div className={s.tabs} role="tablist" aria-label="Product screens">
        {SHOTS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === cur} className={s.tab} onClick={() => setCur(x.id)}>{x.label}</button>
        ))}
      </div>
      <div className={s.shot}>
        <AnimatePresence mode="wait">
          <motion.img key={shot.id} src={shot.src} alt={shot.alt} width={1800} height={1110} loading="lazy"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} />
        </AnimatePresence>
      </div>
      <p className={s.caption}>{shot.caption} <a href="/auth?mode=signup">Join the waitlist</a></p>
    </section>
  );
}
