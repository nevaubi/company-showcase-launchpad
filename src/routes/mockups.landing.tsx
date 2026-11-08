import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import chicago from "@/assets/chicago-lasalle.mp4.asset.json";
import { ChicagoNightVideoHero, ChicagoSplitVideoHero } from "@/components/landing-video/hero-video";
import { ArcScope } from "@/components/arc/arc-scope";
import { AiAnswer, type AnswerEvent } from "@/components/arc/blocks/ai-answer/ai-answer";
import { AiInsightCard, type Insight, type InsightMetric } from "@/components/arc/blocks/ai-insight-card/ai-insight-card";
import { MarketTerminal } from "@/components/arc/blocks/market-terminal/market-terminal";
import { LineReplay, type ReplayPoint, type ReplayMoment } from "@/components/arc/blocks/line-replay/line-replay";
import { VectorSearch } from "@/components/arc/vector-search/vector-search";

export const Route = createFileRoute("/mockups/landing")({
  head: () => ({
    meta: [
      { title: "Landing page concept · Filed Under" },
      { name: "description", content: "Internal concept: a full Filed Under landing page built from animated research sections." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Landing page concept · Filed Under" },
      { property: "og:description", content: "A full Filed Under landing page concept with animated research sections." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..600&display=swap" },
    ],
  }),
  component: Landing,
});

/* All figures on this page are illustrative and not checked against filings. */

const SERIF = { fontFamily: "'Newsreader', Georgia, serif" } as const;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function useInView<T extends HTMLElement>(threshold = 0.3) {
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

function Landing() {
  return (
    <div className="bg-paper text-foreground antialiased">
      <ChicagoNightVideoHero primaryAction={{ label: "Request access", href: "/signup" }} secondaryAction={{ label: "See the memo", href: "#memo" }} />
      <ChicagoSplitVideoHero primaryAction={{ label: "Request access", href: "/signup" }} secondaryAction={{ label: "See the memo", href: "#memo" }} />
      <Proof />
      <ArcScope>
        <Section title="Watch it write the memo" body="Filed Under drafts the recap the way an analyst would. It pulls the number behind each claim, tightens the prose and leaves every change tinted until you accept it.">
          <MemoWriter />
        </Section>
        <Section flip title="Ask the filings anything" body="Questions go straight to the source. The agent reads the SEC filings, then answers with a citation on every sentence, so you can check a number in one click.">
          <Lazy h={640}><div className="h-[640px] overflow-hidden rounded-xl border border-border bg-card"><AiAnswer question="What drove Bank of America's drop in net income in Q3 2026?" respond={respond} model={{ id: "fu", name: "Filed Under agent" }} models={[{ id: "fu", name: "Filed Under agent" }]} /></div></Lazy>
        </Section>
        <Section title={<>Numbers that<br />explain themselves</>} body="Every metric can tell you why it moved. The drivers add up to the change and point to the quarter where they show up.">
          <Lazy h={520}><AiInsightCard metric={niMetric} insight={niInsight} source={{ label: "SEC 8-K supplements" }} model={{ label: "Filed Under agent" }} /></Lazy>
        </Section>
        <Section flip title={<>One request,<br />the whole workflow</>} body="A single recap fans out to agents that read the filings, rebuild the quarterly model and write the memo in parallel. Replay any run to see who did what.">
          <Workflow />
        </Section>
        <Bento />
      </ArcScope>
      <Close />
    </div>
  );
}

/* ---------- Hero ---------- */
function Hero() {
  return (
    <section className="relative h-[92vh] min-h-[620px] overflow-hidden bg-ink text-ink-foreground">
      <video src={chicago.url} autoPlay muted loop playsInline className="absolute inset-0 size-full scale-105 object-cover" />
      <div className="absolute inset-0 bg-ink/55" />
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-ink/40" />
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6 md:px-8">
        <span style={SERIF} className="text-lg tracking-tight">Filed Under</span>
        <nav className="flex gap-6 text-[13px] text-ink-foreground/70 md:gap-8">
          <a href="#product" className="transition-colors hover:text-ink-foreground">Product</a>
          <Link to="/pricing" className="transition-colors hover:text-ink-foreground">Pricing</Link>
          <Link to="/auth" className="transition-colors hover:text-ink-foreground">Sign in</Link>
        </nav>
      </header>
      <div className="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-7xl px-6 pb-16 md:px-8 md:pb-20">
        <h1 style={SERIF} className="max-w-4xl text-[clamp(2.8rem,7vw,6.5rem)] font-light leading-[0.98] tracking-[-0.025em] animate-[rise_1200ms_cubic-bezier(0.16,1,0.3,1)_both]">
          Research that<br /><em>shows its work.</em>
        </h1>
        <p className="mt-6 max-w-xl text-[15px] leading-relaxed text-ink-foreground/70 animate-[rise_1200ms_cubic-bezier(0.16,1,0.3,1)_250ms_both]">
          An AI analyst for US equities that reads every 10-K, 10-Q and earnings supplement, and links every number it writes back to the filing.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4 animate-[rise_1200ms_cubic-bezier(0.16,1,0.3,1)_450ms_both]">
          <Link to="/auth" className="bg-ink-foreground px-6 py-3 text-[13px] font-medium text-ink transition-opacity hover:opacity-85">Request access</Link>
          <a href="#product" className="border border-ink-foreground/30 px-6 py-3 text-[13px] text-ink-foreground/85 transition-colors hover:border-ink-foreground/60">See it work</a>
        </div>
      </div>
    </section>
  );
}

function Proof() {
  const items = ["SEC EDGAR filings", "8-K earnings supplements", "Form 4 insider trades", "FRED macro series", "Earnings-call transcripts"];
  return (
    <div id="product" className="border-b border-border">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-10 gap-y-3 px-6 py-6 text-[13px] text-muted-foreground md:px-8">
        <span className="text-foreground">Read from the source</span>
        {items.map(i => <span key={i}>{i}</span>)}
      </div>
    </div>
  );
}

/* ---------- Section shell ---------- */
function Section({ title, body, children, flip }: { title: ReactNode; body: string; children: ReactNode; flip?: boolean }) {
  const [ref, on] = useInView<HTMLDivElement>(0.15);
  return (
    <section className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-10 px-6 py-20 md:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16 lg:py-28">
      <div ref={ref} className={`min-w-0 transition-all duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] ${on ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${flip ? "lg:order-2" : ""}`}>
        <h2 style={SERIF} className="text-[clamp(2rem,3.6vw,3rem)] font-light leading-[1.05] tracking-[-0.02em]">{title}</h2>
        <p className="mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
      <div className={`min-w-0 ${flip ? "lg:order-1" : ""}`}>{children}</div>
    </section>
  );
}

/** Mounts children once scrolled near, so their intro animations play in view. */
function Lazy({ children, h }: { children: ReactNode; h: number }) {
  const [ref, on] = useInView<HTMLDivElement>(0.2);
  return <div ref={ref} style={{ minHeight: h }}>{on ? children : null}</div>;
}

/* ---------- 1. Memo writer ---------- */
const memo = [
  "Revenue rose 3.2% from a year ago to $29.96B, led by net interest income of $16.45B, up 8.0%.",
  "Noninterest expense jumped 13.8% to $19.72B, mostly other general operating costs of $2.33B, up from $912M. The efficiency ratio rose to 65.8% from 59.7%, and net income fell 16.8% to $6.93B.",
  "Credit held steady. The net charge-off ratio was 0.44%, and the card charge-off rate improved to 3.22% from 3.46%. Wealth management client balances reached $5.06T.",
  "What to watch: whether the expense spike repeats in 4Q26, and how a CET1 ratio of 10.9% shapes buybacks.",
];
function MemoWriter() {
  const [ref, on] = useInView<HTMLDivElement>(0.3);
  const [chars, setChars] = useState(0);
  const [stage, setStage] = useState(0); // 0 typing, 1 analyst selects, 2 fixed, 3 accepted
  const total = memo.join("").length;
  useEffect(() => {
    if (!on) return;
    let alive = true;
    (async () => {
      while (alive) {
        setStage(0); setChars(0);
        for (let c = 0; c <= total && alive; c += 3) { setChars(c); await wait(14); }
        await wait(700); if (!alive) return; setStage(1);
        await wait(1600); if (!alive) return; setStage(2);
        await wait(2200); if (!alive) return; setStage(3);
        await wait(3500);
      }
    })();
    return () => { alive = false; };
  }, [on, total]);
  let left = chars;
  const label = stage === 0 ? (chars < total ? "Drafting from the 3Q26 supplement" : "Checking every figure") : stage === 1 ? "Analyst is reviewing" : stage === 2 ? "Tightening paragraph two" : "All changes accepted";
  return (
    <div ref={ref} className="overflow-hidden rounded-xl border border-border bg-card shadow-paper">
      <div className="flex items-center justify-between border-b border-border px-5 py-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-2"><span className="size-1.5 animate-pulse rounded-full bg-highlight" />{label}</span>
        <span className="font-mono">{Math.min(chars, total)} / {total}</span>
      </div>
      <div className="min-h-[400px] px-6 py-6 md:px-8">
        <h3 className="text-lg text-foreground">Bank of America: 3Q26 earnings recap</h3>
        <p className="mt-1 text-xs text-muted-foreground">Draft for the coverage team, Oct 14</p>
        <div className="mt-5 space-y-4 text-[14.5px] leading-relaxed text-foreground">
          {memo.map((p, i) => {
            const shown = p.slice(0, Math.max(0, left));
            left -= p.length;
            if (!shown) return null;
            const selected = i === 1 && stage === 1;
            const edited = i === 1 && stage >= 2;
            return (
              <p key={i} className={`relative rounded-sm transition-colors duration-500 ${selected ? "bg-highlight-soft" : ""}`}>
                {edited ? (
                  <>
                    Noninterest expense jumped 13.8% to $19.72B
                    <span className={`transition-colors duration-700 ${stage === 2 ? "bg-highlight-soft" : ""}`}>, driven by a $1.42B rise in other general operating costs</span>
                    . The efficiency ratio rose to 65.8% from 59.7%, and net income fell 16.8% to $6.93B.
                  </>
                ) : shown}
                {selected && <span className="absolute -top-3 left-24 rounded-full border border-border bg-card px-2 py-0.5 text-[11px] text-muted-foreground shadow-sm animate-[rise_400ms_ease-out_both]">Analyst: say how much it rose</span>}
                {i === 1 && stage === 2 && <span className="ml-2 inline-flex rounded-full bg-highlight px-2 py-0.5 align-middle text-[11px] text-highlight-foreground">Filed Under · Accept</span>}
              </p>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- 2. Ask the filings ---------- */
const bacSources = [
  { id: "sup", title: "Bank of America Supplemental Information, Q3 2026", site: "SEC EDGAR", domain: "sec.gov", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000070858", snippet: "Five quarters of results by segment, expense lines, credit and capital, with 3Q25 restated." },
  { id: "pr", title: "Bank of America 3Q26 earnings release (8-K)", site: "SEC EDGAR", domain: "sec.gov", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000070858", snippet: "Net income of $6.9 billion, or $0.86 per diluted share." },
];
const bacAnswer = `Higher expenses, not weaker revenue, cut the quarter's profit. [1]

## What moved
- Noninterest expense rose 13.8% to $19.72B, mostly other general operating costs. [1]
- Revenue still grew 3.2% to $29.96B, on net interest income up 8.0%. [2]
- Provision for credit losses was slightly lower than a year ago. [1]

| Line | Q3 2026 | Change |
| --- | --- | --- |
| Net income | $6.93B | −16.8% |
| Noninterest expense | $19.72B | +13.8% |
| Revenue | $29.96B | +3.2% |`;
async function* respond({ signal }: { signal: AbortSignal }): AsyncIterable<AnswerEvent> {
  for (const part of ["Read the 3Q26 supplement expense lines. ", "Compare with 3Q25 as restated."]) {
    if (signal.aborted) return;
    await wait(600);
    yield { type: "reasoning", text: part };
  }
  yield { type: "sources", sources: bacSources };
  yield { type: "thought", seconds: 3 };
  for (const piece of bacAnswer.split(/(\s+)/)) {
    if (signal.aborted) return;
    await wait(20);
    yield { type: "text", text: piece };
  }
  yield { type: "done", tokens: 418, followUps: ["What drove expenses?", "Compare with JPMorgan", "Show the efficiency ratio trend"] };
}

/* ---------- 3. Numbers that explain themselves ---------- */
const fmtB = (v: number) => `${v < 0 ? "−" : ""}$${(Math.abs(v) / 1e9).toFixed(2)}B`;
const niMetric: InsightMetric = {
  label: "Net income",
  period: "Q3 2026",
  value: 6.93e9,
  previous: 8.33e9,
  comparisonLabel: "vs Q3 2025",
  series: [6.67e9, 7.40e9, 7.12e9, 8.33e9, 7.60e9, 8.10e9, 8.45e9, 6.93e9],
  points: ["Q4 24", "Q1 25", "Q2 25", "Q3 25", "Q4 25", "Q1 26", "Q2 26", "Q3 26"],
  format: fmtB,
};
const niInsight: Insight = {
  segments: [
    { text: "Net income fell $1.40B from a year ago. " },
    { text: "Noninterest expense rose $2.39B, led by other general operating costs. ", driver: "exp" },
    { text: "Revenue grew $918M as net interest income climbed 8.0%. ", driver: "rev" },
    { text: "Slightly lower provision and taxes added $68M.", driver: "prov" },
  ],
  drivers: [
    { id: "exp", label: "Noninterest expense", delta: -2.39e9, point: 7 },
    { id: "rev", label: "Revenue", delta: 0.918e9, point: 7 },
    { id: "prov", label: "Provision and taxes", delta: 0.068e9, point: 7 },
  ],
};

/* ---------- 4. Workflow timeline ---------- */
type Seg = { a: number; b: number; k: "think" | "tool" | "wait" };
const lanes: { name: string; dot: string; segs: Seg[] }[] = [
  { name: "Orchestrator", dot: "bg-foreground", segs: [{ a: 0, b: 1.6, k: "think" }, { a: 1.6, b: 15, k: "wait" }, { a: 15, b: 16.5, k: "think" }, { a: 20, b: 21.5, k: "think" }] },
  { name: "Filings reader", dot: "bg-chart-1", segs: [{ a: 1.8, b: 3, k: "think" }, { a: 3, b: 7.5, k: "tool" }, { a: 7.5, b: 9, k: "think" }] },
  { name: "Model builder", dot: "bg-chart-2", segs: [{ a: 2, b: 3.4, k: "think" }, { a: 3.4, b: 9, k: "wait" }, { a: 9, b: 13.5, k: "tool" }, { a: 13.5, b: 14.6, k: "think" }] },
  { name: "Memo writer", dot: "bg-chart-3", segs: [{ a: 2.2, b: 14.6, k: "wait" }, { a: 14.8, b: 19.6, k: "think" }] },
];
const STEPS: [number, string][] = [[0, "Planning the recap"], [3, "Reading the 3Q26 supplement"], [7.5, "Handing figures to the model"], [9, "Rebuilding five quarters"], [14.8, "Writing the memo"], [20, "Reviewing citations"], [21.5, "Ready"]];
const END = 22;
function Workflow() {
  const [ref, on] = useInView<HTMLDivElement>(0.3);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  useEffect(() => {
    if (!on || !playing) return;
    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000; last = now;
      setT(v => (v >= END + 2 ? 0 : v + dt * speed));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on, playing, speed]);
  const now = Math.min(t, END);
  const status = [...STEPS].reverse().find(s => now >= s[0])?.[1] ?? "";
  const pct = (x: number) => `${(x / END) * 100}%`;
  const tokens = Math.round(now * 142);
  return (
    <div ref={ref} className="rounded-xl border border-border bg-card p-5 shadow-paper md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-[15px] text-foreground">Bank of America 3Q26 earnings recap</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{status} · {now.toFixed(1)}s · {tokens.toLocaleString()} tokens</p>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-[120px_minmax(0,1fr)] gap-x-4 gap-y-4">
        {lanes.map(l => (
          <div key={l.name} className="contents">
            <div className="flex items-center gap-2 text-[13px] text-foreground"><span className={`size-2 rounded-full ${l.dot}`} />{l.name}</div>
            <div className="relative h-6 rounded bg-muted/50">
              {l.segs.filter(s => s.a < now).map((s, i) => (
                <span key={i} className="absolute inset-y-1 rounded-sm"
                  style={{
                    left: pct(s.a), width: pct(Math.min(s.b, now) - s.a),
                    background: s.k === "tool" ? "var(--foreground)" : s.k === "think" ? "color-mix(in oklab, var(--foreground) 25%, transparent)" : "repeating-linear-gradient(135deg, color-mix(in oklab, var(--foreground) 18%, transparent) 0 3px, transparent 3px 6px)",
                  }} />
              ))}
            </div>
          </div>
        ))}
        <div />
        <div className="relative h-5 text-[11px] text-muted-foreground">
          {[0, 5, 10, 15, 20].map(s => <span key={s} className="absolute -translate-x-1/2" style={{ left: pct(s) }}>{s}s</span>)}
          <span className="absolute -top-[150px] h-[150px] w-px bg-foreground/60" style={{ left: pct(now) }} />
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <button onClick={() => setPlaying(p => !p)} className="rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-muted">{playing ? "Pause" : "Play"}</button>
          <button onClick={() => setT(0)} className="rounded-full border border-border px-3 py-1.5 text-foreground hover:bg-muted">Replay</button>
          {[1, 2].map(s => (
            <button key={s} onClick={() => setSpeed(s)} className={`rounded-full px-3 py-1.5 ${speed === s ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"}`}>{s}x</button>
          ))}
        </div>
        <div className="flex gap-4 text-muted-foreground">
          <span>Light: thinking</span><span>Solid: reading or calculating</span><span>Hatched: waiting</span>
        </div>
      </div>
    </div>
  );
}

/* ---------- Bento of more tools ---------- */
const terminalSymbols = [
  { ticker: "BAC", name: "Bank of America Corporation", exchange: "NYSE", price: 47.8, prevClose: 48.6, vol: 0.016, avgVolume: 38_000_000 },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", exchange: "NYSE", price: 311.5, prevClose: 309.8, vol: 0.013, avgVolume: 9_000_000 },
  { ticker: "WFC", name: "Wells Fargo & Company", exchange: "NYSE", price: 82.1, prevClose: 81.4, vol: 0.015, avgVolume: 16_000_000 },
  { ticker: "C", name: "Citigroup Inc.", exchange: "NYSE", price: 98.4, prevClose: 97.1, vol: 0.018, avgVolume: 14_000_000 },
];
const replayData: ReplayPoint[] = Array.from({ length: 145 }, (_, i) => {
  const time = i * 5;
  const typical = 0.6 + 1.6 * Math.cos((time - 360) / 120) ** 2;
  const spike = (at: number, size: number, w: number) => size * Math.exp(-((time - at) ** 2) / (2 * w * w));
  return { time, value: +(typical * 1.1 + spike(75, 2, 10) + spike(130, 6, 14) + spike(190, 3, 20) + 0.15 * Math.abs(Math.sin(i * 1.7))).toFixed(2), baseline: +typical.toFixed(2) };
});
const replayMoments: ReplayMoment[] = [
  { id: "release", time: 70, title: "3Q26 release (8-K)", detail: "Expenses up 13.8%", kind: "launch" },
  { id: "open", time: 130, title: "Market open", detail: "Heavy volume at the bell", kind: "milestone" },
  { id: "call", time: 190, title: "Earnings call", detail: "CFO addresses the expense jump", kind: "press" },
];
const clock = (m: number) => { const h = 7 + Math.floor((m + 20) / 60), mm = String(Math.round((m + 20) % 60)).padStart(2, "0"); return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "am" : "pm"}`; };
const sec = { name: "SEC EDGAR" };
const vsDocs = [
  { title: "Other general operating expense rose", topic: 0, source: sec }, { title: "Efficiency ratio 65.8%", topic: 0, source: sec },
  { title: "Litigation and settlement costs", topic: 0, source: sec }, { title: "Card charge-off rate 3.22%", topic: 1, source: sec },
  { title: "Allowance for credit losses", topic: 1, source: sec }, { title: "Commercial real estate exposure", topic: 1, source: sec },
  { title: "Net interest income up 8.0%", topic: 2, source: sec }, { title: "Deposit costs declined", topic: 2, source: sec },
  { title: "Fixed-rate asset repricing", topic: 2, source: sec },
];

function Bento() {
  return (
    <section className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-6 py-20 md:px-8 lg:py-28">
        <h2 style={SERIF} className="max-w-2xl text-[clamp(2rem,3.6vw,3rem)] font-light leading-[1.05] tracking-[-0.02em]">Everything else an analyst reaches for</h2>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">Prices, results-day reactions and every passage in the corpus, in the same place as the filings.</p>
        <div className="mt-12 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Tile title="Results day, replayed" body="Watch volume react as the release and the call land." wide>
            <Lazy h={380}><LineReplay title="BAC on results day" description="Shares traded every five minutes, millions, Eastern time." data={replayData} moments={replayMoments} seriesLabel="Results day" baselineLabel="Typical day" valueLabel="Volume" formatTime={clock} formatTick={clock} formatValue={v => `${v.toFixed(1)}M`} autoPlay /></Lazy>
          </Tile>
          <Tile title="Search by meaning" body="A question finds the closest passages across filings.">
            <Lazy h={360}><VectorSearch topics={[{ name: "Expenses" }, { name: "Credit" }, { name: "Net interest" }]} documents={vsDocs} query="Why did costs jump this quarter?" k={3} /></Lazy>
          </Tile>
          <Tile title="Live market" body="Candles, watchlist and paper trades next to the research.">
            <Lazy h={360}><MarketTerminal symbols={terminalSymbols} holdings={[]} orders={[]} buyingPower={25000} defaultTicker="BAC" /></Lazy>
          </Tile>
        </div>
      </div>
    </section>
  );
}
function Tile({ title, body, children, wide }: { title: string; body: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`min-w-0 rounded-xl border border-border bg-card p-5 md:p-6 ${wide ? "lg:col-span-2" : ""}`}>
      <h3 className="text-[15px] text-foreground">{title}</h3>
      <p className="mt-1 text-[13px] text-muted-foreground">{body}</p>
      <div className="mt-5 min-w-0">{children}</div>
    </div>
  );
}

/* ---------- Close ---------- */
function Close() {
  return (
    <section className="bg-ink text-ink-foreground">
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-8 px-6 py-24 md:px-8 lg:flex-row lg:items-end lg:justify-between">
        <h2 style={SERIF} className="max-w-3xl text-[clamp(2.2rem,5vw,4.5rem)] font-light leading-[1] tracking-[-0.025em]">
          Every figure<br /><em>resolves to its filing.</em>
        </h2>
        <Link to="/auth" className="bg-ink-foreground px-6 py-3 text-[13px] font-medium text-ink transition-opacity hover:opacity-85">Request access</Link>
      </div>
      <div className="mx-auto max-w-7xl border-t border-ink-foreground/10 px-6 py-6 text-xs text-ink-foreground/50 md:px-8">Filed Under · Concept page, figures are illustrative</div>
    </section>
  );
}
