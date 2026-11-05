import { useMemo } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AltEventList } from "@/components/alt/alt-views";
import { altFeedQuery, altSeriesQuery, DATASETS, fmtAlt, leaderboard } from "@/lib/alt/query";
import { cn } from "@/lib/utils";

const pageSearch = z.object({ d: z.string().optional() });

export const Route = createFileRoute("/_authenticated/app/alt-data")({
  validateSearch: pageSearch,
  head: () => ({
    meta: [
      { title: "Alternative data — Filed Under" },
      { name: "description", content: "Public alt data across 78 US companies: 13D/13G holders, 8-K events, federal contracts, regulation, FDA, recalls, CFPB complaints, FDIC call reports and attention." },
      { property: "og:title", content: "Alternative data — Filed Under" },
      { property: "og:description", content: "FactSet-style alt datasets built from public records, every row source-linked." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AltHub,
});

const SERIES_SETS = new Set(["contracts", "complaints", "bank", "attention", "regulatory"]);
const LEAD_TITLE: Record<string, string> = { contracts: "Federal contract obligations", complaints: "CFPB consumer complaints", bank: "Total deposits", attention: "Wikipedia pageviews", regulatory: "Federal Register documents naming the company" };

function AltHub() {
  const { d = "events" } = Route.useSearch();
  const meta = DATASETS[d] ?? DATASETS.events;
  return (
    <div>
      <PageHeader eyebrow="Data" title="Alternative data" description="Public datasets pulled from government and open registries for every covered company. Every row links to the record it came from." />
      <div className="mb-5 flex flex-wrap gap-1.5">
        {Object.entries(DATASETS).map(([k, v]) => (
          <Link key={k} to="/app/alt-data" search={{ d: k }} className={cn("rounded-full border px-3 py-1 text-[12px]", k === d ? "bg-foreground text-background" : "bg-card hover:bg-secondary")}>{v.label}</Link>
        ))}
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{meta.blurb} · <span className="font-medium">{meta.source}</span></p>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {SERIES_SETS.has(d) && <Leaders d={d} />}
        {d !== "bank" && d !== "attention" && d !== "complaints" && (
          <Panel title="Latest across coverage" subtitle="Newest 300 records" bodyClassName="p-0 max-h-[900px] overflow-y-auto scrollbar-thin" className={cn(!SERIES_SETS.has(d) && "xl:col-span-2")}>
            <Feed d={d} />
          </Panel>
        )}
      </div>
    </div>
  );
}

function Feed({ d }: { d: string }) {
  const q = useQuery(altFeedQuery(d));
  if (q.isLoading) return <Skeleton className="m-4 h-64" />;
  return <AltEventList rows={q.data ?? []} showTicker max={300} />;
}

function Leaders({ d }: { d: string }) {
  const q = useQuery(altSeriesQuery(d));
  const titles = useMemo(() => [...new Set((q.data ?? []).map((r) => r.title))], [q.data]);
  const title = titles.includes(LEAD_TITLE[d]) ? LEAD_TITLE[d] : titles[0];
  const rows = useMemo(() => (title ? leaderboard(q.data ?? [], title) : []), [q.data, title]);
  return (
    <Panel title={title ?? "Leaderboard"} subtitle="Latest reading per company and change vs a year earlier" bodyClassName="p-0" className="min-w-0">
      {q.isLoading ? <Skeleton className="m-4 h-64" /> : !rows.length ? <p className="px-4 py-6 text-sm text-muted-foreground">Not loaded yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-medium">Company</th><th className="px-2 py-2 font-medium">As of</th><th className="px-2 py-2 text-right font-medium">Latest</th><th className="px-4 py-2 text-right font-medium">vs 1y</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.ticker} className="border-b last:border-0">
                  <td className="px-4 py-1.5"><Link to="/app/companies/$ticker/alt-data" params={{ ticker: r.ticker }} className="font-medium hover:underline">{r.ticker}</Link></td>
                  <td className="num px-2 text-[11px] text-muted-foreground">{r.last.date}{r.last.meta?.ytd ? " (YTD)" : ""}</td>
                  <td className="num px-2 text-right"><a href={r.last.source_url ?? undefined} target="_blank" rel="noreferrer" className="hover:underline">{fmtAlt(r.last.value, r.last.unit)}</a></td>
                  <td className={cn("num px-4 text-right", r.chg == null ? "text-muted-foreground" : r.chg >= 0 ? "text-positive" : "text-negative")}>{r.chg == null || r.last.meta?.ytd ? "—" : `${r.chg >= 0 ? "+" : ""}${(r.chg * 100).toFixed(0)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
