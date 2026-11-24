import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { PageHeader, Panel } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { getDataFreshness } from "@/lib/jobs/freshness.functions";
import type { DataStatus } from "@/lib/jobs/data-freshness";
import { DATASET_LABEL, type ProviderStatus } from "@/lib/jobs/status";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/app/freshness")({
  head: () => ({
    meta: [
      { title: "Freshness · FiledUnder" },
      { name: "description", content: "Whether each dataset advanced on time, and the state of every provider, job and rotation behind it." },
      { property: "og:title", content: "Freshness · FiledUnder" },
      { property: "og:description", content: "Whether each dataset advanced on time, and the state of every provider, job and rotation behind it." },
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

export type FreshnessData = Awaited<ReturnType<typeof getDataFreshness>>;

const LABEL: Record<DataStatus, string> = { fresh: "On time", stale: "Stale", missing: "No data" };
const TONE: Record<DataStatus, string> = { fresh: "text-positive", stale: "text-negative", missing: "text-muted-foreground" };
const PROVIDER_LABEL: Record<ProviderStatus["state"], string> = { closed: "Healthy", probe: "Probe due", open: "Closed" };
const PROVIDER_TONE: Record<ProviderStatus["state"], string> = { closed: "text-positive", probe: "text-warning", open: "text-negative" };
const CLASS_LABEL: Record<string, string> = { quota: "out of credit", config: "configuration", rate: "rate limited", transient: "unreachable", allowance: "free allowance spent" };
/** One quiet line when job health is computed from job_runs (job_health() not in the database). */
function healthNote(h: { unread: string[]; partial: string[] }) {
  const parts = ["Computed from job_runs: the database function job_health() is not installed (migration 0066)."];
  if (h.partial.length) parts.push(`Counts for ${h.partial.join(", ")} are over the newest 1,000 runs.`);
  if (h.unread.length) parts.push(`Not read in time: ${h.unread.join(", ")}.`);
  return parts.join(" ");
}

/** Failed runs that were answers, not failures: the provider had no data, or the run's time budget ran out. */
function answered(j: { empty?: number; cut?: number }) {
  const bits = [j.empty ? `${j.empty} with no data from the provider` : null, j.cut ? `${j.cut} cut short by the run budget` : null].filter(Boolean);
  return bits.length ? `Not counted as failed: ${bits.join(", ")}` : null;
}

const PROBLEM_LABEL = { failing: "Failing", unfinished: "Cut off", silent: "Silent" } as const;

const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "None");
const hours = (h: number) => (h >= 48 ? `${Math.round(h / 24)} days` : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.round(h)} h`);
const ago = (s: string | null, nowMs: number) => {
  if (!s) return "never";
  const h = Math.max(0, (nowMs - Date.parse(s)) / 3_600_000);
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : hours(h);
};
/** Compact UTC time: "20 Nov 04:46". */
const short = (s: string) => {
  const d = new Date(s);
  return `${d.getUTCDate()} ${d.toLocaleString("en", { month: "short", timeZone: "UTC" })} ${d.toISOString().slice(11, 16)}`;
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={cn("px-3.5 py-2 font-normal", className)}>{children}</th>;
}
function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-3.5 py-2", className)}>{children}</td>;
}
function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <table className="w-full text-[13px] sm:table-fixed">
      <thead className="border-b text-left text-[11px] text-muted-foreground">
        <tr>{head}</tr>
      </thead>
      <tbody className="divide-y">{children}</tbody>
    </table>
  );
}
const Empty = ({ children }: { children: ReactNode }) => <p className="px-3.5 py-4 text-[13px] text-muted-foreground">{children}</p>;
const Unavailable = () => <Empty>Not available yet (needs migration 0066).</Empty>;

function Stat({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 px-3.5 py-3">
      <p className="eyebrow">{label}</p>
      <p className={cn("num mt-1 text-xl leading-none", tone)}>{value}</p>
      {note && <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

/** Thin share bar for coverage of the top 100 / 500 / 1,000. */
function Share({ n, of }: { n: number; of: number }) {
  const share = of ? n / of : 0;
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="num w-9 text-right">{n}</span>
      <span className="hidden h-1 w-12 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
        <span className={cn("block h-full rounded-full", share >= 0.95 ? "bg-positive" : share >= 0.6 ? "bg-foreground/40" : "bg-warning")} style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </div>
  );
}

export function FreshnessView({ data, loading, error }: { data?: FreshnessData; loading?: boolean; error?: boolean }) {
  const nowMs = data ? Date.parse(data.at) : Date.now();
  const rows = data?.datasets ?? [];
  const paused = data?.paused ?? [];
  const providers = data?.providers ?? null;
  const alerts = data?.alerts ?? null;
  const jobs = data?.jobs ?? null;
  const stalled = data?.stalled ?? null;
  const coverage = data?.coverage ?? null;
  const bad = rows.filter((r) => r.status !== "fresh").length;
  const closed = providers?.filter((p) => p.state !== "closed") ?? [];
  const problems = jobs?.filter((j) => j.problem) ?? [];
  const pausedCompanies = paused.reduce((n, g) => n + g.count, 0);
  const summary = loading
    ? "Checking…"
    : [bad ? `${bad} dataset${bad > 1 ? "s" : ""} late` : "Every dataset on time", closed.length ? `${closed.length} provider${closed.length > 1 ? "s" : ""} not healthy` : null, alerts?.length ? `${alerts.length} alert${alerts.length > 1 ? "s" : ""} open` : null]
        .filter(Boolean)
        .join(". ") + ".";
  const top1000 = coverage?.length ? coverage.filter((c) => c.top1000 >= 950).length : null;

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader eyebrow="Admin" title="Data freshness" description={summary} />
      {error && <p className="text-sm text-negative">Couldn't load freshness.</p>}

      <section data-section="Summary" className="grid grid-cols-2 divide-x divide-y border-y bg-card/40 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
        <Stat label="Datasets late" value={loading ? "…" : bad} note={`of ${rows.length} tracked`} tone={bad ? "text-negative" : undefined} />
        <Stat label="Providers" value={providers ? `${providers.length - closed.length}/${providers.length}` : "None"} note={closed.length ? closed.map((p) => p.id).join(", ") : "all healthy"} tone={closed.some((p) => p.state === "open") ? "text-negative" : undefined} />
        <Stat label="Open alerts" value={alerts ? alerts.length : "None"} note={alerts?.length ? `${alerts.filter((a) => a.sent).length} emailed` : "nothing to report"} tone={alerts?.length ? "text-warning" : undefined} />
        <Stat label="Paused" value={pausedCompanies} note={`${paused.length} group${paused.length === 1 ? "" : "s"}`} />
        <Stat label="Unfinished runs, 24 h" value={data?.unfinished ? pct(data.unfinished.share) : "None"} note={data?.unfinished ? `${data.unfinished.unfinished} of ${data.unfinished.runs} scheduled runs` : undefined} tone={data?.unfinished && data.unfinished.share >= 0.1 ? "text-warning" : undefined} />
        <Stat label="Top 1,000 covered" value={top1000 == null ? "None" : `${top1000}/${coverage!.length}`} note="datasets at 95% or more" />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div data-section="Providers" className="min-w-0">
          <Panel title="Providers" subtitle="A closed provider holds its calls; one probe goes out on a growing backoff and work resumes by itself." bodyClassName="p-0" collapse={false}>
            {providers == null ? (
              <Unavailable />
            ) : (
              <>
                {closed.length > 0 && (
                  <Table head={<><Th className="w-[28%]">Provider</Th><Th className="w-[20%]">State</Th><Th>Reason</Th><Th className="w-[24%] text-right">Next probe, UTC</Th></>}>
                    {closed.map((p) => (
                      <tr key={p.id}>
                        <Td className="font-medium sm:truncate">{p.id}</Td>
                        <Td>
                          <Badge variant="outline" className={cn("whitespace-nowrap", PROVIDER_TONE[p.state])}>{PROVIDER_LABEL[p.state]}</Badge>
                        </Td>
                        <Td className="text-muted-foreground">
                          <span title={p.message ?? undefined}>{p.cls ? `${CLASS_LABEL[p.cls] ?? p.cls}${p.failures > 1 ? `, ${p.failures} in a row` : ""}` : ""}</span>
                        </Td>
                        <Td className="num text-right text-muted-foreground">{p.retryAt ? short(p.retryAt) : p.state === "probe" ? "now" : ""}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
                <p className={cn("px-3.5 py-2.5 text-[12px] text-muted-foreground", closed.length > 0 && "border-t")}>
                  <span className="text-positive">Healthy</span>: {providers.filter((p) => p.state === "closed").map((p) => p.id).join(", ") || "none"}
                </p>
              </>
            )}
          </Panel>
        </div>
        <div data-section="Alerts" className="min-w-0">
          <Panel title="Alerts" subtitle="Each problem is emailed once, at most one digest per 30 minutes; it clears by itself when fixed." bodyClassName="p-0" collapse={false}>
            {alerts == null ? (
              <Unavailable />
            ) : alerts.length === 0 ? (
              <Empty>No open alerts.</Empty>
            ) : (
              <ul className="divide-y">
                {alerts.map((a) => (
                  <li key={a.key} className="px-3.5 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 text-[13px] font-medium">{a.title}</p>
                      <span className={cn("shrink-0 text-[11px]", a.sent ? "text-muted-foreground" : "text-warning")}>{a.sent ? "Emailed" : "Waiting"}</span>
                    </div>
                    <p className="num mt-0.5 text-[11px] text-muted-foreground">{a.key} · since {when(a.since)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <div data-section="Jobs">
        <Panel title="Jobs, last 24 hours" subtitle="Failing: 5 failed runs in a row (2 for worker steps). Cut off: 30% or more of runs never finished. Silent: no run for 3 times its cadence." bodyClassName="p-0" collapse={false}>
          {data?.health?.error ? (
            <p data-section="Job health source" className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
              Job health could not be read: {data.health.error}
            </p>
          ) : null}
          {data?.health?.source === "job_runs" && (
            <p data-section="Job health source" className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
              {healthNote(data.health)}
            </p>
          )}
          {jobs == null ? (
            <Unavailable />
          ) : (
            <Table
              head={
                <>
                  <Th className="w-[30%]">Job</Th>
                  <Th className="w-[14%]">Status</Th>
                  <Th className="w-[11%] text-right">Runs</Th>
                  <Th className="hidden w-[13%] text-right sm:table-cell">Unfinished</Th>
                  <Th className="hidden w-[11%] text-right md:table-cell">Failed</Th>
                  <Th className="hidden w-[10%] text-right md:table-cell">Streak</Th>
                  <Th className="text-right">Last ok</Th>
                </>
              }
            >
              {jobs.map((j) => (
                <tr key={j.job}>
                  <Td className="sm:truncate">
                    <span className="font-medium">{j.label}</span>
                    {j.label !== j.job && <span className="ml-1.5 hidden text-[11px] text-muted-foreground lg:inline">{j.job}</span>}
                  </Td>
                  <Td className={j.problem ? (j.problem === "failing" ? "text-negative" : "text-warning") : "text-muted-foreground"}>{j.problem ? PROBLEM_LABEL[j.problem] : "Ok"}</Td>
                  <Td className="num text-right">{j.runs}</Td>
                  <Td className={cn("num hidden text-right sm:table-cell", j.unfinishedShare >= 0.3 ? "text-warning" : "text-muted-foreground")}>{j.unfinished ? `${j.unfinished} (${pct(j.unfinishedShare)})` : "0"}</Td>
                  <Td className="num hidden text-right text-muted-foreground md:table-cell">
                    {j.failed}
                    {answered(j) && (
                      <span className="ml-1 text-[11px]" title={answered(j) ?? undefined}>
                        +{(j.empty ?? 0) + (j.cut ?? 0)}
                      </span>
                    )}
                  </Td>
                  <Td className={cn("num hidden text-right md:table-cell", j.fail_streak ? "text-negative" : "text-muted-foreground")}>{j.fail_streak}</Td>
                  <Td className="num text-right text-muted-foreground">{ago(j.last_ok, nowMs)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>

      <div data-section="Coverage">
        <Panel title="Coverage of the top 1,000" subtitle="Companies with at least one row, by 20-day dollar volume rank; age is each covered company's newest row, median and 90th percentile." bodyClassName="p-0" collapse={false}>
          {coverage == null ? (
            <Unavailable />
          ) : (
            <Table
              head={
                <>
                  <Th className="w-[30%]">Dataset</Th>
                  <Th className="hidden text-right sm:table-cell">Top 100</Th>
                  <Th className="hidden text-right sm:table-cell">Top 500</Th>
                  <Th className="text-right">Top 1,000</Th>
                  <Th className="text-right">Median age</Th>
                  <Th className="hidden text-right md:table-cell">90th pct</Th>
                </>
              }
            >
              {coverage.map((c) => (
                <tr key={c.dataset}>
                  <Td className="font-medium sm:truncate">{DATASET_LABEL[c.dataset] ?? c.dataset}</Td>
                  <Td className="hidden sm:table-cell"><Share n={c.top100} of={100} /></Td>
                  <Td className="hidden sm:table-cell"><Share n={c.top500} of={500} /></Td>
                  <Td><Share n={c.top1000} of={1000} /></Td>
                  <Td className="num text-right text-muted-foreground">{c.median_age_hours == null ? "None" : hours(c.median_age_hours)}</Td>
                  <Td className="num hidden text-right text-muted-foreground md:table-cell">{c.p90_age_hours == null ? "None" : hours(c.p90_age_hours)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
      </div>

      <div data-section="Datasets">
        <Panel title="Datasets" subtitle="Stale means the newest stored row is older than its limit; trading-day data gets 24 hours for each weekend day or market holiday." bodyClassName="p-0" collapse={false}>
          <Table
            head={
              <>
                <Th className="w-[38%]">Dataset</Th>
                <Th className="w-[16%]">Status</Th>
                <Th className="hidden sm:table-cell">Limit</Th>
                <Th className="hidden md:table-cell">Newest</Th>
                <Th className="text-right">Age</Th>
              </>
            }
          >
            {rows.map((r) => (
              <tr key={r.key}>
                <Td className="font-medium sm:truncate">{r.label}</Td>
                <Td>
                  <Badge variant="outline" className={cn("whitespace-nowrap", TONE[r.status])}>{LABEL[r.status]}</Badge>
                </Td>
                <Td className="num hidden text-muted-foreground sm:table-cell">{hours(r.maxAgeHours)}</Td>
                <Td className="num hidden md:table-cell">{when(r.newest)}</Td>
                <Td className="num text-right">{r.ageHours == null ? "None" : hours(r.ageHours)}</Td>
              </tr>
            ))}
          </Table>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div data-section="Paused jobs" className="min-w-0">
          <Panel title="Paused jobs" subtitle={`${pausedCompanies} paused, in ${paused.length} group${paused.length === 1 ? "" : "s"}.`} bodyClassName="p-0" collapse={false}>
            {paused.length === 0 ? (
              <Empty>No paused jobs.</Empty>
            ) : (
              <ul className="divide-y">
                {paused.map((g) => (
                  <li key={g.job} className="px-3.5 py-2.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-[13px] font-medium">
                        {g.job}
                        {g.count > 1 && <span className="num ml-1.5 font-normal text-muted-foreground">{g.count} companies</span>}
                      </p>
                      <span className="num shrink-0 text-[11px] text-muted-foreground">{when(g.since)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground" title={g.reason}>{g.reason}</p>
                    {g.sample.length > 0 && <p className="num mt-0.5 text-[11px] text-muted-foreground">{g.sample.join(", ")}{g.count > g.sample.length ? ", …" : ""}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div data-section="Stalled cursors" className="min-w-0">
          <Panel title="Stalled rotations" subtitle="A rotation moves only after its slice was stored; one that has not moved for 3 times its cadence is holding a slice." bodyClassName="p-0" collapse={false}>
            {stalled == null ? (
              <Unavailable />
            ) : stalled.length === 0 ? (
              <Empty>Every rotation is moving.</Empty>
            ) : (
              <Table head={<><Th className="w-[40%]">Rotation</Th><Th className="text-right">Position</Th><Th className="text-right">Tries</Th><Th className="text-right">Last moved</Th></>}>
                {stalled.map((s) => (
                  <tr key={s.job}>
                    <Td className="font-medium sm:truncate">{s.label}</Td>
                    <Td className="num text-right">{s.cursor}</Td>
                    <Td className="num text-right">{s.attempts}</Td>
                    <Td className="num text-right text-muted-foreground">{ago(s.movedAt, nowMs)} ago</Td>
                  </tr>
                ))}
              </Table>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function FreshnessPage() {
  const q = useQuery(freshnessQuery);
  return <FreshnessView data={q.data} loading={q.isLoading} error={q.isError} />;
}
