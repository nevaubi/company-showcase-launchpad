// Worker step (the loop calls it hourly): one job_runs row (job `freshness`) summarising stale/missing
// datasets and paused jobs from the `data_freshness()` aggregate, then the automatic remedies
// (src/lib/jobs/remediation.ts). Its own gate is persisted (job_state `freshness`, cursor = last check
// in epoch s), so restarts and the loop's hourly call never run it more than about once an hour.
// `--force` ignores the gate.
import { log, sb } from "./lib/supa";
import { dataFreshness, groupPaused, pausedJobs } from "@/lib/jobs/data-freshness";
import { checkDue, loopRequestKey, planRemedies, remedyKey } from "@/lib/jobs/remediation";
import { providerKey, routeDecision, routeOf, PROVIDER_IDS, type CircuitRow } from "@/lib/jobs/provider-health";

const nowMs = Date.now();
const now = new Date(nowMs).toISOString();
const nowS = Math.floor(nowMs / 1000);

const { data: gate, error: gateError } = await sb.from("job_state").select("cursor").eq("job", "freshness").maybeSingle();
if (gateError) throw new Error(gateError.message);
if (!process.argv.includes("--force") && !checkDue(gate?.cursor, nowMs)) {
  log(`freshness: checked ${Math.round((nowMs - (gate?.cursor ?? 0) * 1000) / 60_000)} min ago; next check after 55 min`);
  process.exit(0);
}
// Claim the hour before the work, so two overlapping calls do not both remediate.
await sb.from("job_state").upsert({ job: "freshness", cursor: nowS, updated_at: now });

const { data, error } = await sb.rpc("data_freshness");
if (error) throw new Error(error.message);
const report = dataFreshness((data ?? []) as { key: string; newest: string | null }[]);
const { data: st, error: stError } = await sb.from("job_state").select("job,cursor,paused_reason,updated_at").or('paused_reason.not.is.null,job.like."remedy:*",job.like."provider:*"').limit(5000);
if (stError) throw new Error(stError.message);
const rows = (st ?? []) as { job: string; cursor: number | null; paused_reason: string | null; updated_at: string }[];
const paused = pausedJobs(rows);
const bad = report.filter((r) => r.status !== "fresh");

// Remedies. AI steps run only while the reasoning route is healthy.
const receipts = new Map(rows.filter((r) => r.job.startsWith("remedy:")).map((r) => [r.job.slice("remedy:".length), Number(r.cursor ?? 0)]));
const circuits = new Map(rows.filter((r) => r.job.startsWith("provider:")).map((r) => [r.job, r as CircuitRow]));
const aiRoute = routeOf(process.env.IR_REASON_MODEL || "gpt-6.1-sol", process.env).filter((id) => PROVIDER_IDS.includes(id));
const ai = routeDecision(circuits, aiRoute, nowMs);
const actions = planRemedies(bad, receipts, ai.state === "closed", nowMs);
const applied: string[] = [];
const failed: string[] = [];
for (const a of actions) {
  try {
    if (a.apply && a.remedy.kind === "loop") {
      const { error: e } = await sb.from("job_state").upsert({ job: loopRequestKey(a.remedy.step), cursor: nowS, updated_at: now });
      if (e) throw new Error(e.message);
    }
    if (a.apply && a.remedy.kind === "intel") {
      // Due again now: the weekly marker's updated_at is "last good run"; a cleared reason resets its retry count.
      const { error: e } = await sb.from("job_state").update({ updated_at: new Date(0).toISOString(), paused_reason: null }).eq("job", "supply-intel-weekly");
      if (e) throw new Error(e.message);
    }
    if (a.receipt) {
      const { error: e } = await sb.from("job_state").upsert({ job: remedyKey(a.key), cursor: nowS, updated_at: now });
      if (e) throw new Error(e.message);
    }
    if (a.apply) applied.push(`${a.key}: ${a.remedy.kind === "loop" ? `loop ${a.remedy.step}` : "supply intel due"}`);
  } catch (e) {
    failed.push(`${a.key}: ${(e as Error).message.slice(0, 120)}`);
  }
}

const groups = groupPaused(paused);
await sb.from("job_runs").insert({
  job: "freshness",
  started_at: now,
  finished_at: new Date().toISOString(),
  ok: bad.length === 0 && failed.length === 0,
  items: bad.length,
  detail: {
    stale: bad.map(({ key, label, newest, ageHours, maxAgeHours, status }) => ({ key, label, newest, ageHours, maxAgeHours, status })),
    paused: groups.map((g) => ({ job: g.job, count: g.count, reason: g.reason.slice(0, 160), since: g.since })),
    remedies: actions.map((a) => ({ key: a.key, apply: a.apply, why: a.why })),
    applied,
    failed,
    aiRoute: { providers: aiRoute, state: ai.state },
    checked: report.length,
  } as never,
});
log(`freshness: ${bad.length}/${report.length} stale or missing; ${groups.length} paused groups; ${applied.length} remedies applied`);
for (const b of bad) log(`  ${b.status} ${b.label}: newest ${b.newest ?? "none"} (limit ${b.maxAgeHours}h)`);
for (const a of actions) log(`  remedy ${a.key}: ${a.why}`);
for (const g of groups) log(`  paused ${g.job}${g.count > 1 ? ` (${g.count})` : ""}: ${g.reason.slice(0, 100)}`);
for (const f of failed) log(`  remedy failed ${f}`);
process.exit(0);
