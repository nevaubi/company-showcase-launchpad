import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { ArcScope } from "@/components/arc/arc-scope";
import { DonutChart } from "@/components/arc/donut-chart/donut-chart";
import { FunnelChart } from "@/components/arc/funnel-chart/funnel-chart";
import { RealtimeStream, type StreamPoint } from "@/components/arc/realtime-stream/realtime-stream";
import { VectorSearch } from "@/components/arc/vector-search/vector-search";
import { AskYourData } from "@/components/arc/ask-your-data/ask-your-data";
import type { AskYourDataResult } from "@/components/arc/ask-your-data/ask-your-data-types";
import { HorizonChart } from "@/components/arc/blocks/horizon-chart/horizon-chart";
import { LineReplay, type ReplayMoment, type ReplayPoint } from "@/components/arc/blocks/line-replay/line-replay";
import { MarketTerminal } from "@/components/arc/blocks/market-terminal/market-terminal";
import { AiAnswer, type AnswerEvent } from "@/components/arc/blocks/ai-answer/ai-answer";
import { AiInsightCard, type Insight, type InsightMetric } from "@/components/arc/blocks/ai-insight-card/ai-insight-card";
import SegmentedControl from "@/components/arc/segmented-control/segmented-control";

export const Route = createFileRoute("/mockups/arc-motion")({
  head: () => ({
    meta: [
      { title: "Animated components · Filed Under" },
      { name: "description", content: "Ten animated research components for Filed Under, shown with illustrative data." },
      { property: "og:title", content: "Animated components · Filed Under" },
      { property: "og:description", content: "Ten animated research components for Filed Under, shown with illustrative data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MotionGallery,
});

/* All figures below are illustrative and not checked against filings. */

/* 1. Live tape */
function useLiveTape() {
  const [points, setPoints] = useState<StreamPoint[]>([]);
  useEffect(() => {
    let v = 191.2;
    let i = 0;
    const seed = Array.from({ length: 30 }, (_, k) => {
      v += Math.sin(k / 3) * 0.12;
      return { t: Date.now() - (30 - k) * 1000, value: +v.toFixed(2) };
    });
    setPoints(seed);
    const id = window.setInterval(() => {
      i++;
      const jump = i % 23 === 0 ? 1.4 : 0;
      v = v + (Math.sin(i / 4) + Math.cos(i / 7)) * 0.08 + jump - (i % 23 === 5 ? 1 : 0);
      setPoints(list => [...list.slice(-120), { t: Date.now(), value: +v.toFixed(2), anomaly: jump ? "Block trade" : undefined }]);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  return points;
}

/* 2. Revenue mix */
const mixSets = {
  fy25: [
    { key: "dc", label: "Data Center", value: 115.2 }, { key: "gm", label: "Gaming", value: 11.4 },
    { key: "pv", label: "Pro visualization", value: 1.9 }, { key: "au", label: "Automotive", value: 1.7 }, { key: "oem", label: "OEM & other", value: 0.4 },
  ],
  fy23: [
    { key: "dc", label: "Data Center", value: 15.0 }, { key: "gm", label: "Gaming", value: 9.1 },
    { key: "pv", label: "Pro visualization", value: 1.5 }, { key: "au", label: "Automotive", value: 0.9 }, { key: "oem", label: "OEM & other", value: 0.5 },
  ],
};

/* 3. Pipeline funnel */
const funnelSegments = [{ key: "periodic", label: "10-K / 10-Q" }, { key: "current", label: "8-K exhibits" }];
const funnelStages = [
  { key: "fetched", label: "Filings fetched", values: { periodic: 8500, current: 74400 } },
  { key: "parsed", label: "Tables parsed", values: { periodic: 8340, current: 61200 } },
  { key: "facts", label: "Facts extracted", values: { periodic: 8100, current: 48900 } },
  { key: "verified", label: "Re-read & verified", values: { periodic: 7950, current: 41300 } },
];

/* 4. Horizon: sectors vs SPY */
const dayCount = 90;
const dayStart = Date.UTC(2026, 7, 10);
const horizonDays = Array.from({ length: dayCount }, (_, i) => {
  const d = new Date(dayStart + i * 864e5);
  return {
    short: d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    long: d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }),
  };
});
const sectorNames = ["Semiconductors", "Software", "Banks", "Payments", "Pharma", "Medtech", "Retail", "Autos", "Oil & gas", "Utilities", "Industrials", "Media", "REITs", "Insurance"];
const horizonSeries = sectorNames.map((name, k) => ({
  id: name.toLowerCase().replace(/\W+/g, "-"),
  name,
  values: Array.from({ length: dayCount }, (_, i) => {
    const drift = (k % 3 === 0 ? 1 : k % 3 === 1 ? -0.6 : 0.2) * i / 9;
    return Math.round(drift + 7 * Math.sin(i / (8 + k) + k) + 3 * Math.cos(i / 3 + k * 2));
  }),
}));
const horizonTicks = [{ index: 0, label: "Aug 10" }, { index: 22, label: "Sep" }, { index: 52, label: "Oct" }, { index: 83, label: "Nov" }];

/* 5. Earnings day replay (minutes after 4:00 am ET premarket) */
const replayData: ReplayPoint[] = Array.from({ length: 193 }, (_, i) => {
  const time = i * 5;
  const session = time >= 330 && time <= 720 ? 1 : 0;
  const typical = 0.3 + session * (2.2 + 1.4 * Math.cos((time - 330) / 62)) ;
  const spike = (at: number, size: number, width: number) => size * Math.exp(-((time - at) ** 2) / (2 * width ** 2));
  const value = typical * 1.15 + spike(722, 9, 12) + spike(790, 6, 18) + spike(862, 4, 10) + 0.2 * Math.abs(Math.sin(i * 1.7));
  return { time, value: +value.toFixed(2), baseline: +typical.toFixed(2) };
});
const replayMoments: ReplayMoment[] = [
  { id: "open", time: 330, title: "Market open", detail: "Regular session begins", kind: "milestone" },
  { id: "release", time: 720, title: "Q3 release (8-K)", detail: "Data Center revenue ahead of guidance", kind: "launch" },
  { id: "call", time: 780, title: "Earnings call", detail: "CFO guides next quarter revenue higher", kind: "press" },
  { id: "export", time: 860, title: "Export-rule question", detail: "Analyst asks about China licences", kind: "incident" },
];
const replayClock = (m: number) => {
  const h = 4 + Math.floor(m / 60), mm = String(Math.round(m % 60)).padStart(2, "0");
  return `${((h + 11) % 12) + 1}:${mm} ${h < 12 ? "am" : "pm"}`;
};

/* 6. Terminal */
const terminalSymbols = [
  { ticker: "NVDA", name: "NVIDIA Corporation", exchange: "NASDAQ", price: 191.2, prevClose: 187.6, vol: 0.028, avgVolume: 182_000_000 },
  { ticker: "MSFT", name: "Microsoft Corporation", exchange: "NASDAQ", price: 512.4, prevClose: 509.1, vol: 0.014, avgVolume: 21_000_000 },
  { ticker: "AAPL", name: "Apple Inc.", exchange: "NASDAQ", price: 268.9, prevClose: 270.3, vol: 0.015, avgVolume: 48_000_000 },
  { ticker: "JPM", name: "JPMorgan Chase & Co.", exchange: "NYSE", price: 311.5, prevClose: 309.8, vol: 0.013, avgVolume: 9_000_000 },
  { ticker: "AVGO", name: "Broadcom Inc.", exchange: "NASDAQ", price: 352.7, prevClose: 344.0, vol: 0.026, avgVolume: 22_000_000 },
  { ticker: "XOM", name: "Exxon Mobil Corporation", exchange: "NYSE", price: 114.3, prevClose: 115.1, vol: 0.012, avgVolume: 15_000_000 },
];

/* 7. Vector search over filing passages */
const vsTopics = [{ name: "Export controls" }, { name: "Supply chain" }, { name: "Customer demand" }];
const sec = { name: "SEC EDGAR" };
const vsDocs = [
  { title: "Licence required for H20 shipments to China", topic: 0, source: sec },
  { title: "Charge for excess H20 inventory", topic: 0, source: sec },
  { title: "Rules may expand to more countries", topic: 0, source: sec },
  { title: "Restrictions could favour competitors", topic: 0, source: sec },
  { title: "Wafers sourced from TSMC in Taiwan", topic: 1, source: sec },
  { title: "Packaging capacity is constrained", topic: 1, source: sec },
  { title: "Long-term supply commitments", topic: 1, source: sec },
  { title: "Memory supplier concentration", topic: 1, source: sec },
  { title: "Two direct customers above 10% of revenue", topic: 2, source: sec },
  { title: "Cloud providers drive Data Center growth", topic: 2, source: sec },
  { title: "Sovereign AI demand", topic: 2, source: sec },
  { title: "Customers may build their own chips", topic: 2, source: sec },
];

/* 8. Ask the corpus */
const askSql = `SELECT ticker,
       fiscal_quarter,
       SUM(value) / 1e9 AS capex_bn
FROM   facts
WHERE  concept = 'PaymentsToAcquirePropertyPlantAndEquipment'
  AND  ticker IN ('MSFT', 'GOOGL', 'AMZN', 'META')
  AND  period_end >= '2025-01-01'
GROUP  BY ticker, fiscal_quarter
ORDER  BY fiscal_quarter;`;
const askResult: AskYourDataResult = {
  title: "Quarterly capex, four largest cloud buyers",
  subtitle: "Q1 2025 to Q3 2026, $ billions",
  categoryLabel: "Quarter",
  categories: ["Q1 25", "Q2 25", "Q3 25", "Q4 25", "Q1 26", "Q2 26", "Q3 26"],
  series: [
    { id: "amzn", label: "Amazon", values: [24.3, 31.4, 34.2, 37.5, 39.1, 41.0, 43.2] },
    { id: "googl", label: "Alphabet", values: [17.2, 22.4, 24.0, 27.8, 28.5, 30.1, 31.0] },
    { id: "msft", label: "Microsoft", values: [16.7, 17.1, 19.4, 22.6, 24.0, 25.8, 26.4] },
    { id: "meta", label: "Meta", values: [13.7, 17.0, 19.4, 21.5, 22.1, 23.4, 24.8] },
  ],
  formatValue: v => `$${v.toFixed(1)}B`,
  insight: "Combined capex rose about 70% over the period, with Amazon the largest buyer every quarter.",
  rowCount: 28,
  durationMs: 412,
};
async function* streamSql() {
  for (const piece of askSql.split(/(\s+)/)) {
    await new Promise(r => setTimeout(r, 18));
    yield piece;
  }
}
async function runAsk(_sql: string, { onProgress, signal }: { onProgress: (n: number, t?: number) => void; signal: AbortSignal }) {
  for (let n = 0; n <= 2_880_000; n += 240_000) {
    if (signal.aborted) break;
    onProgress(n, 2_880_000);
    await new Promise(r => setTimeout(r, 70));
  }
  return askResult;
}

/* 9. AI answer */
const answerSources = [
  { id: "10q", title: "NVIDIA Form 10-Q, Q1 FY2026", site: "SEC EDGAR", domain: "sec.gov", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810", snippet: "The USG informed us that a licence is required for exports of H20 integrated circuits to China." },
  { id: "8k", title: "NVIDIA Form 8-K, April 2025", site: "SEC EDGAR", domain: "sec.gov", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810", snippet: "First quarter results are expected to include charges associated with H20 products." },
  { id: "fr", title: "Export controls on advanced computing items", site: "Federal Register", domain: "federalregister.gov", url: "https://www.federalregister.gov/" },
];
const answerText = `NVIDIA's China exposure now runs mostly through export licences rather than demand. [1]

## What changed
- A licence is now required to ship H20 chips to China. [1]
- The company flagged charges for H20 inventory and purchase obligations. [2]
- The rules can be widened to more countries and products. [3]

## What to watch
| Signal | Where it shows up |
| --- | --- |
| China share of revenue | 10-K revenue by geography |
| Inventory charges | 10-Q gross margin note |
| New rules | Federal Register |`;
async function* respond({ signal }: { signal: AbortSignal }): AsyncIterable<AnswerEvent> {
  const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
  for (const part of ["Read the latest 10-Q risk factors and the April 8-K. ", "Compare with the Federal Register rule text."]) {
    if (signal.aborted) return;
    await wait(500);
    yield { type: "reasoning", text: part };
  }
  yield { type: "sources", sources: answerSources };
  yield { type: "thought", seconds: 4 };
  for (const piece of answerText.split(/(\s+)/)) {
    if (signal.aborted) return;
    await wait(22);
    yield { type: "text", text: piece };
  }
  yield { type: "done", tokens: 612, followUps: ["How large was the H20 charge?", "Which peers sell into China?", "Show China revenue by year"] };
}

/* 10. Insight card */
const fmtB = (v: number) => `$${(v / 1e9).toFixed(1)}B`;
const insightMetric: InsightMetric = {
  label: "Data Center revenue",
  period: "Q3 FY26",
  value: 51.2e9,
  previous: 41.1e9,
  comparisonLabel: "vs Q2 FY26",
  series: [18.4e9, 22.6e9, 26.3e9, 30.8e9, 35.6e9, 39.1e9, 41.1e9, 51.2e9],
  previousSeries: [10.3e9, 14.5e9, 18.4e9, 22.6e9, 26.3e9, 30.8e9, 35.6e9, 39.1e9],
  points: ["Q4 FY24", "Q1 FY25", "Q2 FY25", "Q3 FY25", "Q4 FY25", "Q1 FY26", "Q2 FY26", "Q3 FY26"],
  seriesLabel: "This year",
  previousSeriesLabel: "A year earlier",
  format: fmtB,
};
const insight: Insight = {
  segments: [
    { text: "Revenue grew about 25% on the quarter. " },
    { text: "Most of it came from new rack-scale systems shipping to cloud providers, ", driver: "racks" },
    { text: "then networking, which grew faster than compute, ", driver: "net" },
    { text: "partly offset by lower H20 sales into China.", driver: "china" },
  ],
  drivers: [
    { id: "racks", label: "Rack-scale systems", delta: 8.1e9, point: 7 },
    { id: "net", label: "Networking", delta: 3.0e9, point: 6 },
    { id: "china", label: "China (H20)", delta: -1.0e9, point: 5 },
  ],
};

/* ---------- layout ---------- */
function Panel({ n, title, use, children, wide }: { n: number; title: string; use: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={`min-w-0 rounded-lg border border-border bg-card p-5 ${wide ? "lg:col-span-2" : ""}`}>
      <div className="mb-4 flex items-baseline gap-3">
        <span className="font-mono text-xs text-muted-foreground">{String(n).padStart(2, "0")}</span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="text-xs text-muted-foreground">{use}</p>
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function MotionGallery() {
  const tape = useLiveTape();
  const [mix, setMix] = useState<"fy25" | "fy23">("fy25");
  const [funnelView, setFunnelView] = useState("split");
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-7xl px-6 pb-6 pt-10">
        <p className="text-xs text-muted-foreground"><Link to="/mockups/arc-gallery" className="underline underline-offset-2">First twenty</Link> · Animated set</p>
        <h1 className="mt-2 text-2xl font-semibold">Animated components</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Ten larger, moving pieces fitted to Filed Under. Every figure here is illustrative and not checked against filings.
        </p>
      </header>
      <ArcScope>
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-6 pb-16 lg:grid-cols-2">
          <Panel n={21} title="Research terminal" use="Company page: candles, averages, watchlist and paper trades" wide>
            <MarketTerminal symbols={terminalSymbols} holdings={[{ ticker: "NVDA", shares: 40 }]} orders={[]} buyingPower={25000} defaultTicker="NVDA" />
          </Panel>
          <Panel n={22} title="Ask the corpus" use="Plain-English question becomes a query over sourced facts" wide>
            <AskYourData
              defaultQuestion="Quarterly capex for the four largest cloud buyers since 2025"
              source={{ name: "filed_under", dialect: "PostgreSQL" }}
              suggestions={["Capex by hyperscaler", "Insider selling at semis", "Banks' net interest margin"]}
              generateSql={() => streamSql()}
              runQuery={runAsk}
              autoRun
            />
          </Panel>
          <Panel n={23} title="Cited answer" use="Research agent answer where each citation lights its sentence" wide>
            <div className="h-[760px] overflow-hidden rounded-md"><AiAnswer question="How exposed is NVIDIA to China export rules?" respond={respond} /></div>
          </Panel>
          <Panel n={24} title="Explain the move" use="KPI card that names what drove the change">
            <AiInsightCard metric={insightMetric} insight={insight} followUps={[{ id: "seg", label: "Split by customer type", insight }]} />
          </Panel>
          <Panel n={25} title="Live tape" use="Intraday price with block-trade markers">
            <RealtimeStream points={tape} label="NVDA last price" unit="$" interval={1000} windowMs={60000} formatValue={v => `$${v.toFixed(2)}`} height={240} />
          </Panel>
          <Panel n={26} title="Earnings day replay" use="Watch the stock react as the release and call happen" wide>
            <LineReplay
              title="NVDA on results day"
              description="Shares traded every five minutes, millions, Eastern time. Dashed line is a typical day."
              data={replayData}
              moments={replayMoments}
              seriesLabel="Results day"
              baselineLabel="Typical day"
              valueLabel="Volume"
              formatTime={replayClock}
              formatTick={replayClock}
              formatValue={v => `${v.toFixed(1)}M`}
              autoPlay
            />
          </Panel>
          <Panel n={27} title="Sector strength vs. S&P 500" use="Fourteen sectors in the height of two charts" wide>
            <HorizonChart
              title="Relative return, last 90 days"
              description="Each row is a sector's return minus the S&P 500, in percentage points."
              series={horizonSeries}
              days={horizonDays}
              ticks={horizonTicks}
              baselineLabel="S&P 500"
              formatValue={v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)} pts`}
            />
          </Panel>
          <Panel n={28} title="Revenue mix" use="Segment shares that morph between years">
            <div className="mb-3">
              <SegmentedControl
                label="Fiscal year"
                value={mix}
                onValueChange={v => setMix(v as "fy25" | "fy23")}
                options={[{ value: "fy25", label: "FY25" }, { value: "fy23", label: "FY23" }]}
              />
            </div>
            <DonutChart data={mixSets[mix]} label="NVIDIA revenue by segment" unit="$B" formatValue={v => `$${v.toFixed(1)}B`} />
          </Panel>
          <Panel n={29} title="From filing to verified fact" use="How much of the corpus survives each check">
            <div className="mb-3">
              <SegmentedControl
                label="Funnel view"
                value={funnelView}
                onValueChange={setFunnelView}
                options={[{ value: "split", label: "Split" }, { value: "total", label: "Total" }, { value: "periodic", label: "10-K / 10-Q" }, { value: "current", label: "8-K" }]}
              />
            </div>
            <FunnelChart stages={funnelStages} segments={funnelSegments} view={funnelView} label="Document pipeline" unit="documents" />
          </Panel>
          <Panel n={30} title="Semantic filing search" use="A question finds the nearest passages across filings" wide>
            <VectorSearch topics={vsTopics} documents={vsDocs} query="Could export rules hurt China sales?" k={3} />
          </Panel>
        </div>
      </ArcScope>
    </main>
  );
}
