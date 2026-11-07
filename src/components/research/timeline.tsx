// Tool-call timeline for the assistant: reasoning lines, running rows with a pixel loader and live
// timer, compact finished rows that expand, grouped repeats ("Read 4 web pages") and parallel batches.
import { useState } from "react";
import {
  AppWindow, AreaChart, BarChart3, BarChartHorizontal, Brain, CalendarRange, CandlestickChart, Gauge, GitBranch, Grid3x3, LayoutGrid, LineChart, Network as NetworkIcon, PieChart, ScatterChart, Table2, Workflow, ChevronRight, Code2, Compass, Download, FileSearch, Globe, Highlighter, LayoutDashboard, MessageCircleQuestion,
  MousePointerClick, Network, ScanText, ScrollText, TriangleAlert, Wrench,
} from "lucide-react";
import { PixelGrid, formatElapsed, useElapsed } from "@/components/ui/loading-state";
import type { Step } from "@/lib/research/loop";
import { argSummary, buildTimeline, type TimelineItem } from "@/lib/research/timeline";
import { viewLabel } from "@/lib/research/view-spec";
import { TOOL_GROUP, TOOL_LABELS, TOOL_RUNNING } from "@/lib/research/tool-defs";
import { cn } from "@/lib/utils";

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

const VIEW_ICON: Record<string, typeof LineChart> = {
  line: LineChart, area: AreaChart, bar: BarChart3, combo: BarChart3, stacked: BarChart3, stacked100: BarChart3, hbar: BarChartHorizontal,
  scatter: ScatterChart, histogram: BarChart3, heatmap: Grid3x3, waterfall: BarChart3, sparktable: Table2, table: Table2, candles: CandlestickChart,
  treemap: LayoutGrid, donut: PieChart, multiples: LayoutGrid, timeline: CalendarRange, cards: LayoutGrid, kpis: Gauge, mermaid: Workflow,
  graph: NetworkIcon, dashboard: LayoutDashboard, note: ScrollText, code: Code2, image: LayoutDashboard, file: Download,
};

/** Small type thumbnail for render_view rows. */
function ViewThumb({ type, className }: { type: string; className?: string }) {
  const I = VIEW_ICON[type] ?? LayoutDashboard;
  return (
    <span className={cn("grid size-4 shrink-0 place-items-center rounded-[3px] bg-chart-1/15 text-foreground/80", className)}>
      <I className="size-3" />
    </span>
  );
}

function StepIcon({ s, className }: { s: Step; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  if (s.name === "render_view" && s.status !== "error") return <ViewThumb type={viewLabel(s.args?.spec).type} />;
  if (s.name === "mermaid") return <GitBranch className={c} />;
  if (s.status === "error") return <TriangleAlert className={cn(c, "text-negative/80")} />;
  if (s.kind === "think") return <Brain className={c} />;
  const n = s.name;
  if (n === "run_code") return <Code2 className={c} />;
  if (n === "navigate_to" || n === "get_page_context") return <Compass className={c} />;
  if (n === "scroll_to" || n === "read_section") return <ScrollText className={c} />;
  if (n === "highlight") return <Highlighter className={c} />;
  if (n === "click") return <MousePointerClick className={c} />;
  if (n === "render_view" || n === "show_canvas") return <LayoutDashboard className={c} />;
  if (n === "create_file" || n === "browser_files") return <Download className={c} />;
  if (n.startsWith("browser_")) return <AppWindow className={c} />;
  if (n === "ask_user") return <MessageCircleQuestion className={c} />;
  if (n === "web_map" || n === "web_crawl") return <Network className={c} />;
  if (n === "web_extract" || n === "fetch_url") return <ScanText className={c} />;
  if (n.startsWith("read_") || n === "search_filings") return <FileSearch className={c} />;
  if (s.kind === "web" || n.startsWith("web_")) return <Globe className={c} />;
  return <Wrench className={c} />;
}

function Elapsed({ since }: { since?: number }) {
  const t = useElapsed(since);
  return <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">{t}</span>;
}

function Sources({ s }: { s: Step }) {
  if (!s.sources?.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1 pl-5">
      {s.sources.slice(0, 6).map((x) => (
        <a key={x.url} href={x.url} target="_blank" rel="noreferrer" title={x.title ?? x.url} className="inline-flex max-w-[150px] items-center gap-1 rounded border bg-card px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
          <img src={`https://www.google.com/s2/favicons?domain=${host(x.url)}&sz=32`} alt="" className="size-3 rounded-sm" loading="lazy" />
          <span className="truncate">{host(x.url)}</span>
        </a>
      ))}
    </div>
  );
}

function detailOf(s: Step) {
  const args = s.args ? Object.fromEntries(Object.entries(s.args).filter(([k]) => k !== "why")) : null;
  const a = args && Object.keys(args).length ? JSON.stringify(args, null, 1) : "";
  return { args: a.length > 2400 ? `${a.slice(0, 2400)}…` : a, output: s.output ?? "" };
}

function ToolRow({ s, compact }: { s: Step; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const running = s.status === "running";
  const error = s.status === "error";
  const label = running ? (TOOL_RUNNING[s.name] ?? TOOL_LABELS[s.name] ?? s.name) : (TOOL_LABELS[s.name] ?? s.name);
  const view = s.name === "render_view" ? viewLabel(s.args?.spec) : null;
  const brief = view ? view.title || s.why || view.type : s.why || argSummary(s.name, s.args ?? {}) || s.summary;
  // Spec validation errors go back to the model; the user sees a neutral line, never the raw message.
  const errorText = view ? "View needed a fix; the assistant is correcting it" : s.summary;
  const { args: rawArgs, output } = detailOf(s);
  // Never show the view spec JSON; the canvas shows the view.
  const args = view ? "" : rawArgs;
  const expandable = !running && (args || output || s.why);
  return (
    <div className="step-in min-w-0">
      <button
        type="button"
        onClick={() => expandable && setOpen((o) => !o)}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "group flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors",
          expandable && "hover:bg-muted/60",
          running && "bg-muted/40",
        )}
      >
        {running ? (
          view ? <span className="relative"><ViewThumb type={view.type} className="animate-pulse" /></span> : <PixelGrid variant={s.name.startsWith("browser_") ? "Orbit" : "Drive"} className="mx-[1px]" />
        ) : (
          <StepIcon s={s} className="text-muted-foreground" />
        )}
        <span className={cn("shrink-0 font-medium", running ? "text-shimmer" : error ? "text-muted-foreground" : "text-foreground/90")}>{label}</span>
        {!compact && <span className={cn("min-w-0 truncate text-muted-foreground", error && "text-negative/80")}>{error ? errorText : brief}</span>}
        {running ? (
          <Elapsed since={s.startedAt} />
        ) : (
          <>
            {!error && s.summary && s.summary !== brief && !compact && <span className="hidden min-w-0 max-w-[40%] shrink truncate text-[11px] text-muted-foreground/80 sm:inline">· {s.summary}</span>}
            {s.ms != null && s.ms >= 300 && <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">{formatElapsed(s.ms)}</span>}
            {expandable && <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:opacity-100", open && "rotate-90 opacity-100", !(s.ms != null && s.ms >= 300) && "ml-auto")} />}
          </>
        )}
      </button>
      {error && <p className="pl-[30px] text-[10.5px] text-muted-foreground">The agent sees this error and retries or changes approach.</p>}
      <Sources s={s} />
      {open && (
        <div className="step-in mb-1 ml-[30px] mt-0.5 grid gap-1.5 rounded-md border bg-muted/30 p-2 text-[10.5px]">
          {s.why && <p className="italic text-muted-foreground">{s.why}</p>}
          {args && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed text-muted-foreground scrollbar-thin">{args}</pre>
          )}
          {output && (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t pt-1.5 font-mono leading-relaxed text-foreground/80 scrollbar-thin">{output.length > 3000 ? `${output.slice(0, 3000)}…` : output}</pre>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkRow({ s }: { s: Step }) {
  const [open, setOpen] = useState(false);
  const more = (s.output ?? "").length > (s.summary ?? "").length + 8;
  return (
    <div className="step-in">
      <button type="button" onClick={() => more && setOpen((o) => !o)} className={cn("flex w-full min-w-0 items-start gap-2 px-1.5 py-0.5 text-left text-[11.5px] italic leading-snug text-muted-foreground", more && "hover:text-foreground")}>
        <Brain className="mt-[2px] size-3 shrink-0 opacity-70" />
        <span className={cn(!open && "line-clamp-2")}>{open ? s.output : s.summary}</span>
      </button>
    </div>
  );
}

function GroupRow({ steps }: { steps: Step[] }) {
  const [open, setOpen] = useState(false);
  const s0 = steps[0];
  const [verb, noun] = TOOL_GROUP[s0.name] ?? [TOOL_LABELS[s0.name] ?? s0.name, "times"];
  const ms = steps.reduce((t, s) => t + (s.ms ?? 0), 0);
  const sources = steps.flatMap((s) => s.sources ?? []);
  return (
    <div className="step-in min-w-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="group flex w-full min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-muted/60">
        <StepIcon s={s0} className="text-muted-foreground" />
        <span className="shrink-0 font-medium text-foreground/90">
          {verb} {steps.length} {noun}
        </span>
        <span className="min-w-0 truncate text-muted-foreground">{steps.map((s) => argSummary(s.name, s.args ?? {}) || s.summary).filter(Boolean).slice(0, 3).join(", ")}</span>
        {ms >= 300 && <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">{formatElapsed(ms)}</span>}
        <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", open && "rotate-90", ms < 300 && "ml-auto")} />
      </button>
      {!open && sources.length > 0 && <Sources s={{ ...s0, sources }} />}
      {open && (
        <div className="ml-3 border-l pl-2">
          {steps.map((s, i) => (
            <ToolRow key={i} s={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function ParallelRow({ steps }: { steps: Step[] }) {
  const running = steps.filter((s) => s.status === "running").length;
  return (
    <div className="step-in min-w-0 rounded-lg border border-dashed border-rule/80 p-1">
      <p className="px-1.5 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {steps.length} in parallel{running ? ` · ${running} running` : ""}
      </p>
      <div className="grid grid-cols-1 gap-0.5 min-[520px]:grid-cols-2">
        {steps.map((s, i) => (
          <ToolRow key={i} s={s} compact={steps.length > 2} />
        ))}
      </div>
    </div>
  );
}

function Item({ it }: { it: TimelineItem }) {
  if (it.type === "think") return <ThinkRow s={it.step} />;
  if (it.type === "group") return <GroupRow steps={it.steps} />;
  if (it.type === "parallel") return <ParallelRow steps={it.steps} />;
  return <ToolRow s={it.step} />;
}

export function Timeline({ steps, limit }: { steps: Step[]; limit?: number }) {
  const items = buildTimeline(steps);
  const shown = limit ? items.slice(-limit) : items;
  return (
    <div className="grid grid-cols-1 gap-0.5">
      {limit && items.length > shown.length && <p className="px-1.5 text-[10.5px] text-muted-foreground">{items.length - shown.length} earlier steps</p>}
      {shown.map((it, i) => (
        <Item key={`${it.type}-${i}`} it={it} />
      ))}
    </div>
  );
}
