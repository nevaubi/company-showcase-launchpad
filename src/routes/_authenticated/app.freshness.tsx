import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { getDataFreshness } from "@/lib/jobs/freshness.functions";
import type { DataStatus } from "@/lib/jobs/data-freshness";

export const Route = createFileRoute("/_authenticated/app/freshness")({
  head: () => ({
    meta: [
      { title: "Freshness · FiledUnder" },
      { name: "description", content: "Whether each dataset's newest data advanced on time, and which jobs are paused." },
      { property: "og:title", content: "Freshness · FiledUnder" },
      { property: "og:description", content: "Whether each dataset's newest data advanced on time, and which jobs are paused." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: FreshnessPage,
});

export const freshnessQuery = {
  queryKey: ["admin", "data-freshness"],
  queryFn: () => getDataFreshness(),
  refetchInterval: 60_000,
};

const LABEL: Record<DataStatus, string> = { fresh: "On time", stale: "Stale", missing: "No data" };
const TONE: Record<DataStatus, string> = { fresh: "text-positive", stale: "text-negative", missing: "text-muted-foreground" };
const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "None");
const hours = (h: number) => (h >= 48 ? `${Math.round(h / 24)} days` : `${Math.round(h)} h`);

function FreshnessPage() {
  const q = useQuery(freshnessQuery);
  const rows = q.data?.datasets ?? [];
  const paused = q.data?.paused ?? [];
  const bad = rows.filter((r) => r.status !== "fresh").length;
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader
        title="Data freshness"
        description={q.isLoading ? "Checking…" : bad ? `${bad} dataset${bad > 1 ? "s" : ""} did not advance on time.` : "Every dataset advanced on time."}
      />
      <Panel title="Datasets" subtitle="Stale means the newest stored row is older than the expected cadence." bodyClassName="p-0">
        {q.isError ? (
          <p className="p-6 text-sm text-negative">Couldn't load freshness.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-normal">Dataset</th>
                  <th className="px-4 py-2 font-normal">Status</th>
                  <th className="px-4 py-2 font-normal">Expected within</th>
                  <th className="px-4 py-2 font-normal">Newest data</th>
                  <th className="px-4 py-2 text-right font-normal">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">{r.label}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className={TONE[r.status]}>{LABEL[r.status]}</Badge>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{hours(r.maxAgeHours)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{when(r.newest)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{r.ageHours == null ? "None" : hours(r.ageHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <Panel title="Paused jobs" subtitle={`${paused.length} job${paused.length === 1 ? "" : "s"} with a recorded pause reason.`} bodyClassName="p-0">
        {paused.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No paused jobs.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-normal">Job</th>
                  <th className="px-4 py-2 font-normal">Reason</th>
                  <th className="px-4 py-2 font-normal">Since</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {paused.map((p) => (
                  <tr key={p.job}>
                    <td className="px-4 py-2.5 font-medium whitespace-nowrap">{p.job}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{p.reason}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{when(p.since)}</td>
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
