// Renders any canvas view spec (leaf views and dashboards with sections/tabs), each inside an error
// boundary that reports render failures back to the agent.
import { Component, useEffect, useState, type ReactNode } from "react";
import { ResearchMarkdown } from "@/components/research/markdown";
import { tableOf, type DashSection, type LeafSpec, type ViewSpec } from "@/lib/research/view-spec";
import { cn } from "@/lib/utils";
import { CandlesView, CartesianView, DonutView, HBarView, HistogramView, MultiplesView, ScatterView, WaterfallView } from "./charts";
import { DataTable, Figure } from "./figure";
import { CardsView, GraphView, HeatmapView, KpisView, MermaidView, SparkTableView, TimelineView, TreemapView } from "./misc";

/** Default grid span per view type in a 4-column canvas. */
export function defaultSpan(s: LeafSpec | ViewSpec): number {
  if (s.span) return s.span;
  switch (s.type) {
    case "kpis":
    case "table":
    case "sparktable":
    case "candles":
    case "heatmap":
    case "multiples":
    case "dashboard":
    case "treemap":
    case "graph":
    case "mermaid":
      return 4;
    case "cards":
    case "chart":
    case "scatter":
    case "waterfall":
    case "note":
    case "code":
      return 2;
    default:
      return 2;
  }
}

/** Static Tailwind classes: 1 column, 2 at @xl, up to 4 at @4xl (container widths of the canvas). */
const SPAN: Record<number, string> = {
  1: "@xl:col-span-1 @4xl:col-span-1",
  2: "@xl:col-span-2 @4xl:col-span-2",
  3: "@xl:col-span-2 @4xl:col-span-3",
  4: "@xl:col-span-2 @4xl:col-span-4",
};
const COLS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 @xl:grid-cols-2",
  3: "grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-3",
  4: "grid-cols-1 @xl:grid-cols-2 @4xl:grid-cols-4",
};
export const spanClass = (span: number, columns = 4) => SPAN[Math.max(1, Math.min(span, columns))];
export const colsClass = (columns: number) => COLS[Math.max(1, Math.min(columns, 4))];

class Boundary extends Component<{ onError?: (m: string) => void; children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message || "render failed" };
  }
  override componentDidCatch(e: Error) {
    this.props.onError?.(e.message || "render failed");
  }
  override render() {
    if (this.state.error) return <p className="py-6 text-center text-[12px] text-muted-foreground">This view could not be drawn.</p>;
    return this.props.children;
  }
}

function Body({ spec, onError }: { spec: LeafSpec; onError?: (m: string) => void }) {
  switch (spec.type) {
    case "kpis":
      return <KpisView spec={spec} />;
    case "cards":
      return <CardsView spec={spec} />;
    case "chart":
      return <CartesianView spec={spec} />;
    case "hbar":
      return <HBarView spec={spec} />;
    case "scatter":
      return <ScatterView spec={spec} />;
    case "histogram":
      return <HistogramView spec={spec} />;
    case "heatmap":
      return <HeatmapView spec={spec} />;
    case "waterfall":
      return <WaterfallView spec={spec} />;
    case "sparktable":
      return <SparkTableView spec={spec} />;
    case "candles":
      return <CandlesView spec={spec} />;
    case "treemap":
      return <TreemapView spec={spec} />;
    case "donut":
      return <DonutView spec={spec} />;
    case "multiples":
      return <MultiplesView spec={spec} />;
    case "timeline":
      return <TimelineView spec={spec} />;
    case "graph":
      return <GraphView spec={spec} />;
    case "mermaid":
      return <MermaidView spec={spec} onError={onError} />;
    case "table":
      return <DataTable table={{ columns: spec.columns, rows: spec.rows }} />;
    case "note":
      return <ResearchMarkdown className="text-[13px] leading-relaxed">{spec.markdown}</ResearchMarkdown>;
    case "code":
      return <CodeBody spec={spec} />;
    case "image":
      return (
        <figure>
          <img src={spec.src} alt={spec.caption ?? spec.title ?? "Image"} className="max-h-96 w-full rounded-md border object-contain" loading="lazy" />
          {spec.caption && <figcaption className="mt-1 text-[11px] text-muted-foreground">{spec.caption}</figcaption>}
        </figure>
      );
    case "file":
      return null; // rendered by the canvas (needs the file store)
  }
}

function CodeBody({ spec }: { spec: Extract<LeafSpec, { type: "code" }> }) {
  const [showCode, setShowCode] = useState(false);
  return (
    <div className="grid gap-1.5 text-[11px]">
      <button type="button" onClick={() => setShowCode((s) => !s)} className="w-fit text-[11px] text-muted-foreground underline-offset-2 hover:underline">
        {showCode ? "Hide code" : "Show code"}
      </button>
      {showCode && <pre className="max-h-64 overflow-auto rounded-md border bg-muted/40 p-2 font-mono leading-relaxed scrollbar-thin">{spec.code}</pre>}
      {spec.stdout && <pre className="max-h-64 overflow-auto rounded-md border bg-background p-2 font-mono leading-relaxed scrollbar-thin">{spec.stdout}</pre>}
      {spec.result && <pre className="max-h-64 overflow-auto rounded-md border bg-background p-2 font-mono leading-relaxed scrollbar-thin">{spec.result}</pre>}
      {spec.error && <p className="rounded-md border bg-muted/40 p-2 text-muted-foreground">The code stopped with an error; the assistant has the details.</p>}
    </div>
  );
}

const unitOf = (s: LeafSpec) => ("unit" in s ? (s.unit as never) : undefined);

/** One leaf view with its title block, source line and data toggle. */
export function LeafView({ spec, onError, renderFile, chrome = true }: { spec: LeafSpec; onError?: (m: string) => void; renderFile?: (id: string) => ReactNode; chrome?: boolean }) {
  const body = spec.type === "file" ? renderFile?.(spec.fileId) : <Body spec={spec} onError={onError} />;
  const inner = <Boundary onError={onError}>{body}</Boundary>;
  if (!chrome) return inner;
  const table = spec.type === "table" || spec.type === "note" || spec.type === "code" || spec.type === "file" || spec.type === "image" || spec.type === "kpis" || spec.type === "cards" ? null : tableOf(spec);
  return (
    <Figure title={spec.title} subtitle={spec.subtitle} source={spec.source} unit={unitOf(spec)} table={table}>
      {inner}
    </Figure>
  );
}

function SectionView({ sec, onError, renderFile }: { sec: DashSection; onError?: (m: string) => void; renderFile?: (id: string) => ReactNode }) {
  return (
    <section className="min-w-0" aria-label={sec.heading}>
      {sec.heading && <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{sec.heading}</h3>}
      <div className={cn("grid gap-3", colsClass(sec.columns))}>
        {sec.items.map((it, i) => (
          <div key={i} className={cn("min-w-0 rounded-md border bg-background p-3", spanClass(it.span ?? Math.min(defaultSpan(it), sec.columns), sec.columns))}>
            <LeafView spec={it} onError={onError} renderFile={renderFile} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function DashboardView({ spec, onError, renderFile }: { spec: Extract<ViewSpec, { type: "dashboard" }>; onError?: (m: string) => void; renderFile?: (id: string) => ReactNode }) {
  const [tab, setTab] = useState(0);
  const tabs = spec.tabs ?? [];
  const sections = tabs.length ? tabs[Math.min(tab, tabs.length - 1)].sections : (spec.sections ?? []);
  return (
    <div className="grid gap-4">
      {(spec.title || spec.subtitle) && (
        <div>
          {spec.title && <p className="text-[14px] font-semibold">{spec.title}</p>}
          {spec.subtitle && <p className="text-[12px] text-muted-foreground">{spec.subtitle}</p>}
        </div>
      )}
      {tabs.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b" role="tablist">
          {tabs.map((t, i) => (
            <button key={t.label} type="button" role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
              className={cn("-mb-px border-b-2 px-2.5 py-1.5 text-[12px] transition-colors", tab === i ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {sections.map((sec, i) => (
        <SectionView key={`${tab}-${i}`} sec={sec} onError={onError} renderFile={renderFile} />
      ))}
      {spec.source && <p className="text-[10.5px] text-muted-foreground">Source: {spec.source}</p>}
    </div>
  );
}

/** Any view; reports "rendered" once mounted without errors. */
export function ViewRenderer({ spec, onStatus, renderFile }: { spec: ViewSpec; onStatus?: (s: { ok: boolean; error?: string }) => void; renderFile?: (id: string) => ReactNode }) {
  const [failed, setFailed] = useState<string | null>(null);
  const onError = (m: string) => {
    setFailed(m);
    onStatus?.({ ok: false, error: m });
  };
  useEffect(() => {
    const t = setTimeout(() => {
      if (!failed) onStatus?.({ ok: true });
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return spec.type === "dashboard" ? <DashboardView spec={spec} onError={onError} renderFile={renderFile} /> : <LeafView spec={spec} onError={onError} renderFile={renderFile} />;
}
