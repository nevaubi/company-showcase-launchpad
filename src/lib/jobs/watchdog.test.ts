import { describe, expect, it } from "vitest";
import { alerts, planAlerts, alertKey, DIGEST_KEY, type JobHealthRow, type StateRow, type WatchdogInput } from "./watchdog";
import { dataFreshness } from "./data-freshness";
import { ownerHolds } from "./lane-hold";
import { REMEDY_KEYS } from "./remediation";

const NOW = Date.parse("2026-11-20T15:00:00Z"); // a Friday, market hours
const iso = (minAgo: number) => new Date(NOW - minAgo * 60_000).toISOString();
const job = (j: Partial<JobHealthRow> & { job: string }): JobHealthRow => ({ runs: 30, unfinished: 0, failed: 0, last_ok: iso(1), last_run: iso(1), fail_streak: 0, ...j });
const SCHEDULED = ["prices", "sec", "macro", "filing-cache", "ir-docs", "estimates", "alt-data", "gov-data", "sec-discover", "partner-mirror", "call-archive", "call-archive-evidence", "call-source-worker", "call-discovery-worker", "call-commitments-worker", "filing-steps", "freshness", "official-source-refresh"].map((j) => job({ job: j }));

function input(over: Partial<WatchdogInput> = {}, freshness: { key: string; newest: string | null }[] = []): WatchdogInput {
  const all = dataFreshness([{ key: "worker_heartbeat", newest: iso(2) }, ...freshness], new Date(NOW)).map((f) => (freshness.some((x) => x.key === f.key) || f.key === "worker_heartbeat" ? f : { ...f, status: "fresh" as const }));
  return { freshness: all, jobs: SCHEDULED, states: [], ...over };
}
const keys = (i: WatchdogInput) => alerts(i, NOW, REMEDY_KEYS).map((a) => a.key);

describe("watchdog rules", () => {
  it("quiet when everything is healthy", () => {
    expect(keys(input())).toEqual([]);
  });
  it("reports a silent managed call importer and native verification independently", () => {
    const jobs = SCHEDULED.filter(j => !j.job.startsWith("call-archive"));
    expect(keys(input({ jobs })).sort()).toEqual(["job-silent:call-archive", "job-silent:call-archive-evidence"]);
  });
  it("a collector the owner stopped raises nothing; the same silence without the hold does", () => {
    const silent = [{ key: "vendor_backfill", newest: iso(26 * 60) }];
    expect(keys(input({}, silent))).toEqual(["stale:vendor_backfill"]);
    const holds = ownerHolds([{ job: "vendor-backfill", paused_reason: "owner: hold. Stopped (since 2026-11-19)" }]);
    const held = dataFreshness([{ key: "worker_heartbeat", newest: iso(2) }, ...silent], new Date(NOW), holds).map((f) => (f.key === "vendor_backfill" || f.key === "worker_heartbeat" ? f : { ...f, status: "fresh" as const }));
    expect(held.find((f) => f.key === "vendor_backfill")!.status).toBe("held");
    expect(keys({ freshness: held, jobs: SCHEDULED, states: [] })).toEqual([]);
  });
  it("worker heartbeat older than 20 minutes", () => {
    expect(keys(input({}, [{ key: "worker_heartbeat", newest: iso(25) }]))).toEqual(["worker-heartbeat"]);
  });
  it("five failures in a row for an HTTP job, two for a worker step; the freshness check itself is excluded", () => {
    const jobs = [...SCHEDULED.filter((j) => j.job !== "macro" && j.job !== "freshness"), job({ job: "macro", fail_streak: 5 }), job({ job: "loop:canon", runs: 2, fail_streak: 2 }), job({ job: "freshness", fail_streak: 9 })];
    expect(keys(input({ jobs })).sort()).toEqual(["job-failing:loop:canon", "job-failing:macro"]);
  });
  it("high unfinished rate with enough runs", () => {
    const jobs = [...SCHEDULED.filter((j) => j.job !== "sec-discover"), job({ job: "sec-discover", runs: 200, unfinished: 70 })];
    expect(keys(input({ jobs }))).toEqual(["unfinished:sec-discover"]);
  });
  it("a scheduled job silent for three times its cadence", () => {
    const jobs = SCHEDULED.map((j) => (j.job === "alt-data" ? { ...j, last_run: iso(15) } : j));
    expect(keys(input({ jobs }))).toEqual(["job-silent:alt-data"]);
  });
  it("prices are not expected outside market hours", () => {
    const night = Date.parse("2026-11-21T03:00:00Z");
    const jobs = SCHEDULED.map((j) => ({ ...j, last_run: new Date(night - 60_000).toISOString() })).map((j) => (j.job === "prices" ? { ...j, last_run: iso(60 * 4) } : j));
    // (22:00 in New York: the options collection has finished its list for the session)
    const states: StateRow[] = [{ job: "options-collect", cursor: 1844, paused_reason: "session:20261120 done", updated_at: new Date(night - 90 * 60_000).toISOString() }];
    const i = { ...input({ jobs, states }), freshness: input().freshness.map((f) => (f.key === "worker_heartbeat" ? { ...f, newest: new Date(night - 60_000).toISOString() } : f)) };
    expect(alerts(i, night, REMEDY_KEYS).map((a) => a.key)).toEqual([]);
  });
  it("an AI provider out of credit or misconfigured; the routine free-allowance stop is not an alert", () => {
    const states: StateRow[] = [
      { job: "provider:openai-paid", cursor: 1, paused_reason: "quota: OpenAI 429 credit_balance_exhausted [n=3]", updated_at: iso(5) },
      { job: "provider:gateway", cursor: 1, paused_reason: "config: Invalid model ID [n=1]", updated_at: iso(5) },
      { job: "provider:openai-free-mini", cursor: 1, paused_reason: "allowance: free allowance spent [n=1]", updated_at: iso(5) },
    ];
    const a = alerts(input({ states }), NOW, REMEDY_KEYS);
    expect(a.map((x) => x.key)).toEqual(["provider:openai-paid", "provider:gateway"]);
    expect(a[0].action).toMatch(/Add credit/);
    expect(a[1].action).toMatch(/Fix the configuration/);
    expect(a.every((x) => x.graceMin === 120)).toBe(true);
  });
  it("options blocked: both routes refused, while the back-off lasts", () => {
    const evening = Date.parse("2026-11-20T22:00:00Z"); // 17:00 in New York
    const at = (m: number) => new Date(evening + m * 60_000).toISOString();
    const base = { ...input(), freshness: input().freshness.map((f) => (f.key === "worker_heartbeat" ? { ...f, newest: at(-1) } : f)), jobs: SCHEDULED.map((j) => ({ ...j, last_run: at(-1), last_ok: at(-1) })) };
    const blocked: StateRow = { job: "options-collect", cursor: 300, paused_reason: `session:20261120 blocked until ${at(10)} Yahoo refused the collector (HTTP 429) and the page reader's 600 requests for the session are used [n=2]`, updated_at: at(0) };
    const a = alerts({ ...base, states: [blocked] }, evening + 60_000, REMEDY_KEYS).filter((x) => x.key.startsWith("options"));
    expect(a.map((x) => x.key)).toEqual(["options-blocked"]);
    expect(a[0].title).toBe("Options collection blocked: Yahoo refused the collector (HTTP 429) and the page reader's 600 requests for the session are used");
    // once the back-off has run out the collector tries again: no block alert, and the row is recent
    expect(alerts({ ...base, states: [blocked] }, evening + 11 * 60_000, REMEDY_KEYS).filter((x) => x.key.startsWith("options"))).toEqual([]);
  });
  it("options behind: neither lane moved for 45 minutes inside the window; a finished list or a holiday is not behind", () => {
    const evening = Date.parse("2026-11-20T23:00:00Z"); // 18:00 in New York, 100 minutes into the window
    const at = (m: number) => new Date(evening + m * 60_000).toISOString();
    const base = { ...input(), freshness: input().freshness.map((f) => (f.key === "worker_heartbeat" ? { ...f, newest: at(-1) } : f)), jobs: SCHEDULED.map((j) => ({ ...j, last_run: at(-1), last_ok: at(-1) })) };
    const run = (states: StateRow[]) => alerts({ ...base, states }, evening, REMEDY_KEYS).map((x) => x.key).filter((k) => k.startsWith("options"));
    const worker = (reason: string, minAgo: number): StateRow => ({ job: "options-collect", cursor: 300, paused_reason: reason, updated_at: at(-minAgo) });
    expect(run([worker("session:20261120", 50)])).toEqual(["options-behind"]);
    expect(run([])).toEqual(["options-behind"]);
    expect(run([worker("session:20261120", 10)])).toEqual([]);
    expect(run([worker("session:20261120", 50), { job: "options-app", cursor: 12, paused_reason: "session:20261120", updated_at: at(-2) }])).toEqual([]);
    expect(run([worker("session:20261120 done", 80)])).toEqual([]);
    expect(run([worker("session:20261120 closed: Yahoo's newest quote is from 2026-11-19", 80)])).toEqual([]);
  });
  it("a stale dataset alerts at once without a remedy, and after six hours of staleness with one, whatever the remedy receipt says", () => {
    const stale = [{ key: "supply_signals", newest: iso(60 * 24 * 15) }, { key: "macro", newest: iso(60 * 30) }];
    for (const states of [[], [{ job: "remedy:supply_signals", cursor: Math.floor((NOW - 3600_000) / 1000), paused_reason: null, updated_at: iso(60) }]]) {
      const a = alerts(input({ states }, stale), NOW, REMEDY_KEYS);
      expect(a.map((x) => [x.key, x.graceMin]).sort()).toEqual([["stale:macro", 0], ["stale:supply_signals", 360]]);
    }
  });
});

describe("alert episodes and the digest", () => {
  const a = (key: string, graceMin = 0) => ({ key, title: `${key} broke`, tried: "t", action: "x", graceMin });
  const nowS = Math.floor(NOW / 1000);
  it("a new alert opens an episode and is sent in one digest", () => {
    const p = planAlerts([a("worker-heartbeat"), a("stale:macro")], [], NOW);
    expect(p.send.map((s) => s.key)).toEqual(["worker-heartbeat", "stale:macro"]);
    expect(p.digestState).toBe(`stale:macro@${nowS},worker-heartbeat@${nowS}`);
    expect(p.upsert.find((r) => r.job === alertKey("worker-heartbeat"))!.paused_reason).toMatch(/^sent: /);
    expect(p.upsert.find((r) => r.job === DIGEST_KEY)!.cursor).toBe(nowS);
  });
  it("an episode already sent is not sent again", () => {
    const rows = [{ job: alertKey("worker-heartbeat"), cursor: nowS - 3600, paused_reason: "sent: x", updated_at: iso(60) }];
    const p = planAlerts([a("worker-heartbeat")], rows, NOW);
    expect(p.send).toEqual([]);
    expect(p.upsert).toEqual([]);
  });
  it("a cleared condition is held for the recovery time; it ends only after a real recovery, and a recurrence then is a new email", () => {
    const rows: StateRow[] = [{ job: alertKey("stale:macro"), cursor: nowS - 3600, paused_reason: "sent: x", updated_at: iso(60) }];
    const held = planAlerts([], rows, NOW);
    expect(held.close).toEqual([]);
    expect(held.upsert).toEqual([{ job: alertKey("stale:macro"), cursor: nowS - 3600, paused_reason: "cleared sent: x", updated_at: new Date(NOW).toISOString() }]);
    expect(planAlerts([], held.upsert, NOW + 5 * 3600_000).close).toEqual([]);
    expect(planAlerts([], held.upsert, NOW + 6 * 3600_000).close).toEqual([alertKey("stale:macro")]);
    const again = planAlerts([a("stale:macro")], [], NOW + 6 * 3600_000 + 60_000);
    expect(again.send).toHaveLength(1);
  });
  it("a condition that comes back within the hold resumes its episode and sends nothing", () => {
    const rows: StateRow[] = [{ job: alertKey("stale:macro"), cursor: nowS - 3600, paused_reason: "cleared sent: x", updated_at: iso(30) }];
    const p = planAlerts([a("stale:macro")], rows, NOW);
    expect(p.send).toEqual([]);
    expect(p.close).toEqual([]);
    expect(p.upsert).toEqual([{ job: alertKey("stale:macro"), cursor: nowS - 3600, paused_reason: "sent: stale:macro broke", updated_at: new Date(NOW).toISOString() }]);
  });
  it("the worker heartbeat ends its episode after one clear hour", () => {
    const rows: StateRow[] = [{ job: alertKey("worker-heartbeat"), cursor: nowS - 7200, paused_reason: "cleared sent: x", updated_at: iso(61) }];
    expect(planAlerts([], rows, NOW).close).toEqual([alertKey("worker-heartbeat")]);
  });
  it("grace period: a provider alert waits two hours before an email", () => {
    const first = planAlerts([a("provider:openai-paid", 120)], [], NOW);
    expect(first.send).toEqual([]);
    expect(first.upsert[0]).toMatchObject({ job: alertKey("provider:openai-paid"), cursor: nowS });
    const rows = first.upsert;
    expect(planAlerts([a("provider:openai-paid", 120)], rows, NOW + 119 * 60_000).send).toEqual([]);
    expect(planAlerts([a("provider:openai-paid", 120)], rows, NOW + 120 * 60_000).send).toHaveLength(1);
  });
  it("at most one digest per 30 minutes; held alerts go out in the next one", () => {
    const rows: StateRow[] = [{ job: DIGEST_KEY, cursor: nowS - 600, paused_reason: null, updated_at: iso(10) }];
    const p = planAlerts([a("stale:macro")], rows, NOW);
    expect(p.send).toEqual([]);
    expect(p.upsert.map((r) => r.paused_reason)).toEqual(["open: stale:macro broke"]);
    const later = planAlerts([a("stale:macro")], [...rows, ...p.upsert], NOW + 21 * 60_000);
    expect(later.send.map((s) => s.key)).toEqual(["stale:macro"]);
    expect(later.send[0].since).toBe(new Date(nowS * 1000).toISOString());
  });
});
