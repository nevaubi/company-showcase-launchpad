import { useMemo } from "react";
import { useSessionState } from "@/lib/use-session-state";
import { Button } from "@/components/ui/button";
import { EvidenceButton } from "@/components/source/evidence-button";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Panel } from "@/components/app/page-header";
import { AltEventList, AltSeriesChart, MedicareDrugTable } from "@/components/alt/alt-views";
import { DepositsByState, isStateDeposit } from "@/components/alt/deposits-by-state";
import { MedicareByState } from "@/components/alt/medicare-by-state";
import { PlantsTri } from "@/components/alt/plants-tri";
import { CompanyPlantHazards } from "@/components/alt/plant-hazards";
import { altCompanyQuery, DATASETS, fmtAlt, seriesByTitle } from "@/lib/alt/query";
import { asOfLabel, type PeriodMeta } from "@/lib/alt/periods";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/companies/$ticker/alt-data")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.ticker.toUpperCase()} alternative data · FiledUnder` },
      { name: "description", content: `Ownership, 8-K events, government contracts, regulation, recalls, complaints, Medicare drug spending and its spread by state, bank deposits by state, EPA plant releases, fails to deliver and attention data for ${params.ticker.toUpperCase()}, each linked to its public record.` },
      { property: "og:title", content: `${params.ticker.toUpperCase()} alternative data · FiledUnder` },
      { property: "og:description", content: "Public alt data with a source link on every row." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AltCompany,
});

const BAR = new Set(["contracts", "regulatory", "complaints", "medicare"]);
/** Per-drug Medicare rows go in one table instead of a chart each. */
const isDrugRow = (r: { dataset: string; title: string }) => r.dataset === "medicare" && /^Part [BD] · /.test(r.title);

/** "2026-03-31", "FY2026", or for a partial period "FY2027 YTD, as of 2026-11-20". */
const asOf = (r: { date: string | null; meta: PeriodMeta | null }) => asOfLabel(r, new Date().toISOString().slice(0, 10));

function AltCompany() {
  const ticker = Route.useParams().ticker.toUpperCase();
  const q = useQuery(altCompanyQuery(ticker));
  const [ds, setDs] = useSessionState<string>(`fu:alt:${ticker}:dataset`, "all");
  const rows = q.data ?? [];
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of rows) m[r.dataset] = (m[r.dataset] ?? 0) + 1;
    return m;
  }, [rows]);
  const series = useMemo(() => {
    const out: { dataset: string; title: string; rows: typeof rows }[] = [];
    // state breakdowns get their own map panels instead of a chart per state
    for (const d of Object.keys(DATASETS)) if (d !== "medicare_states" && d !== "tri") for (const [title, rs] of seriesByTitle(rows.filter((r) => r.dataset === d && !isDrugRow(r) && !isStateDeposit(r)))) out.push({ dataset: d, title, rows: rs });
    return out;
  }, [rows]);
  const drugRows = useMemo(() => rows.filter(isDrugRow), [rows]);
  const depositRows = useMemo(() => rows.filter((r) => r.dataset === "deposits"), [rows]);
  const drugStateRows = useMemo(() => rows.filter((r) => r.dataset === "medicare_states"), [rows]);
  const triRows = useMemo(() => rows.filter((r) => r.dataset === "tri"), [rows]);
  const events = rows.filter((r) => r.kind === "event" && (ds === "all" || r.dataset === ds));
  if (q.isLoading) return <Skeleton className="h-[600px]" />;
  if (q.isError && !q.data) return <Panel title="Alternative data"><p role="alert" className="text-sm text-muted-foreground">Public records are temporarily unavailable.</p><Button variant="outline" size="xs" className="mt-2" onClick={() => q.refetch()}>Retry</Button></Panel>;
  const present = Object.keys(DATASETS).filter((d) => counts[d]);
  if (!present.length) return <Panel title="Alternative data"><p className="text-sm text-muted-foreground">No public alt data loaded for {ticker} yet — the pipeline is still filling companies in.</p></Panel>;

  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {present.map((d) => (
          <button key={d} onClick={() => setDs(ds === d ? "all" : d)} className={cn("rounded-lg border bg-card px-2.5 py-2 text-left shadow-paper transition-colors hover:bg-secondary/60 sm:p-3", ds === d && "border-foreground")}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{DATASETS[d].source}</div>
            <div className="mt-0.5 truncate text-[12px] font-medium sm:text-[13px]">{DATASETS[d].label}</div>
            <div className="num mt-0.5 text-base sm:mt-1 sm:text-lg">{counts[d].toLocaleString()}</div>
          </button>
        ))}
      </div>

      {series.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {series.filter((s) => ds === "all" || s.dataset === ds).map((s) => {
            const last = s.rows[s.rows.length - 1];
            return (
              <Panel collapse={false} key={s.dataset + s.title} title={s.title} subtitle={`${DATASETS[s.dataset].source} · latest ${fmtAlt(last.value, last.unit)} (${asOf(last)})`} actions={last.source_url ? <EvidenceButton ticker={ticker} title={last.title} url={last.source_url} date={last.date ?? undefined} /> : undefined}>
                <AltSeriesChart rows={s.rows} bar={BAR.has(s.dataset)} />
              </Panel>
            );
          })}
        </div>
      )}

      {drugRows.length > 0 && (ds === "all" || ds === "medicare") && (
        <div data-section="Medicare drugs" className="min-w-0">
          <Panel title="Medicare spending by drug" subtitle="Gross Medicare Part D (pharmacy) and Part B (clinic-administered) spending on the company's largest drugs, before rebates · CMS" bodyClassName="p-0">
            <MedicareDrugTable ticker={ticker} rows={drugRows} />
          </Panel>
        </div>
      )}

      {drugStateRows.length > 0 && (ds === "all" || ds === "medicare" || ds === "medicare_states") && (
        <div data-section="Medicare drugs by state" className="min-w-0">
          <Panel collapse={false} title="Medicare drug costs by state" subtitle="Gross Medicare Part D costs of the company's own brands by the prescriber's state, its slice of each state's spending and where its drugs over- or under-index · CMS" bodyClassName="p-0">
            <MedicareByState ticker={ticker} rows={drugStateRows} />
          </Panel>
        </div>
      )}

      {triRows.length > 0 && (ds === "all" || ds === "tri") && (
        <div data-section="Plants" className="min-w-0">
          <Panel collapse={false} title="Plants & releases" subtitle="The company's US plants that report to EPA's Toxics Release Inventory: where they are, what they release and how their production changed · EPA" bodyClassName="p-0">
            <CompanyPlantHazards ticker={ticker} />
            <PlantsTri ticker={ticker} rows={triRows} />
          </Panel>
        </div>
      )}

      {depositRows.length > 0 && (ds === "all" || ds === "deposits") && (
        <div data-section="Deposits by state" className="min-w-0">
          <Panel collapse={false} title="Deposits by state" subtitle="Branch deposits of all the company's FDIC-insured banks each June 30, by state and metro area · FDIC Summary of Deposits" bodyClassName="p-0">
            <DepositsByState ticker={ticker} rows={depositRows} />
          </Panel>
        </div>
      )}

      <Panel collapse={false} title={ds === "all" ? "Every event" : DATASETS[ds]?.label} subtitle={ds === "all" ? "Newest first" : DATASETS[ds]?.blurb} bodyClassName="p-0"
        actions={
          <select value={ds} onChange={(e) => setDs(e.target.value)} className="rounded border bg-background px-2 py-1 text-[12px]">
            <option value="all">All datasets</option>
            {present.map((d) => <option key={d} value={d}>{DATASETS[d].label}</option>)}
          </select>
        }>
        <AltEventList key={ds} rows={events} max={5000} />
      </Panel>
    </div>
  );
}
