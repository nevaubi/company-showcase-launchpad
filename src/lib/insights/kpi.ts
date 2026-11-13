import { queryOptions } from "@tanstack/react-query";
import { partnerFile } from "@/lib/data";

// kpi_insights/{T}.json and kpi_insights/index.json from etl/kpi_insights.py: signals detected in code over the
// company's reported KPIs (IR releases and workbooks, with document/page/cell sources), guidance outcomes, federal
// contracts, lobbying, trading and congressional records, plus model-written insights that passed a numbers check
// and a second-model check.

export type KpiInsightKind =
  | "trend"
  | "mix"
  | "units"
  | "margin"
  | "peers"
  | "guidance"
  | "contracts"
  | "policy"
  | "trading"
  | "congress"
  | "reaction"
  | "analysts"
  | "other";

export interface KpiSource {
  /** Document id in the pipeline's store */
  doc?: string;
  /** Page of that document; some files carry it as text */
  page?: number | string;
  sheet?: string;
  cell?: string;
  quote?: string;
  url?: string;
  doc_title?: string;
  label?: string;
  path?: string;
}

export interface KpiChart {
  name: string;
  unit?: string | null;
  points: [string, number][];
  comp?: { name: string; unit?: string | null; points: [string, number][] };
}

export interface KpiSignal {
  kind: KpiInsightKind;
  strength: number;
  reason: string;
  facts: string[];
  kpi?: string;
  chart?: KpiChart;
}

export interface KpiInsight {
  title: string;
  text: string;
  kind: KpiInsightKind;
  refs: string[];
}

export interface KpiInsightsFile {
  ticker: string;
  name: string;
  sector: string;
  generated: string;
  run_id: string;
  status: "ok" | "all_dropped" | "signals_only" | "model_failed" | "too_few_signals";
  insights: KpiInsight[];
  dropped: { title?: string; text: string; reason: string }[];
  models: { draft?: string; check?: string | null };
  signals: KpiSignal[];
  facts: Record<string, { text: string; sources: KpiSource[] }>;
  kpi_count: number;
  label: string;
}

export interface KpiIndexRow {
  ticker: string;
  name?: string;
  sector?: string;
  generated: string;
  status: KpiInsightsFile["status"];
  n_insights: number;
  n_signals: number;
  kinds: KpiInsightKind[];
  strength: number;
  reason?: string;
  top: { title: string; text: string; kind: KpiInsightKind } | null;
  signals: { kind: KpiInsightKind; reason: string; strength: number }[];
}

export interface KpiIndexFile {
  generated: string;
  count: number;
  companies: Record<string, KpiIndexRow>;
  order: string[];
  method: string;
}

export const KIND_LABEL: Record<KpiInsightKind, string> = {
  trend: "KPI trend",
  mix: "Mix",
  units: "Volume vs revenue",
  margin: "Margin",
  peers: "Vs peers",
  guidance: "Guidance",
  contracts: "Federal contracts",
  policy: "Lobbying & policy",
  trading: "Trading",
  congress: "Congress",
  reaction: "Price reaction",
  analysts: "Analysts",
  other: "Other",
};

export const KIND_ORDER: KpiInsightKind[] = [
  "trend",
  "mix",
  "units",
  "margin",
  "peers",
  "guidance",
  "reaction",
  "contracts",
  "policy",
  "trading",
  "congress",
  "analysts",
];

export const kpiInsightsQuery = (t: string) =>
  queryOptions({
    queryKey: ["kpi-insights", t],
    queryFn: () => partnerFile<KpiInsightsFile>(`kpi_insights/${t}.json`),
    staleTime: 30 * 60_000,
    retry: 0,
  });

export const kpiInsightsIndexQuery = queryOptions({
  queryKey: ["kpi-insights", "index"],
  queryFn: () => partnerFile<KpiIndexFile>("kpi_insights/index.json"),
  staleTime: 15 * 60_000,
  retry: 1,
});

/** The chart attached to the signal that produced any of these facts (the first match). */
export function chartFor(f: KpiInsightsFile, refs: string[]): KpiChart | undefined {
  for (const s of f.signals) if (s.chart && s.facts.some((x) => refs.includes(x))) return s.chart;
  return undefined;
}

/** What the page shows: model insights when there are any, otherwise the strongest detected signals. */
export function cardsOf(f: KpiInsightsFile, limit = 6) {
  if (f.insights.length)
    return f.insights.slice(0, limit).map((i) => ({
      title: i.title,
      text: i.text,
      kind: i.kind,
      refs: i.refs,
      model: true as const,
    }));
  return f.signals.slice(0, limit).map((s) => ({
    title: s.reason,
    text: f.facts[s.facts[0]]?.text ?? "",
    kind: s.kind,
    refs: s.facts,
    model: false as const,
  }));
}

export interface IndexFilter {
  sector: string;
  kind: KpiInsightKind | "all";
  scope: "all" | "watchlist";
  q: string;
  withInsights: boolean;
}

export function filterIndex(rows: KpiIndexRow[], f: IndexFilter, watch: Set<string>): KpiIndexRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (f.sector === "all" || r.sector === f.sector) &&
      (f.kind === "all" || r.kinds.includes(f.kind)) &&
      (f.scope === "all" || watch.has(r.ticker)) &&
      (!f.withInsights || r.n_insights > 0) &&
      (!q ||
        r.ticker.toLowerCase().includes(q) ||
        (r.name ?? "").toLowerCase().includes(q) ||
        (r.top?.title ?? r.reason ?? "").toLowerCase().includes(q)),
  );
}

/** Index rows in display order: companies with written insights first, then by signal strength. */
export function orderedRows(idx: KpiIndexFile | undefined): KpiIndexRow[] {
  if (!idx) return [];
  return Object.values(idx.companies).sort(
    (a, b) => (b.n_insights > 0 ? 1 : 0) - (a.n_insights > 0 ? 1 : 0) || b.strength - a.strength,
  );
}

/** Format a chart value for a tooltip in the chart's unit. */
export function fmtChartValue(v: number, unit?: string | null): string {
  const u = (unit ?? "").toLowerCase();
  if (u === "%" || u === "pct") return `${v.toFixed(1)}%`;
  if (u === "usd") {
    const a = Math.abs(v);
    if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
    if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
    return `$${v.toLocaleString()}`;
  }
  if (Number.isInteger(v) || Math.abs(v) >= 100) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return v.toFixed(2);
}
