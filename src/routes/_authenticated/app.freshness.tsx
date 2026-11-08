import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { freshnessReport, type FreshStatus } from "@/lib/jobs/freshness";

export const Route = createFileRoute("/_authenticated/app/freshness")({
  head: () => ({
    meta: [
      { title: "Admin · Data freshness — Filed Under" },
      { name: "description", content: "Which data sources are on time, late or failing." },
      { property: "og:title", content: "Admin · Data freshness — Filed Under" },
      { property: "og:description", content: "Which data sources are on time, late or failing." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FreshnessPage,
});

export const freshnessQuery = {
  queryKey: ["admin", "freshness"],
  queryFn: async () => {
    const since = new Date(Date.now() - 3 * 86400000).toISOString();
    const { data, error } = await supabase
      .from("job_runs")
      .select("job,started_at,finished_at,ok,items")
      .gte("started_at", since)
      .order("started_at", { ascending: false })
      .limit(5000);
    if (error) throw error;
    return freshnessReport(data ?? []);
  },
  refetchInterval: 60_000,
};

const LABEL: Record<FreshStatus, string> = { "on-time": "On time", late: "Late", failing: "Failing", never: "No runs" };
const TONE: Record<FreshStatus, string> = {
  "on-time": "text-positive",
  late: "text-negative",
  failing: "text-negative",
  never: "text-muted-foreground",
};
const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "—");
const every = (m: number) => (m >= 60 ? `${m / 60}h` : `${m} min`);

function FreshnessPage() {
  const q = useQuery(freshnessQuery);
  const rows = q.data ?? [];
  const bad = rows.filter((r) => r.status === "late" || r.status === "failing").length;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Data freshness"
        description={
          q.isLoading ? "Checking…" : bad ? `${bad} source${bad > 1 ? "s" : ""} need attention.` : "Every source is on time."
        }
      />
      <Panel title="Sources" subtitle="Late = no successful run in twice the expected time. Failing = last 3 runs errored." bodyClassName="p-0">
        {q.isError ? (
          <p className="p-6 text-sm text-negative">Couldn't load job runs.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-normal">Source</th>
                  <th className="px-4 py-2 font-normal">Status</th>
                  <th className="px-4 py-2 font-normal">Expected</th>
                  <th className="px-4 py-2 font-normal">Last success</th>
                  <th className="px-4 py-2 text-right font-normal">Rows, 24h</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.source.job}>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">{r.source.label}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={TONE[r.status]}>
                        {LABEL[r.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">
                      every {every(r.source.everyMin)}
                      {r.source.marketHours ? ", market hours" : ""}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{when(r.lastOk)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.itemsDay.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
