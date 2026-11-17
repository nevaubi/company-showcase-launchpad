import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AltEventList } from "@/components/alt/alt-views";
import { AltSignalsSection, SourceStrip } from "@/components/alt/alt-signals";
import { PlantHazardsPanel } from "@/components/alt/plant-hazards";
import { altFeedQuery, altLeadersQuery, DATASETS, fmtAlt, leaderStats, medicareStateQuery } from "@/lib/alt/query";
import { STATES } from "@/lib/alt/sod";
import { FTD_TITLE } from "@/lib/alt/ftd";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { EvidenceButton } from "@/components/source/evidence-button";

const pageSearch = z.object({ d: z.string().optional() });

export const Route = createFileRoute("/_authenticated/app/alt-data")({
  validateSearch: pageSearch,
  head: () => ({
    meta: [
      { title: "Alternative data — Filed Under" },
      { name: "description", content: "Public alt data for every covered US company: 13D/13G holders, 8-K events, federal contracts, regulation, FDA, recalls, CFPB complaints, FDIC call reports, Medicare drug costs by state, EPA plants and releases, fails to deliver and attention." },
      { property: "og:title", content: "Alternative data — Filed Under" },
      { property: "og:description", content: "FactSet-style alt datasets built from public records, every row source-linked." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AltHub,
});

/** Series each dataset can rank companies by (first is the default). */
const LEAD_TITLES: Record<string, string[]> = {
  contracts: ["Federal contract obligations"],
  complaints: ["CFPB consumer complaints"],
  bank: ["Total deposits", "Total assets", "Net loans & leases", "Net interest margin", "Net charge-off rate", "Noncurrent loans / loans", "Return on assets", "CET1 ratio"],
  attention: ["Wikipedia pageviews"],
  regulatory: ["Federal Register documents naming the company"],
  medicare: ["Medicare Part D spending", "Medicare Part B spending"],
  settlement: [FTD_TITLE],
  deposits: ["Branch deposits"],
  tri: ["Toxic releases (TRI)", "TRI production index", "TRI facilities"],
};
const SERIES_SETS = new Set(Object.keys(LEAD_TITLES));
const EVENTLESS = new Set(["bank", "attention", "complaints", "settlement", "medicare", "deposits", "medicare_states", "tri"]);

function AltHub() {
  const { d = "events" } = Route.useSearch();
  const meta = DATASETS[d] ?? DATASETS.events;
  return (
    <div>
      <PageHeader eyebrow="Research" title="Alternative data" description="What changed across public registries (SEC, federal contracts, regulators, FDA, NHTSA, CFPB, FDIC), scored against each company's own history. Every row links to its record." />
      <SourceStrip />
      <AltSignalsSection />
      <PlantHazardsPanel className="mb-5" />
      <h2 className="mb-2 text-[13px] font-semibold">Browse by dataset</h2>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {Object.entries(DATASETS).map(([k, v]) => (
          <Link key={k} to="/app/alt-data" search={{ d: k }} className={cn("rounded-full border px-3 py-1 text-[12px]", k === d ? "bg-foreground text-background" : "bg-card hover:bg-secondary")}>{v.label}</Link>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{meta.blurb} · <span className="font-medium">{meta.source}</span></p>
      <div className={cn("grid grid-cols-1 gap-5", !EVENTLESS.has(d) && "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]")}>
        {SERIES_SETS.has(d) && <Leaders key={d} d={d} />}
        {d === "medicare_states" && <div className="xl:col-span-2"><DrugMakersByState /></div>}
        {!EVENTLESS.has(d) && (
          <Panel title="Latest across coverage" subtitle="Newest 300 records" bodyClassName="p-0" collapse={false} className={cn(!SERIES_SETS.has(d) && "xl:col-span-2")}>
            <Feed key={d} d={d} />
          </Panel>
        )}
      </div>
    </div>
  );
}

function Feed({ d }: { d: string }) {
  const q = useQuery(altFeedQuery(d));
  if (q.isLoading) return <Skeleton className="m-4 h-64" />;
  if (q.isError && !q.data) return <div role="alert" className="space-y-2 p-4"><p className="text-sm text-muted-foreground">Records are temporarily unavailable.</p><Button variant="outline" size="xs" onClick={() => q.refetch()}>Retry</Button></div>;
  return <AltEventList rows={q.data ?? []} showTicker max={300} />;
}

type LeadSort = "latest" | "typical" | "chg";

/** Display caps so a near-zero baseline doesn't print a meaningless 7,000× or +300,000%. */
const fmtTimes = (x: number) => (x >= 100 ? "≥100×" : `${x.toFixed(1)}×`);
const fmtChg = (c: number) => (c >= 10 ? "> +999%" : `${c >= 0 ? "+" : ""}${(c * 100).toFixed(0)}%`);

function Leaders({ d }: { d: string }) {
  const titles = LEAD_TITLES[d];
  const [title, setTitle] = useState(titles[0]);
  const q = useQuery(altLeadersQuery(d, title));
  const [sort, setSort] = useState<LeadSort>(d === "settlement" ? "typical" : "latest");
  const [find, setFind] = useState("");
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const f = find.trim().toUpperCase();
    const all = (q.data ?? []).map((r) => ({ r, ...leaderStats(r) }));
    // Ratio rankings only among companies whose latest reading is at least the median size, so a
    // tiny company jumping from almost nothing doesn't crowd out meaningful moves.
    const sizes = all.map((x) => x.r.value).sort((a, b) => a - b);
    const floor = sort === "latest" || f ? -Infinity : sizes[Math.floor(sizes.length / 2)] ?? -Infinity;
    const list = all.filter((x) => (!f || x.r.ticker.startsWith(f)) && x.r.value >= floor);
    const key = (x: (typeof list)[number]) => (sort === "latest" ? x.r.value : sort === "typical" ? x.vsTypical : x.chg) ?? -Infinity;
    return list.sort((a, b) => key(b) - key(a));
  }, [q.data, sort, find]);
  const shown = all ? rows : rows.slice(0, 100);
  return (
    <Panel
      title={title}
      subtitle={`Latest reading for ${q.data?.length ?? "…"} companies, vs a year earlier and vs each company's own trailing-year median${sort !== "latest" && !find ? " · ranked among the larger half" : ""}`}
      bodyClassName="p-0"
      className="min-w-0"
      collapse={false}
      actions={
        <div className="flex flex-wrap items-center gap-1.5">
          {titles.length > 1 && (
            <select value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Series" className="h-7 rounded-md border bg-background px-2 text-[12px]">
              {titles.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Ticker" aria-label="Filter by ticker" className="h-7 w-20 rounded-md border bg-background px-2 text-[12px]" />
          <div role="tablist" className="flex rounded-md border p-0.5 text-[11px]">
            {(["latest", "typical", "chg"] as const).map((k) => (
              <button key={k} role="tab" aria-selected={sort === k} onClick={() => setSort(k)} className={cn("rounded px-2 py-0.5", sort === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
                {k === "latest" ? "Largest" : k === "typical" ? "vs normal" : "vs 1y"}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {q.isLoading ? <Skeleton className="m-4 h-64" /> : q.isError && !q.data ? <div role="alert" className="p-4 text-sm">Readings are temporarily unavailable. <Button size="xs" variant="outline" onClick={() => q.refetch()}>Retry</Button></div> : !rows.length ? <p className="px-4 py-6 text-sm text-muted-foreground">{find ? "No company matches that ticker." : "No readings available for this dataset."}</p> : (
        <>
          <div className="overflow-x-auto">
            <table className="research-table">
              <thead><tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">Company</th><th className="px-2 py-2 font-medium">As of</th><th className="px-2 py-2 text-right font-medium">Latest</th><th className="px-2 py-2 text-right font-medium" title="Latest reading divided by the company's median over the prior year">vs normal</th><th className="px-4 py-2 text-right font-medium">vs 1y</th>
              </tr></thead>
              <tbody>
                {shown.map(({ r, chg, vsTypical }) => (
                  <tr key={r.ticker} className="border-b last:border-0">
                    <td className="px-4 py-1.5"><Link to="/app/companies/$ticker/alt-data" params={{ ticker: r.ticker }} className="font-medium hover:underline">{r.ticker}</Link></td>
                    <td className="num px-2 text-[11px] text-muted-foreground">{r.date}</td>
                    <td className="num px-2 text-right"><span>{fmtAlt(r.value, r.unit)}</span>{r.source_url && <EvidenceButton ticker={r.ticker} title={title} url={r.source_url} date={r.date} />}</td>
                    <td className={cn("num px-2 text-right", vsTypical == null ? "text-muted-foreground" : vsTypical >= 2 ? "font-medium text-negative" : vsTypical <= 0.5 ? "text-positive" : "")}>{vsTypical == null ? "—" : fmtTimes(vsTypical)}</td>
                    <td className={cn("num px-4 text-right", chg == null ? "text-muted-foreground" : chg >= 0 ? "text-positive" : "text-negative")}>{chg == null ? "—" : fmtChg(chg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 100 && (
            <div className="border-t px-4 py-2 text-center">
              <Button size="xs" variant="ghost" onClick={() => setAll((v) => !v)}>{all ? "Show top 100" : `Show all ${rows.length}`}</Button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/** Every covered drug maker in one state: its Part D drug costs there, slice of the state and index vs Medicare overall. */
function DrugMakersByState() {
  const [st, setSt] = useState("CA");
  const q = useQuery(medicareStateQuery(st));
  const rows = q.data?.rows ?? [];
  const all = rows[0]?.meta?.state_total as number | undefined;
  return (
    <Panel
      title={`Drug makers in ${STATES[st] ?? st}`}
      subtitle={`Medicare Part D gross drug costs of each company's own brands prescribed in the state${q.data?.latest ? `, ${q.data.latest.slice(0, 4)}` : ""}${all ? ` · all Part D costs there ${fmtAlt(all, "USD")}` : ""}`}
      bodyClassName="p-0"
      className="min-w-0"
      collapse={false}
      actions={
        <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="State" className="h-7 rounded-md border bg-background px-2 text-[12px]">
          {Object.entries(STATES).slice(0, 52).sort((a, b) => a[1].localeCompare(b[1])).map(([c, n]) => <option key={c} value={c}>{n}</option>)}
        </select>
      }
    >
      {q.isLoading ? <Skeleton className="m-4 h-64" /> : q.isError && !q.data ? <div role="alert" className="p-4 text-sm">Readings are temporarily unavailable. <Button size="xs" variant="outline" onClick={() => q.refetch()}>Retry</Button></div> : !rows.length ? <p className="px-4 py-6 text-sm text-muted-foreground">No drug-maker readings for this state yet.</p> : (
        <div className="overflow-x-auto">
          <table className="research-table w-full">
            <thead><tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-medium">Company</th><th className="px-2 py-2 text-right font-medium">Part D costs</th><th className="px-2 py-2 text-right font-medium" title="Share of all Part D drug costs prescribed in the state">Of state</th><th className="px-2 py-2 text-right font-medium" title="Share of the company's own Part D costs that are prescribed here">Of company</th><th className="px-2 py-2 text-right font-medium" title="State's share of the company's costs ÷ state's share of all Part D costs; above 1 = its drugs are prescribed more here">Index</th><th className="hidden px-4 py-2 font-medium sm:table-cell">Largest drugs here</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uid} className="border-b last:border-0">
                  <td className="px-4 py-1.5"><Link to="/app/companies/$ticker/alt-data" params={{ ticker: r.ticker }} className="font-medium hover:underline">{r.ticker}</Link></td>
                  <td className="num px-2 text-right"><span>{fmtAlt(r.value, "USD")}</span>{r.source_url && <EvidenceButton ticker={r.ticker} title={`${r.ticker} Part D costs in ${STATES[st] ?? st}`} url={r.source_url} date={r.date ?? undefined} />}</td>
                  <td className="num px-2 text-right">{r.meta.market_share != null ? `${(r.meta.market_share * 100).toFixed(2)}%` : "—"}</td>
                  <td className="num px-2 text-right">{r.meta.share != null ? `${(r.meta.share * 100).toFixed(1)}%` : "—"}</td>
                  <td className={cn("num px-2 text-right", r.meta.index > 1.15 ? "text-chart-1" : r.meta.index < 0.87 ? "text-chart-2" : "")}>{r.meta.index != null ? `${r.meta.index.toFixed(2)}×` : "—"}</td>
                  <td className="hidden max-w-[18rem] truncate px-4 text-[12px] text-muted-foreground sm:table-cell">{(r.meta.drugs ?? []).map((d: { brand: string }) => d.brand).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
