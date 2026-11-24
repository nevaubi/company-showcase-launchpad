// What the company reports beyond the statements: a few of the lines its own releases, supplements and
// presentations print every quarter (units shipped, users, backlog, segment detail), as the investor-relations page
// reads them. The IR data is large (megabytes for a bank), so it is fetched only once this block is near the screen.
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { openIrCell } from "@/components/ir/breakdowns";
import { IrPanel } from "@/components/ir/panel";
import { DASH, IR } from "@/components/ir/typography";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useKeepReaderBelow } from "@/components/company/hold-height";
import { useSource } from "@/components/source/source-context";
import { useUnitScale } from "@/hooks/use-preference";
import { supabase } from "@/integrations/supabase/client";
import { getIrData } from "@/lib/ir.functions";
import { irPageKey, loadIrPage } from "@/lib/ir/client";
import { fmtIr, unitCaption } from "@/lib/ir/display";
import { keyLines, type KeyLine } from "@/lib/ir/highlights";
import { fiscalCalendar, fiscalLabel, periodGrids } from "@/lib/ir/periods";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Spark } from "./spark";

const LINES = 6;

/** True once the element has come within `margin` of the screen; stays true. */
function useNear<T extends Element>(margin = "600px") {
  const [el, setEl] = useState<T | null>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [el, near, margin]);
  return [setEl, near] as const;
}

const fmtChange = (v: number | null, unit: string) => {
  if (v == null) return DASH;
  const pts = unit === "pct" || unit === "bps";
  const s = `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v) >= 100 && !pts ? Math.round(Math.abs(v)).toLocaleString("en-US") : Math.abs(v).toFixed(1)}`;
  return pts ? `${s} pts` : `${s}%`;
};
/** Costs and credit losses improve when they fall. */
const inverted = (l: KeyLine) => l.s.cat === "cost" || l.s.met === "cost" || l.s.met === "expense" || /charge-?off|provision|non-?performing|delinquen|efficiency ratio/i.test(l.s.label);
const toneOf = (v: number | null, l: KeyLine) => (v == null || Math.abs(v) < 0.05 ? "" : v > 0 !== inverted(l) ? "text-positive" : "text-negative");

export function ReportedKpis({ ticker }: { ticker: string }) {
  const { open } = useSource();
  const [scale] = useUnitScale();
  const [ref, near] = useNear<HTMLDivElement>();
  const keep = useKeepReaderBelow<HTMLDivElement>();
  // a small row that says whether IR data is stored at all, so a company without any never asks for the payload
  const index = useQuery({
    queryKey: ["ir-series-index", ticker],
    staleTime: 30 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.from("ir_company_series").select("ticker, stats, built_at").eq("ticker", ticker).maybeSingle();
      if (error) throw new Error(error.message);
      return data as { ticker: string; built_at: string; stats: { series?: number; documents?: number; lastPeriod?: string } | null } | null;
    },
  });
  const stored = index.isError || !!index.data;
  const fetchIr = useServerFn(getIrData);
  const ir = useQuery({ queryKey: irPageKey(ticker), queryFn: () => loadIrPage(ticker, fetchIr), staleTime: 5 * 60_000, retry: 1, enabled: near && stored && !index.isLoading });
  const payload = ir.data?.payload ?? null;
  const lines = useMemo(() => (payload ? keyLines(payload, periodGrids(payload).q, LINES) : []), [payload]);
  const head = payload && lines.length ? fiscalLabel(lines[0].end, "q", fiscalCalendar(payload)) : null;
  const unitOf = (l: KeyLine) => (l.s.unit === "usd" ? (scale === "full" ? "$" : `$${scale}`) : l.s.unit === "pct" ? "%" : unitCaption(l.s.unit, scale));
  const stats = index.data?.stats;
  const subtitle = lines.length
    ? `Quarter ended ${fmtDate(lines[0].end)} · lines the company's own releases print every quarter, largest first · click a value for the document`
    : stats?.series
      ? `${stats.series.toLocaleString("en-US")} series from ${stats.documents?.toLocaleString("en-US") ?? "the"} company documents${stats.lastPeriod ? `, through ${fmtDate(stats.lastPeriod)}` : ""}`
      : "Lines from the company's own releases, supplements and presentations";

  // a company with no stored IR documents has no such section
  if (!stored && !index.isLoading) return null;
  return (
    <div
      ref={(el) => {
        ref(el);
        keep.current = el;
      }}
      className="min-w-0"
    >
      {index.isLoading ? null : (
      <IrPanel
        section="What the company reports"
        title="What the company reports"
        subtitle={subtitle}
        bodyClassName="p-0"
        actions={
          <Button size="xs" variant="ghost" asChild>
            <Link to="/app/companies/$ticker/ir" params={{ ticker }}>
              IR data
            </Link>
          </Button>
        }
      >
        {ir.isLoading || !near ? (
          <div className="p-4">
            <Skeleton className="h-36" />
          </div>
        ) : ir.isError || !payload ? (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">The stored IR data could not be read just now. The IR data tab has the full tables.</p>
        ) : lines.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">No line has a complete enough recent history to headline. The IR data tab has every series.</p>
        ) : (
          <table className={cn("w-full table-fixed", IR.row)}>
            <colgroup>
              <col />
              <col className="w-24" />
              <col className="w-[5.5rem]" />
              <col className="hidden w-[5.5rem] sm:table-column" />
              <col className="hidden w-24 sm:table-column" />
            </colgroup>
            <thead>
              <tr className={IR.caption}>
                <th scope="col" className="px-4 py-1.5 text-left font-normal">
                  Line
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-normal">
                  {head?.short ?? "Latest quarter"}
                </th>
                <th scope="col" className="py-1.5 pr-3 text-right font-normal">
                  On a year ago
                </th>
                <th scope="col" className="hidden py-1.5 pr-3 text-right font-normal sm:table-cell">
                  On prior quarter
                </th>
                <th scope="col" className="hidden py-1.5 pr-4 text-right font-normal sm:table-cell">
                  Eight quarters
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.s.k} className="border-t border-border/60 transition-colors duration-150 hover:bg-secondary/60 motion-reduce:transition-none">
                  <th scope="row" className="px-4 py-1 text-left font-normal">
                    <span className="block truncate" title={l.s.label}>
                      {l.s.label}
                    </span>
                    <span className={cn("block truncate", IR.caption)} title={l.groupTitle}>
                      {l.groupTitle} · {unitOf(l)}
                    </span>
                  </th>
                  <td className={cn("py-1 pr-2 align-top", IR.num)}>
                    <button
                      type="button"
                      data-figure={l.s.label}
                      onClick={() => openIrCell(open, ticker, payload, l.s, l.end, "q", l.cell)}
                      title="Open the document that prints this value"
                      className="num rounded-sm px-1 py-0.5 font-medium tabular-nums transition-colors duration-150 hover:bg-highlight-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {fmtIr(l.cell.v, l.s.unit, scale)}
                    </button>
                  </td>
                  <td className={cn("py-1 pr-3 align-top", IR.num, toneOf(l.yoy, l))}>{fmtChange(l.yoy, l.s.unit)}</td>
                  <td className={cn("hidden py-1 pr-3 align-top sm:table-cell", IR.num, toneOf(l.qoq, l))}>{fmtChange(l.qoq, l.s.unit)}</td>
                  <td className="hidden py-1 pr-4 align-top sm:table-cell">
                    <div className="flex h-5 items-center justify-end">
                      <Spark points={l.trend.map((v, i) => ({ label: `Quarter ${i + 1} of ${l.trend.length}`, value: v, text: v == null ? undefined : fmtIr(v, l.s.unit, scale) }))} name={`${l.s.label}, last ${l.trend.length} quarters`} width={72} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </IrPanel>
      )}
    </div>
  );
}
