import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Panel } from "@/components/app/page-header";
import { BarChart } from "@/components/charts/bar-chart";
import { StatementTable } from "@/components/financials/statement-table";
import { useSource } from "@/components/source/source-context";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompany } from "@/lib/data";
import { durationDays } from "@/lib/financials/build";
import type { CompanyDataset, SegmentFact } from "@/lib/financials/types";
import { fmtCompactUsd, fmtDate, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/segments")({
  component: Segments,
});

const PALETTE = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-6)", "var(--chart-5)", "var(--foreground)"];

function Segments() {
  const { ticker: raw } = Route.useParams();
  const ticker = raw.toUpperCase();
  const company = useCompany(ticker);
  const filingsByAccn = useMemo(() => new Map((company.data?.filings ?? []).map((f) => [f.accn, f])), [company.data]);
  if (!company.data) return <Skeleton className="h-[600px]" />;
  return (
    <div className="grid grid-cols-1 gap-6">
      <SegmentExplorer ticker={ticker} data={company.data} />
      <section>
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 className="text-sm font-semibold">Ratios & KPIs</h2>
            <p className="text-xs text-muted-foreground">Quarterly · every ratio lists the reported values it was calculated from</p>
          </div>
        </div>
        <StatementTable statement={company.data.statements.quarterly.kpis} ticker={ticker} maxPeriods={12} filingsByAccn={filingsByAccn} />
      </section>
    </div>
  );
}

interface Group {
  axis: string;
  axisLabel: string;
  metric: SegmentFact["metric"];
}

function SegmentExplorer({ ticker, data }: { ticker: string; data: CompanyDataset }) {
  const { open } = useSource();
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const s of data.segments) m.set(`${s.axis}|${s.metric}`, { axis: s.axis, axisLabel: s.axisLabel, metric: s.metric });
    const order = ["Business segment|revenue", "Product / service|revenue", "Geography|revenue", "Business segment|operatingIncome"];
    return [...m.values()].sort((a, b) => order.indexOf(`${a.axisLabel}|${a.metric}`) - order.indexOf(`${b.axisLabel}|${b.metric}`));
  }, [data.segments]);
  const [gi, setGi] = useState(0);
  const [freq, setFreq] = useState<"annual" | "quarterly">("annual");
  const g = groups[gi];

  const { periods, members, matrix } = useMemo(() => {
    if (!g) return { periods: [], members: [], matrix: new Map<string, SegmentFact>() };
    const facts = data.segments.filter((s) => s.axis === g.axis && s.metric === g.metric && s.start);
    const want = (s: SegmentFact) => {
      const d = durationDays(s.start!, s.end);
      return freq === "annual" ? d > 350 && d < 380 : d > 80 && d < 100;
    };
    const fs = facts.filter(want);
    const periods = [...new Set(fs.map((s) => s.end))].sort();
    const totals = new Map<string, number>();
    for (const s of fs) if (s.end === periods.at(-1)) totals.set(s.member, s.value);
    const members = [...new Set(fs.map((s) => s.member))]
      .map((m) => ({ member: m, label: fs.find((s) => s.member === m)!.label, latest: totals.get(m) ?? 0 }))
      .sort((a, b) => b.latest - a.latest);
    const matrix = new Map<string, SegmentFact>();
    for (const s of fs) {
      const k = `${s.member}|${s.end}`;
      const prev = matrix.get(k);
      if (!prev || (data.filings.find((f) => f.accn === s.accn)?.filed ?? "") > (data.filings.find((f) => f.accn === prev.accn)?.filed ?? "")) matrix.set(k, s);
    }
    return { periods: periods.slice(-8), members, matrix };
  }, [g, freq, data.segments, data.filings]);

  if (!groups.length) return <p className="text-sm text-muted-foreground">No segment disclosures were found in the latest filings.</p>;

  // Exclude aggregate members that double count (e.g. "Products" alongside product lines) only in the stacked chart
  const leafMembers = members.filter((m) => !/total|consolidated/i.test(m.label));
  const bars = periods.map((end) => ({
    key: end,
    label: fmtDate(end, { month: "short", year: "2-digit" }),
    parts: leafMembers.slice(0, 7).map((m, i) => ({ id: m.label, value: matrix.get(`${m.member}|${end}`)?.value ?? 0, color: PALETTE[i % PALETTE.length] })),
  }));

  const openFact = (s: SegmentFact) =>
    open({
      ticker,
      label: `${s.label} — ${s.metric === "revenue" ? "revenue" : "operating income"}`,
      periodLabel: `${fmtDate(s.start)} – ${fmtDate(s.end)}`,
      unit: "usd",
      value: s.value,
      src: { accn: s.accn, concept: s.concept, start: s.start, end: s.end, value: s.value },
      elementId: s.elementId,
    });

  return (
    <Panel
      title="Segment disclosures"
      subtitle="Extracted from inline-XBRL dimensional facts in the latest 10-K and 10-Q filings"
      actions={
        <div className="flex rounded-md border bg-secondary/50 p-0.5">
          {(["annual", "quarterly"] as const).map((f) => (
            <button key={f} onClick={() => setFreq(f)} className={cn("rounded px-2.5 py-1 text-xs capitalize", freq === f ? "bg-card font-medium shadow-paper" : "text-muted-foreground")}>
              {f}
            </button>
          ))}
        </div>
      }
    >
      <div className="mb-4 flex flex-wrap gap-1.5">
        {groups.map((x, i) => (
          <button
            key={`${x.axis}|${x.metric}`}
            onClick={() => setGi(i)}
            className={cn("rounded-full border px-3 py-1 text-xs transition-colors", i === gi ? "border-foreground bg-ink text-ink-foreground" : "bg-card hover:bg-secondary")}
          >
            {x.axisLabel} · {x.metric === "revenue" ? "Revenue" : "Operating income"}
          </button>
        ))}
      </div>
      {periods.length ? (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div>
            <BarChart
              data={bars}
              height={280}
              yFormat={(v) => fmtCompactUsd(v, 0)}
              onSelect={(d, part) => {
                const m = leafMembers.find((x) => x.label === part);
                const f = m && matrix.get(`${m.member}|${d.key}`);
                if (f) openFact(f);
              }}
            />
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {leafMembers.slice(0, 7).map((m, i) => (
                <span key={m.member} className="flex items-center gap-1.5 text-[11px]">
                  <span className="size-2 rounded-sm" style={{ background: PALETTE[i % PALETTE.length] }} />
                  {m.label}
                </span>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="py-1.5 text-left font-medium">Member</th>
                  {periods.slice(-4).map((p) => (
                    <th key={p} className="num px-2 py-1.5 text-right font-medium">
                      {fmtDate(p, { month: "short", year: "2-digit" })}
                    </th>
                  ))}
                  <th className="num px-2 py-1.5 text-right font-medium">YoY</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const ps = periods.slice(-4);
                  const last = matrix.get(`${m.member}|${ps.at(-1)}`);
                  const prevYear = periods.find((p) => Math.abs(durationDays(p, ps.at(-1)!) - 365) < 15);
                  const prior = prevYear ? matrix.get(`${m.member}|${prevYear}`) : undefined;
                  const yoy = last && prior && prior.value > 0 ? last.value / prior.value - 1 : null;
                  return (
                    <tr key={m.member} className="border-b last:border-0">
                      <td className="py-1.5 pr-2">{m.label}</td>
                      {ps.map((p) => {
                        const f = matrix.get(`${m.member}|${p}`);
                        return (
                          <td key={p} className="p-0 text-right">
                            {f ? (
                              <button onClick={() => openFact(f)} className="num w-full rounded px-2 py-1.5 text-right hover:bg-highlight-soft">
                                {fmtCompactUsd(f.value)}
                              </button>
                            ) : (
                              <span className="num px-2 text-muted-foreground/50">—</span>
                            )}
                          </td>
                        );
                      })}
                      <td className={cn("num px-2 text-right", yoy == null ? "text-muted-foreground" : yoy >= 0 ? "text-positive" : "text-negative")}>{fmtPct(yoy, 1, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No {freq} periods disclosed on this axis in the filings we parsed.</p>
      )}
    </Panel>
  );
}
