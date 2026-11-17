import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AltEventList } from "@/components/alt/alt-views";
import { AltSignalsSection, SourceStrip } from "@/components/alt/alt-signals";
import { altFeedQuery, altLeadersQuery, DATASETS, fmtAlt, leaderStats } from "@/lib/alt/query";
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
      { name: "description", content: "Public alt data for every covered US company: 13D/13G holders, 8-K events, federal contracts, regulation, FDA, recalls, CFPB complaints, FDIC call reports, fails to deliver and attention." },
      { property: "og:title", content: "Alternative data — Filed Under" },
      { property: "og:description", content: "FactSet-style alt datasets built from public records, every row source-linked." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AltHub,
});

const LEAD_TITLE: Record<string, string> = { contracts: "Federal contract obligations", complaints: "CFPB consumer complaints", bank: "Total deposits", attention: "Wikipedia pageviews", regulatory: "Federal Register documents naming the company", settlement: FTD_TITLE };
const SERIES_SETS = new Set(Object.keys(LEAD_TITLE));
const EVENTLESS = new Set(["bank", "attention", "complaints", "settlement"]);

function AltHub() {
  const { d = "events" } = Route.useSearch();
  const meta = DATASETS[d] ?? DATASETS.events;
  return (
    <div>
      <PageHeader eyebrow="Research" title="Alternative data" description="What changed across public registries (SEC, federal contracts, regulators, FDA, NHTSA, CFPB, FDIC), scored against each company's own history. Every row links to its record." />
      <SourceStrip />
      <AltSignalsSection />
      <h2 className="mb-2 text-[13px] font-semibold">Browse by dataset</h2>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {Object.entries(DATASETS).map(([k, v]) => (
          <Link key={k} to="/app/alt-data" search={{ d: k }} className={cn("rounded-full border px-3 py-1 text-[12px]", k === d ? "bg-foreground text-background" : "bg-card hover:bg-secondary")}>{v.label}</Link>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{meta.blurb} · <span className="font-medium">{meta.source}</span></p>
      <div className={cn("grid grid-cols-1 gap-5", !EVENTLESS.has(d) && "xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]")}>
        {SERIES_SETS.has(d) && <Leaders key={d} d={d} />}
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

function Leaders({ d }: { d: string }) {
  const title = LEAD_TITLE[d];
  const q = useQuery(altLeadersQuery(d, title));
  const [sort, setSort] = useState<LeadSort>(d === "settlement" ? "typical" : "latest");
  const [find, setFind] = useState("");
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const f = find.trim().toUpperCase();
    const list = (q.data ?? []).filter((r) => !f || r.ticker.startsWith(f)).map((r) => ({ r, ...leaderStats(r) }));
    const key = (x: (typeof list)[number]) => (sort === "latest" ? x.r.value : sort === "typical" ? x.vsTypical : x.chg) ?? -Infinity;
    return list.sort((a, b) => key(b) - key(a));
  }, [q.data, sort, find]);
  const shown = all ? rows : rows.slice(0, 100);
  return (
    <Panel
      title={title}
      subtitle={`Latest reading for ${q.data?.length ?? "…"} companies, vs a year earlier and vs each company's own trailing-year median`}
      bodyClassName="p-0"
      className="min-w-0"
      collapse={false}
      actions={
        <div className="flex items-center gap-1.5">
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
                    <td className={cn("num px-2 text-right", vsTypical == null ? "text-muted-foreground" : vsTypical >= 2 ? "font-medium text-negative" : vsTypical <= 0.5 ? "text-positive" : "")}>{vsTypical == null ? "—" : `${vsTypical.toFixed(1)}×`}</td>
                    <td className={cn("num px-4 text-right", chg == null ? "text-muted-foreground" : chg >= 0 ? "text-positive" : "text-negative")}>{chg == null ? "—" : `${chg >= 0 ? "+" : ""}${(chg * 100).toFixed(0)}%`}</td>
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
