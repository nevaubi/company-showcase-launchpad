import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ArcScope } from "@/components/arc/arc-scope";
import { BrushChart } from "@/components/arc/brush-chart/brush-chart";
import { SlopeChart } from "@/components/arc/slope-chart/slope-chart";
import { Treemap } from "@/components/arc/treemap/treemap";
import { Ridgeline } from "@/components/arc/ridgeline/ridgeline";
import { Streamgraph } from "@/components/arc/streamgraph/streamgraph";
import { WaffleChart } from "@/components/arc/waffle-chart/waffle-chart";
import { ActivityHeatmap } from "@/components/arc/activity-heatmap/activity-heatmap";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { ReasoningBlock } from "@/components/arc/reasoning-block/reasoning-block";
import { SourceCards } from "@/components/arc/source-cards/source-cards";
import { ToolCall, ToolCallGroup } from "@/components/arc/tool-call/tool-call";
import { AgentPlan } from "@/components/arc/agent-plan/agent-plan";
import { AgentStatus } from "@/components/arc/agent-status/agent-status";
import { SankeyFlow } from "@/components/arc/sankey-flow/sankey-flow";
import { Sunburst } from "@/components/arc/sunburst/sunburst";
import { RadarChart } from "@/components/arc/radar-chart/radar-chart";
import { RaceBarChart } from "@/components/arc/race-bar-chart/race-bar-chart";
import { MetricTicker } from "@/components/arc/metric-ticker/metric-ticker";
import { SplitBar } from "@/components/arc/split-bar/split-bar";
import { DataFlow } from "@/components/arc/data-flow/data-flow";

export const Route = createFileRoute("/mockups/arc-gallery")({
  head: () => ({
    meta: [
      { title: "Component gallery · Filed Under" },
      { name: "description", content: "Twenty research components for Filed Under, shown with illustrative data." },
      { property: "og:title", content: "Component gallery · Filed Under" },
      { property: "og:description", content: "Twenty research components for Filed Under, shown with illustrative data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Gallery,
});

const pct = (v: number) => `${v.toFixed(1)}%`;

/* ---------- illustrative data (not verified against filings) ---------- */
const DAY = 864e5;
const start = Date.UTC(2023, 0, 2);
const price = Array.from({ length: 700 }, (_, i) => {
  const t = i / 699;
  return { date: start + i * DAY, value: 15 + 120 * t * t + 6 * Math.sin(i / 17) + 3 * Math.sin(i / 5) };
});
const priceNotes = [
  { date: start + 143 * DAY, label: "Q1 FY24 10-Q", description: "Data Center guide raised" },
  { date: start + 420 * DAY, label: "10-K", description: "Annual report filed" },
  { date: start + 610 * DAY, label: "H20 8-K", description: "Export licence requirement disclosed" },
];

const sankeyNodes = [
  { id: "dc", label: "Data Center", column: 0 }, { id: "gm", label: "Gaming", column: 0 }, { id: "ot", label: "Other", column: 0 },
  { id: "rev", label: "Revenue", column: 1 },
  { id: "cogs", label: "Cost of revenue", column: 2 }, { id: "gp", label: "Gross profit", column: 2 },
  { id: "rd", label: "R&D", column: 3 }, { id: "sga", label: "SG&A", column: 3 }, { id: "oi", label: "Operating income", column: 3 },
];
const sankeyLinks = [
  { source: "dc", target: "rev", value: 115.2 }, { source: "gm", target: "rev", value: 11.4 }, { source: "ot", target: "rev", value: 3.9 },
  { source: "rev", target: "cogs", value: 32.6 }, { source: "rev", target: "gp", value: 97.9 },
  { source: "gp", target: "rd", value: 12.9 }, { source: "gp", target: "sga", value: 3.5 }, { source: "gp", target: "oi", value: 81.5 },
];

const segTree = {
  id: "aapl", label: "Apple revenue",
  children: [
    { id: "prod", label: "Products", children: [
      { id: "iph", label: "iPhone", value: 201 }, { id: "mac", label: "Mac", value: 30 }, { id: "ipad", label: "iPad", value: 27 }, { id: "wear", label: "Wearables", value: 37 },
    ] },
    { id: "svc", label: "Services", children: [
      { id: "app", label: "App Store", value: 30 }, { id: "ads", label: "Advertising", value: 12 }, { id: "cloud", label: "iCloud", value: 22 }, { id: "lic", label: "Licensing", value: 22 }, { id: "oth", label: "Other services", value: 10 },
    ] },
  ],
};

const sectorTree = {
  id: "sp", label: "Coverage market cap",
  children: [
    { id: "it", label: "Info tech", children: [{ id: "nvda", label: "NVDA", value: 4.4, color: 52 }, { id: "msft", label: "MSFT", value: 3.7, color: 18 }, { id: "aapl2", label: "AAPL", value: 3.4, color: 7 }, { id: "avgo", label: "AVGO", value: 1.6, color: 41 }] },
    { id: "cs", label: "Comm services", children: [{ id: "goog", label: "GOOGL", value: 2.6, color: 22 }, { id: "meta", label: "META", value: 1.8, color: 30 }] },
    { id: "cd", label: "Consumer disc.", children: [{ id: "amzn", label: "AMZN", value: 2.4, color: 15 }, { id: "tsla", label: "TSLA", value: 1.3, color: -9 }] },
    { id: "fin", label: "Financials", children: [{ id: "jpm", label: "JPM", value: 0.8, color: 24 }, { id: "v", label: "V", value: 0.7, color: 12 }] },
  ],
};

const radarAxes = [
  { key: "growth", label: "Revenue growth" }, { key: "margin", label: "Operating margin" }, { key: "fcf", label: "FCF conversion" },
  { key: "val", label: "Valuation (inverse)" }, { key: "rnd", label: "R&D intensity" }, { key: "conc", label: "Customer diversity" },
];
const radarSeries = [
  { key: "nvda", label: "NVIDIA", values: { growth: 96, margin: 92, fcf: 84, val: 35, rnd: 60, conc: 30 } },
  { key: "amd", label: "AMD", values: { growth: 55, margin: 40, fcf: 58, val: 45, rnd: 88, conc: 62 } },
  { key: "avgo", label: "Broadcom", values: { growth: 60, margin: 70, fcf: 95, val: 50, rnd: 55, conc: 48 } },
];

const raceItems = ["NVDA", "MSFT", "AAPL", "GOOGL", "AMZN", "META", "AVGO", "TSLA"].map(id => ({ id, label: id }));
const raceFrames = [
  { period: "2021", values: { AAPL: 2.9, MSFT: 2.5, GOOGL: 1.9, AMZN: 1.7, TSLA: 1.1, META: 0.9, NVDA: 0.7, AVGO: 0.3 } },
  { period: "2022", values: { AAPL: 2.1, MSFT: 1.8, GOOGL: 1.1, AMZN: 0.9, TSLA: 0.4, META: 0.3, NVDA: 0.4, AVGO: 0.2 } },
  { period: "2023", values: { AAPL: 3.0, MSFT: 2.8, GOOGL: 1.8, AMZN: 1.6, TSLA: 0.8, META: 0.9, NVDA: 1.2, AVGO: 0.5 } },
  { period: "2024", values: { AAPL: 3.8, MSFT: 3.1, GOOGL: 2.3, AMZN: 2.3, TSLA: 1.3, META: 1.5, NVDA: 3.3, AVGO: 1.1 } },
  { period: "2025", values: { AAPL: 3.4, MSFT: 3.7, GOOGL: 2.6, AMZN: 2.4, TSLA: 1.3, META: 1.8, NVDA: 4.4, AVGO: 1.6 } },
];

const slope = [
  { key: "risk", label: "Risk factors", start: 14200, end: 16900 },
  { key: "md", label: "MD&A", start: 9800, end: 10400 },
  { key: "legal", label: "Legal proceedings", start: 1200, end: 2900 },
  { key: "ctrl", label: "Export controls", start: 600, end: 2400 },
  { key: "cust", label: "Customer concentration", start: 900, end: 1100 },
];

const ridge = ["Semis", "Software", "Banks", "Pharma", "Retail"].map((label, k) => ({
  id: label, label,
  values: Array.from({ length: 80 }, (_, i) => Math.sin(i * 12.9898 + k * 78.233) * (3 + k) + (k === 0 ? 1.5 : 0) + Math.cos(i * 4.1) * 2),
}));

const streamSeries = [
  { key: "10k", label: "10-K / 10-Q" }, { key: "8k", label: "8-K" }, { key: "f4", label: "Form 4" }, { key: "13", label: "13D / 13G" },
];
const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct"];
const stream = months.map((m, i) => ({
  key: m, label: `${m} 2026`, axisLabel: m,
  values: { "10k": [40, 320, 60, 290, 80, 50, 300, 70, 60, 310][i], "8k": 180 + 40 * Math.sin(i), f4: 260 + 90 * Math.cos(i / 2), "13": 60 + 20 * i },
}));

const waffle = [
  { key: "us", label: "United States", value: 47 }, { key: "tw", label: "Taiwan", value: 19 },
  { key: "cn", label: "China", value: 13 }, { key: "sg", label: "Singapore", value: 12 }, { key: "ot", label: "Other", value: 9 },
];

const heat = Array.from({ length: 365 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1) + i * DAY);
  const wd = d.getUTCDay();
  return { date: d.toISOString().slice(0, 10), count: wd === 0 || wd === 6 ? 0 : Math.max(0, Math.round(3 + 4 * Math.sin(i / 9) + ((i * 7) % 5))) };
});

const ticker = [
  { id: "spy", label: "SPY", value: 682.4, format: { style: "currency", currency: "USD" } as const, history: [671, 675, 678, 676, 680, 682.4] },
  { id: "nvda", label: "NVDA", value: 191.2, format: { style: "currency", currency: "USD" } as const, history: [184, 186, 189, 187, 190, 191.2] },
  { id: "us10", label: "US 10Y", value: 4.12, format: { maximumFractionDigits: 2 }, delta: "absolute" as const, positive: "down" as const },
  { id: "vix", label: "VIX", value: 15.8, format: { maximumFractionDigits: 1 }, positive: "down" as const },
  { id: "aapl", label: "AAPL", value: 268.9, format: { style: "currency", currency: "USD" } as const },
  { id: "jpm", label: "JPM", value: 311.5, format: { style: "currency", currency: "USD" } as const },
];

const split = [
  { id: "a", label: "Customer A", value: 16 }, { id: "b", label: "Customer B", value: 14 },
  { id: "c", label: "Customer C", value: 12 }, { id: "d", label: "Direct (other)", value: 31 }, { id: "o", label: "Indirect", value: 27 },
];

const toolCalls = [
  { id: "t1", tool: "web" as const, title: "Searched SEC filings for NVDA capex commentary", status: "success" as const, durationMs: 1840,
    input: { query: "NVIDIA 10-Q data center capex hyperscaler", forms: ["10-Q", "10-K"] },
    output: { type: "list" as const, items: [{ lead: "10-Q", title: "Q2 FY26 quarterly report", tag: "Aug 2026" }, { lead: "10-K", title: "FY25 annual report", tag: "Feb 2026" }] } },
  { id: "t2", tool: { name: "Financials", mark: <span style={{ fontSize: 11, fontWeight: 700 }}>$</span> }, title: "Read capex lines for MSFT, GOOGL, AMZN, META", status: "success" as const, durationMs: 920,
    output: { type: "table" as const, columns: ["Ticker", "Capex TTM"], rows: [["MSFT", "$64.6B"], ["GOOGL", "$71.2B"], ["AMZN", "$108.4B"], ["META", "$52.9B"]] } },
  { id: "t3", tool: { name: "Calculator", mark: <span style={{ fontSize: 11, fontWeight: 700 }}>ƒ</span> }, title: "Computed year-on-year capex growth", titles: { running: "Computing year-on-year capex growth" }, status: "running" as const },
];

const reasoning = [
  { title: "Framing the question", text: "Hyperscaler capex is the demand signal for NVIDIA Data Center. I need trailing capex for the four largest buyers and its growth rate." },
  { title: "Checking the sources", text: "Capex comes from each company's cash flow statement (PaymentsToAcquirePropertyPlantAndEquipment). Every figure should link to its 10-Q." },
  { title: "Reconciling", text: "Amazon includes finance leases; I will note that rather than mix definitions." },
];

const sources = [
  { title: "NVIDIA Corporation Form 10-Q, Q2 FY2026", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001045810", site: "SEC EDGAR", snippet: "Data Center revenue was driven by demand from large cloud service providers.", published: "Aug 27, 2026" },
  { title: "Microsoft Form 10-Q, Q1 FY2027", url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000789019", site: "SEC EDGAR", snippet: "Additions to property and equipment increased, driven by cloud and AI infrastructure.", published: "Oct 29, 2026" },
  { title: "Alphabet Q3 2026 earnings release", url: "https://abc.xyz/investor/", site: "Alphabet IR", snippet: "We continue to invest in technical infrastructure.", published: "Oct 28, 2026" },
  { title: "Federal Register: export controls on advanced computing", url: "https://www.federalregister.gov/", site: "Federal Register", published: "Apr 2026" },
];

const plan = [
  { id: "p1", title: "Pull trailing capex for the four hyperscalers", state: "done" as const, duration: 6 },
  { id: "p2", title: "Match capex to NVIDIA Data Center revenue by quarter", state: "done" as const, duration: 9 },
  { id: "p3", title: "Check supply-chain page for customer concentration", state: "active" as const, substeps: ["Read 10-K customer note", "Opened supply map"] },
  { id: "p4", title: "Chart capex vs. Data Center revenue" },
  { id: "p5", title: "Write a cited answer" },
];

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

function Gallery() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-7xl px-6 pb-6 pt-10">
        <h1 className="text-2xl font-semibold">Component gallery</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Twenty Arc components fitted to Filed Under. All data here is illustrative and not checked against filings.
        </p>
      </header>
      <ArcScope>
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-6 pb-16 lg:grid-cols-2">
          <Panel n={1} title="Market ticker" use="Watchlist strip on every page" wide>
            <MetricTicker metrics={ticker} />
          </Panel>
          <Panel n={2} title="Price history with filing events" use="Company page price chart" wide>
            <BrushChart data={price} label="NVDA close" unit="USD" formatValue={v => `$${v.toFixed(2)}`} annotations={priceNotes} height={260} />
          </Panel>
          <Panel n={3} title="Income statement flow" use="Revenue to operating income, FY25" wide>
            <SankeyFlow nodes={sankeyNodes} links={sankeyLinks} label="NVIDIA FY25 income flow" columns={["Segment", "Revenue", "Gross", "Operating"]} formatValue={v => `$${v.toFixed(1)}B`} />
          </Panel>
          <Panel n={4} title="Segment drill-down" use="IR data: segments to line items">
            <Sunburst data={segTree} label="Apple revenue by segment" formatValue={v => `$${v.toFixed(0)}B`} />
          </Panel>
          <Panel n={5} title="Sector map" use="Size by market cap, shade by 1-year return">
            <Treemap data={sectorTree} label="Coverage market cap" formatValue={v => `$${v.toFixed(1)}T`} colorLabel="1-year return" formatColor={v => `${v.toFixed(0)}%`} height={340} />
          </Panel>
          <Panel n={6} title="Peer profile" use="Report peer comparison">
            <RadarChart axes={radarAxes} series={radarSeries} label="Semiconductor peer profile" />
          </Panel>
          <Panel n={7} title="Market cap race" use="Sector page leaderboard over time">
            <RaceBarChart items={raceItems} frames={raceFrames} label="Market cap" formatValue={v => `$${v.toFixed(1)}T`} formatTick={v => `$${v}T`} />
          </Panel>
          <Panel n={8} title="Filing section growth" use="Redlines: words per section, last year vs. this year">
            <SlopeChart data={slope} label="Words per section" startLabel="FY24 10-K" endLabel="FY25 10-K" formatValue={v => v.toLocaleString()} />
          </Panel>
          <Panel n={9} title="Customer concentration" use="Supply chain: share of revenue">
            <SplitBar segments={split} title="NVIDIA revenue by customer" unit="%" />
          </Panel>
          <Panel n={10} title="Revenue by geography" use="Each square is one percent">
            <WaffleChart data={waffle} label="Revenue by billing location" unit="%" />
          </Panel>
          <Panel n={11} title="Post-earnings moves" use="Distribution of next-day returns by sector">
            <Ridgeline series={ridge} label="Next-day return after earnings" unit="%" formatValue={pct} />
          </Panel>
          <Panel n={12} title="Filing mix" use="Alt data: SEC filings by type, 2026" wide>
            <Streamgraph data={stream} series={streamSeries} label="Filings by form" unit="filings" />
          </Panel>
          <Panel n={13} title="Insider filing calendar" use="Form 4 activity across coverage" wide>
            <ActivityHeatmap days={heat} label="Form 4 filings in 2026" period="2026" unit={{ one: "filing", other: "filings" } as never} />
          </Panel>
          <Panel n={14} title="Data pipeline" use="Landing page: sources into verified records" wide>
            <DataFlow
              sources={[{ label: "SEC EDGAR", meta: "10-K, 10-Q, 8-K" }, { label: "IR sites", meta: "Releases, decks" }, { label: "Market data", meta: "Prices, FRED" }]}
              core={{ label: "Verify", detail: "Every number keeps its accession and concept", countLabel: "facts sourced", countStart: 2880000 }}
              destinations={[{ label: "Statements" }, { label: "Reports" }, { label: "Alerts", share: 0.33 } as never]}
            />
          </Panel>
          <Panel n={15} title="Assistant status" use="Running research, collapsed in the header">
            <AgentStatus />
          </Panel>
          <Panel n={16} title="Thinking" use="Assistant reasoning with a shimmering label">
            <ReasoningBlock reasoning={reasoning} seconds={7} model={{ name: "Filed Under research" }} defaultOpen />
          </Panel>
          <Panel n={17} title="Research plan" use="Steps the assistant will take">
            <AgentPlan steps={plan} status="running" goal="Is hyperscaler capex still accelerating?" />
          </Panel>
          <Panel n={18} title="Tool calls" use="What the assistant looked up">
            <ToolCallGroup calls={toolCalls} />
          </Panel>
          <Panel n={19} title="Cited sources" use="Under every assistant answer" wide>
            <SourceCards sources={sources} status="done" query="hyperscaler capex NVIDIA data center" duration={2100} />
          </Panel>
          <Panel n={20} title="Working label" use="Loading states across the app">
            <p className="text-sm"><TextShimmer>Reading 14 filings and matching every figure to its source</TextShimmer></p>
            <div className="mt-4"><ToolCall {...toolCalls[0]} /></div>
          </Panel>
        </div>
      </ArcScope>
    </main>
  );
}
