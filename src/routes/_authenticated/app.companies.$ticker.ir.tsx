import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Download, FileSpreadsheet, FileText, Image as ImageIcon, Presentation, TriangleAlert } from "lucide-react";
import { Panel } from "@/components/app/page-header";
import { Segmented } from "@/components/app/segmented";
import { useSource } from "@/components/source/source-context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { extractNextIr, getIrData, getIrDownload } from "@/lib/ir.functions";
import { buildIrSeries, normLabel, type IrCell, type IrFact, type IrSeries } from "@/lib/ir/kpis";
import type { DerivedPart, SourceRef } from "@/lib/financials/types";
import { fmtCompact, fmtCompactUsd, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/ir")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.ticker.toUpperCase()} investor-relations data · Filed Under` },
      { name: "description", content: `Segment and KPI breakdowns from ${params.ticker.toUpperCase()}'s earnings releases and supplements, each linked to the exact table cell.` },
    ],
  }),
  component: IrPage,
});

const CATEGORY: Record<string, string> = { segment: "Segment", product: "Product & service", geography: "Geography", customer: "Customer", kpi: "Operating KPI" };
const METRIC: Record<string, string> = {
  revenue: "Revenue",
  operating_income: "Operating income",
  gross_profit: "Gross profit",
  gross_margin: "Gross margin",
  cost: "Costs",
  units: "Units",
  users: "Users",
  backlog: "Backlog",
  other: "Other",
};

function fmtVal(v: number, unit: string) {
  if (unit === "usd") return fmtCompactUsd(v, 2);
  if (unit === "pct") return `${v.toFixed(1)}%`;
  if (unit === "usdPerShare") return `$${v.toFixed(2)}`;
  if (unit === "ratio") return `${v.toFixed(2)}×`;
  return fmtCompact(v, 2);
}

/** Order a group's series as a tree: each total followed by its children (subtotals expand in place). */
function orderTree(group: IrSeries[]): { s: IrSeries; depth: number }[] {
  const out: { s: IrSeries; depth: number }[] = [];
  const seen = new Set<IrSeries>();
  const kidsOf = (t: IrSeries) => group.filter((s) => s !== t && s.parent && normLabel(s.parent) === normLabel(t.label));
  const walk = (s: IrSeries, depth: number) => {
    if (seen.has(s)) return;
    seen.add(s);
    out.push({ s, depth });
    for (const k of kidsOf(s).sort((a, b) => Number(b.isTotal) - Number(a.isTotal))) walk(k, depth + 1);
  };
  const roots = group.filter((s) => s.isTotal && !group.some((t) => t !== s && s.parent && normLabel(s.parent) === normLabel(t.label)));
  for (const r of roots) walk(r, 0);
  for (const s of group) walk(s, 0);
  return out;
}

const refOf = (f: IrFact, value = f.value): SourceRef => ({
  accn: f.accn ?? "",
  concept: `${f.document_kind === "presentation" ? "Presentation" : f.document_kind === "data" ? "Data file" : f.document_kind === "supplement" ? "Supplement" : "Press release"} table · ${f.label}`,
  ...(f.period_start ? { start: f.period_start } : {}),
  end: f.period_end,
  value,
  ...(f.doc ? { doc: f.doc } : f.document_id ? { irDoc: f.document_id } : {}),
  ...("t" in f.locator ? { cell: { t: f.locator.t, r: f.locator.r, c: f.locator.c } } : {}),
});

function IrPage() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const fetchIr = useServerFn(getIrData);
  const q = useQuery({ queryKey: ["ir", ticker], queryFn: () => fetchIr({ data: { ticker } }), staleTime: 5 * 60_000 });

  // Releases that arrived since the last pass are read while the page is open, one at a time.
  const extract = useServerFn(extractNextIr);
  const qc = useQueryClient();
  const running = useRef(false);
  const pendingCount = q.data?.documents.filter((d) => d.ext?.startsWith("htm") && !d.extract_status && ["press-release", "supplement", "other"].includes(d.kind)).length ?? 0;
  useEffect(() => {
    if (!pendingCount || running.current) return;
    running.current = true;
    let cancelled = false;
    (async () => {
      for (let i = 0; i < 3 && !cancelled; i++) {
        const r = await extract({ data: { ticker } }).catch(() => ({ done: true }));
        if (r.done) break;
      }
      running.current = false;
      if (!cancelled) qc.invalidateQueries({ queryKey: ["ir", ticker] });
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingCount, ticker, extract, qc]);

  if (q.isLoading) return <Skeleton className="h-[600px]" />;
  if (q.isError) return <p className="text-sm text-negative">{(q.error as Error).message}</p>;
  const data = q.data!;
  return (
    <div className="grid grid-cols-1 gap-5">
      <KpiTables ticker={ticker} facts={data.facts as unknown as IrFact[]} pending={pendingCount} />
      <Library ticker={ticker} documents={data.documents} />
    </div>
  );
}

function KpiTables({ ticker, facts, pending }: { ticker: string; facts: IrFact[]; pending: number }) {
  const { open } = useSource();
  const { series, quarters, checks } = useMemo(() => buildIrSeries(facts), [facts]);
  const groups = useMemo(() => {
    const m = new Map<string, IrSeries[]>();
    for (const s of series) {
      const k = `${s.category}|${s.metric}`;
      m.set(k, [...(m.get(k) ?? []), s]);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [series]);
  const [span, setSpan] = useState<"8" | "12" | "all">("8");
  const cols = span === "all" ? quarters : quarters.slice(-Number(span));
  const failed = checks.filter((c) => !c.ok);

  if (!series.length)
    return (
      <Panel title="Segment & KPI data from IR releases" subtitle="Extracted from the company's earnings releases and supplements">
        <p className="p-5 text-sm text-muted-foreground">
          {pending ? `${pending} stored releases are being read — tables appear here as each is processed.` : "No breakdown tables have been extracted for this company yet."}
        </p>
      </Panel>
    );

  const openCell = (s: IrSeries, end: string, c: IrCell) => {
    const periodLabel = `Quarter ending ${fmtDate(end)}`;
    if (c.derived) {
      const parts: DerivedPart[] = c.derived.parts.map((p) => ({ ...refOf(p.fact, p.value), label: p.label, sign: p.sign }));
      open({ ticker, label: s.label, periodLabel, unit: s.unit, value: c.v, derived: { formula: c.derived.formula, parts } });
    } else if (c.fact) open({ ticker, label: s.label, periodLabel, unit: s.unit, value: c.v, src: refOf(c.fact) });
  };

  return (
    <Panel
      title="Segment & KPI data from IR releases"
      subtitle={`${series.length} lines from ${new Set(facts.map((f) => f.accn)).size} releases · click any value to open the release at that table cell`}
      actions={<Segmented label="Quarters shown" value={span} onChange={setSpan} options={[{ v: "8", l: "8Q" }, { v: "12", l: "12Q" }, { v: "all", l: "All" }]} />}
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-2 text-xs text-muted-foreground">
        {checks.length > 0 &&
          (failed.length ? (
            <span className="inline-flex items-center gap-1 text-negative">
              <TriangleAlert className="size-3.5" /> {failed.length} of {checks.length} breakdowns don't sum to their total
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-positive">
              <CheckCircle2 className="size-3.5" /> All {checks.length} breakdowns sum to their printed totals
            </span>
          ))}
        <span><em>Italic</em> = calculated fourth quarter (full year − Q1–Q3, or full year − nine months)</span>
        {pending > 0 && <span>{pending} more releases still being read</span>}
      </div>
      <div className="grid grid-cols-1 divide-y">
        {groups.map(([key, group]) => {
          const [cat, metric] = key.split("|");
          const rows = orderTree(group).filter(({ s }) => cols.some((e) => s.cells[e]));
          if (!rows.length) return null;
          return (
            <div key={key} className="min-w-0">
              <p className="eyebrow px-4 pt-3">
                {CATEGORY[cat] ?? cat} · {METRIC[metric] ?? metric}
              </p>
              <div className="overflow-x-auto scrollbar-thin">
                <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 min-w-56 border-b bg-card px-4 py-1.5 text-left font-normal text-muted-foreground">Line</th>
                      {cols.map((e) => (
                        <th key={e} className="num border-b px-3 py-1.5 text-right text-[11px] font-semibold">
                          {fmtDate(e, { month: "short", year: "2-digit" })}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ s, depth }) => {
                      const bad = new Set(failed.filter((f) => f.group === `${s.category}:${s.label}`).map((f) => f.period));
                      return (
                        <tr key={s.key} className="group">
                          <th scope="row" className={cn("sticky left-0 z-10 border-b bg-card px-4 py-1 text-left font-normal group-hover:bg-secondary", s.isTotal && "font-semibold")}>
                            <span style={{ paddingLeft: depth * 14 }}>{s.label}</span>
                          </th>
                          {cols.map((e) => {
                            const c = s.cells[e];
                            if (!c) return <td key={e} className="num border-b px-3 py-1 text-right text-muted-foreground/50">—</td>;
                            return (
                              <td key={e} className="border-b p-0 group-hover:bg-secondary/60">
                                <Tooltip delayDuration={350}>
                                  <TooltipTrigger asChild>
                                    <button
                                      onClick={() => openCell(s, e, c)}
                                      className={cn(
                                        "num block w-full px-3 py-1 text-right tabular-nums hover:bg-highlight-soft",
                                        s.isTotal && "font-medium",
                                        c.derived && "italic text-foreground/85",
                                        c.v < 0 && "text-negative",
                                        bad.has(e) && "underline decoration-negative decoration-wavy",
                                      )}
                                    >
                                      {fmtVal(c.v, s.unit)}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-xs">
                                    {c.derived ? c.derived.formula : `Printed as "${c.fact && "text" in c.fact.locator ? c.fact.locator.text : ""}" · release filed ${fmtDate(c.fact?.filed)}`}
                                    {bad.has(e) && <p className="text-negative">Children don't sum to this total</p>}
                                  </TooltipContent>
                                </Tooltip>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

type Doc = Awaited<ReturnType<typeof getIrData>>["documents"][number];
const KIND_LABEL: Record<string, string> = {
  "press-release": "Releases",
  presentation: "Presentations",
  supplement: "Supplements",
  data: "Data files",
  transcript: "Transcripts",
  image: "Images",
  "annual-report": "Annual reports",
  proxy: "Proxy",
  other: "Other",
};

const KIND_ONE: Record<string, string> = { "press-release": "Earnings release", presentation: "Presentation", supplement: "Financial supplement", data: "Data file", transcript: "Transcript", image: "Image", "annual-report": "Annual report", proxy: "Proxy statement", other: "Exhibit" };

/** Human title: filenames like "a8-kex991q4202609262026" become "Earnings release · Q4 …". */
function docTitle(d: Doc) {
  const t = d.title?.trim() ?? "";
  const looksLikeFile = !t || /\d{5,}|^(ex|d)\d|ex[-_ ]?99|^[a-z0-9]+[_-][a-z0-9_-]+$/i.test(t) || !/\s/.test(t);
  if (!looksLikeFile) return t;
  const when = d.period ? fmtDate(d.period, { month: "short", year: "numeric" }) : d.filed ? fmtDate(d.filed, { month: "short", year: "numeric" }) : "";
  return [KIND_ONE[d.kind] ?? "Document", when].filter(Boolean).join(" · ");
}

function KindIcon({ ext }: { ext: string | null }) {
  if (/^(xlsx?|xlsm|csv)$/.test(ext ?? "")) return <FileSpreadsheet className="size-4 text-positive" />;
  if (/^pptx?$/.test(ext ?? "")) return <Presentation className="size-4 text-chart-3" />;
  if (/^(jpe?g|png|gif)$/.test(ext ?? "")) return <ImageIcon className="size-4 text-muted-foreground" />;
  return <FileText className="size-4 text-muted-foreground" />;
}

function Library({ ticker, documents }: { ticker: string; documents: Doc[] }) {
  const { open } = useSource();
  const download = useServerFn(getIrDownload);
  const kinds = useMemo(() => [...new Set(documents.map((d) => d.kind))], [documents]);
  const [kind, setKind] = useState<string>("all");
  const [showImages, setShowImages] = useState(false);
  const list = documents.filter((d) => (kind === "all" || d.kind === kind) && (showImages || kind === "image" || d.kind !== "image"));
  const total = documents.reduce((n, d) => n + (d.bytes ?? 0), 0);

  const view = async (d: Doc) => {
    const name = d.source_url.split("/").pop() ?? "";
    if (d.source === "sec-exhibit" && d.accn && /\.html?$/i.test(name)) {
      open({ ticker, label: docTitle(d), unit: "usd", value: 0, doc: { accn: d.accn, doc: name, form: "8-K", filed: d.filed ?? undefined, title: docTitle(d) } });
      return;
    }
    const { url } = await download({ data: { id: d.id } });
    window.open(url, "_blank", "noopener");
  };
  const save = async (d: Doc) => {
    const { url } = await download({ data: { id: d.id } });
    window.location.href = url;
  };

  return (
    <Panel
      title="IR document library"
      subtitle={`${documents.length} files stored (${(total / 1e6).toFixed(1)} MB) — earnings releases, presentations, supplements and data files from EDGAR exhibits and the IR website`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Document type" value={kind} onChange={setKind} options={[{ v: "all", l: "All" }, ...kinds.map((k) => ({ v: k, l: KIND_LABEL[k] ?? k }))]} />
          {kind === "all" && (
            <Button size="sm" variant="ghost" onClick={() => setShowImages((x) => !x)}>
              {showImages ? "Hide images" : "Show images"}
            </Button>
          )}
        </div>
      }
    >
      {!list.length ? (
        <p className="p-5 text-sm text-muted-foreground">No stored documents yet — the collector adds files for each company in rotation.</p>
      ) : (
        <ul className="max-h-[560px] divide-y overflow-y-auto scrollbar-thin">
          {list.map((d) => (
            <li key={d.id} className="flex min-w-0 items-center gap-3 px-4 py-2">
              <KindIcon ext={d.ext} />
              <button onClick={() => view(d)} className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm hover:underline">{docTitle(d)}</p>
                <p className="num truncate text-[11px] text-muted-foreground">
                  {d.filed ? fmtDate(d.filed) : "IR website"} · {d.exhibit ?? (d.ext ?? "").toUpperCase()} · {((d.bytes ?? 0) / 1024).toFixed(0)} KB
                  {d.extract_facts ? ` · ${d.extract_facts} data points` : ""}
                </p>
              </button>
              <Badge variant="outline" className="hidden sm:inline-flex">
                {KIND_LABEL[d.kind] ?? d.kind}
              </Badge>
              <Button size="icon-sm" variant="ghost" aria-label="Download stored copy" onClick={() => save(d)}>
                <Download />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
