// Worker step (daily): one job_runs row (job `freshness`) summarising stale/missing datasets and every
// paused job, from the `data_freshness()` aggregate (so no row limit can hide old sources).
import { log, sb } from "./lib/supa";
import { dataFreshness, pausedJobs } from "@/lib/jobs/data-freshness";

const now = new Date().toISOString();
const { data, error } = await sb.rpc("data_freshness");
if (error) throw new Error(error.message);
const report = dataFreshness((data ?? []) as { key: string; newest: string | null }[]);
const { data: st } = await sb.from("job_state").select("job,paused_reason,updated_at").not("paused_reason", "is", null);
const paused = pausedJobs(st ?? []);
const bad = report.filter((r) => r.status !== "fresh");
await sb.from("job_runs").insert({ job: "freshness", started_at: now, finished_at: now, ok: bad.length === 0, items: bad.length, detail: { stale: bad.map(({ key, label, newest, ageHours, maxAgeHours, status }) => ({ key, label, newest, ageHours, maxAgeHours, status })), paused, checked: report.length } as never });
log(`freshness: ${bad.length}/${report.length} stale or missing; ${paused.length} paused`);
for (const b of bad) log(`  ${b.status} ${b.label}: newest ${b.newest ?? "none"} (limit ${b.maxAgeHours}h)`);
for (const p of paused) log(`  paused ${p.job}: ${p.reason.slice(0, 100)}`);
process.exit(0);
