/**
 * Durable official-data ingestion beside the existing IR worker. Independent leases protect
 * source imports, refreshes and larger ABS files. Reads wait on the shared database back-pressure gate.
 * No browser credentials, temporary upload tickets, or local scratch paths are needed here.
 * Disable lanes with OFFICIAL_SOURCES_ENABLED=0, OFFICIAL_REFRESH_ENABLED=0 or ABS_BULK_ENABLED=0.
 * FIELD_COUNTS_ENABLED=1 turns on the field counts step of the import lane (migration 0070; unset is off).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sb, dbGate, log, sleep } from "./lib/supa";
import { heldReason, working } from "./lib/lanes";
import {
  SOURCE_WORKER_JOB,
  SOURCE_REFRESH_JOB,
  ABS_WORKER_JOB,
  WORKER_LEASE_MS,
  RESOURCE_WAIT_EXIT,
  canStartOfficialChild,
  enabled,
  retryDelay,
  safeError,
  childReceipt,
  ABS_MOVE_PAUSE_MS,
  absAfterRun,
  absLeftFromReceipt,
  absNextTurn,
  ABS_SEEN_KEY,
  absSeenFromJson,
  absSeenToJson,
  type AbsSeen,
  type AbsStay,
} from "./lib/official-worker-plan";
import { absWatchList } from "./lib/abs-watch-list";
import { sweepRunReceipts, takeRunReceipt } from "./lib/run-receipt";
import { sweepRefreshFolders, trimSourceCache } from "./lib/source-cache";
import { snapshotStatsStep, statsOnlyRow, type StatsList, type StatsOutcome } from "./lib/snapshot-stats";
import { FIELD_COUNTS_CHILD_MS, FIELD_COUNTS_SCRIPT, fieldCountsEnabled, fieldCountsStep } from "./lib/field-counts-step";

const owner = `official:${process.env.RENDER_INSTANCE_ID ?? "worker"}:${randomUUID()}`;
const WORK = process.env.OFFICIAL_SOURCE_WORK_DIR ?? "/var/data/official-sources";
/** Where a child leaves its account of a run for the worker to store with the run's receipt. */
const RECEIPTS = join(WORK, "receipts");
try {
  mkdirSync(RECEIPTS, { recursive: true });
  // Receipts a previous worker process never read (it was stopped while a child ran).
  const swept = sweepRunReceipts(RECEIPTS);
  if (swept) log("official-source-worker", `removed ${swept} unread receipt files older than a day`);
  // Response bodies of failed or held refresh collections, kept as evidence for a week (review S5).
  const old = sweepRefreshFolders(WORK);
  if (old.length) log("official-source-worker", `removed ${old.length} refresh evidence folders older than 7 days`, old.slice(0, 5).join(", "));
} catch (e) {
  // Without the folder the children still run; their receipts then say only how each process ended.
  log("official-source-worker", "receipt folder unavailable", safeError(e));
}
const children = new Set<ChildProcess>();
let replayChild: ChildProcess | null = null;
let waitingForReplay = 0;
let stopped = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    stopped = true;
    for (const child of children) child.kill(signal);
  });

type Lease = { job: string; renew: () => Promise<boolean>; release: () => Promise<void> };
function memoryValue(paths: string[]): number | null {
  for (const path of paths) {
    try {
      const raw = readFileSync(path, "utf8").trim();
      const value = raw === "max" ? NaN : Number(raw);
      if (raw && Number.isFinite(value) && value >= 0 && value < 1e15) return value;
    } catch { /* Local environments may not expose a container memory limit. */ }
  }
  return null;
}

function hasMemoryHeadroom(): boolean {
  return canStartOfficialChild(
    memoryValue(["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]),
    memoryValue(["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]),
    children.size,
  );
}

/** A lane the owner stopped looks again this often; it starts nothing meanwhile. */
const HELD_LOOK_MS = 60_000;
const heldSaid = new Set<string>();
/** The owner holds this lane (src/lib/jobs/lanes.ts): say so once, wait, and tell the loop there is no lease. */
async function heldWait(job: string): Promise<boolean> {
  const why = await heldReason(job);
  if (why == null) {
    if (heldSaid.delete(job)) log(job, "released by the owner");
    return false;
  }
  if (!heldSaid.has(job)) {
    heldSaid.add(job);
    log(job, `stopped by the owner (${why.slice(0, 140)})`);
  }
  await sleep(HELD_LOOK_MS);
  return true;
}

async function claim(job: string): Promise<Lease | null> {
  if (await heldWait(job)) return null;
  await dbGate(job);
  const seeded = await sb
    .from("job_state")
    .upsert({ job, cursor: 0 }, { onConflict: "job", ignoreDuplicates: true });
  if (seeded.error) throw new Error(seeded.error.message);
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("job_state")
    .update({
      paused_reason: owner,
      lease_until: new Date(Date.now() + WORKER_LEASE_MS).toISOString(),
      updated_at: now,
    })
    .eq("job", job)
    .or(`lease_until.is.null,lease_until.lt.${now}`)
    .select("job");
  if (error) throw new Error(error.message);
  if (!data?.length) return null;
  return {
    job,
    async renew() {
      const result = await sb
        .from("job_state")
        .update({
          lease_until: new Date(Date.now() + WORKER_LEASE_MS).toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("job", job)
        .eq("paused_reason", owner)
        .select("job");
      return !result.error && !!result.data?.length;
    },
    async release() {
      const result = await sb
        .from("job_state")
        .update({ lease_until: null, paused_reason: null, updated_at: new Date().toISOString() })
        .eq("job", job)
        .eq("paused_reason", owner);
      if (result.error) log(job, "lease release failed", safeError(result.error));
    },
  };
}

type ChildEnd = { code: number | null; told: Record<string, unknown> | null };

async function childRun(
  lease: Lease,
  script: string,
  args: string[],
  maxMs: number,
  /** work the lane does right after the child, recorded in the same job_runs row; never throws */
  after?: () => Promise<Record<string, unknown>>,
): Promise<ChildEnd> {
  const replay = lease.job === 'setup-replay-worker';
  // Official imports/refreshes get the next slot. Let the lower-priority replay finish its current
  // ticker transaction, then start the heavier child. A hard stop leaves a recoverable ticker lease.
  if (!replay && replayChild && replayChild.exitCode == null && replayChild.signalCode == null) {
    const child = replayChild;
    waitingForReplay++;
    try {
      await new Promise<void>(resolve => {
        const timeout = setTimeout(() => child.kill('SIGKILL'), 12_000);
        timeout.unref();
        child.once('close', () => { clearTimeout(timeout); resolve(); });
        child.kill('SIGTERM');
      });
    } finally { waitingForReplay--; }
  }
  if (stopped || !hasMemoryHeadroom() || (replay && (waitingForReplay > 0 || children.size > 0 || cpuContended()))) {
    log(lease.job, "waiting for worker capacity before starting new work");
    return { code: RESOURCE_WAIT_EXIT, told: null };
  }
  const started = new Date().toISOString();
  const receiptFile = join(RECEIPTS, `${lease.job}-${randomUUID()}.json`);
  const child = spawn("bun", [script, ...args, `--receipt=${receiptFile}`], {
    stdio: "inherit",
    env: process.env,
  });
  children.add(child);
  if (replay) replayChild = child;
  let killed = false;
  let heldStop = false;
  let renewing = false;
  const done = working(lease.job);
  const stop = () => {
    killed = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
  };
  const timer = setTimeout(stop, maxMs);
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void (async () => {
      // A hold placed while the child runs stops it at the next heartbeat.
      if ((await heldReason(lease.job)) != null) {
        heldStop = true;
        return false;
      }
      return lease.renew();
    })()
      .then((ok) => {
        if (!ok) stop();
      }, stop)
      .finally(() => {
        renewing = false;
      });
  }, 45_000);
  const code = await new Promise<number | null>((resolve) => {
    child.once("error", () => resolve(1));
    child.once("exit", resolve);
  });
  clearTimeout(timer);
  clearInterval(heartbeat);
  done();
  children.delete(child);
  if (replayChild === child) replayChild = null;
  const result = killed ? 124 : code;
  // What the child says it did (datasets checked, filings stored, what failed and why) goes into the
  // row beside how the process ended. Rows of data are still counted only by committed snapshots and loads.
  const told = takeRunReceipt(receiptFile);
  const row = childReceipt({
    child: script,
    exitCode: result,
    killed,
    seconds: (Date.now() - Date.parse(started)) / 1000,
    told,
  });
  if (heldStop) Object.assign(row.detail, { stopped: "stopped by the owner's hold" });
  if (after && !heldStop) Object.assign(row.detail, await after().catch((e: unknown) => ({ after_error: safeError(e) })));
  const receipt = await sb.from("job_runs").insert({
    job: lease.job,
    started_at: started,
    finished_at: new Date().toISOString(),
    ok: row.ok,
    items: row.items,
    detail: row.detail,
  });
  if (receipt.error) log(lease.job, "receipt failed", safeError(receipt.error));
  return { code: result, told };
}

async function sourceLoop() {
  let failures = 0;
  // Snapshot statistics after each pass (source_compute_snapshot_stats, migration 0069): a quiet no-op until
  // the function exists, one snapshot per call, bounded in time, and never a reason to back off this lane or a
  // failed run of it (scripts/lib/snapshot-stats.ts).
  // Published snapshots without computed statistics, newest first: ids only, paged (1,153 snapshots today).
  const statsList: StatsList = async () => {
    const done = new Set<string>();
    for (let from = 0; from < 20_000; from += 1000) {
      const page = await sb.from("source_snapshot_stats" as never).select("snapshot_id").not("computed_at", "is", null).order("snapshot_id").range(from, from + 999);
      if (page.error) return { error: page.error };
      const rows = (page.data ?? []) as { snapshot_id: string }[];
      for (const r of rows) done.add(r.snapshot_id);
      if (rows.length < 1000) break;
    }
    const ids: string[] = [];
    for (let from = 0; from < 20_000; from += 1000) {
      const page = await sb.from("source_snapshots" as never).select("id").eq("status", "ready")
        .order("published_at", { ascending: false, nullsFirst: false }).order("id").range(from, from + 999);
      if (page.error) return { error: page.error };
      const rows = (page.data ?? []) as { id: string }[];
      for (const r of rows) if (!done.has(r.id)) ids.push(r.id);
      if (rows.length < 1000) break;
    }
    return { ids };
  };
  const stats = snapshotStatsStep({
    rpc: (fn, args, signal) => sb.rpc(fn, args).abortSignal(signal),
    list: statsList,
    log: (line) => log(SOURCE_WORKER_JOB, line),
  });
  const statsPass = async (lease: Lease): Promise<StatsOutcome> => {
    await dbGate("official-source-stats");
    // An import child may have run for minutes: the lease must outlast this call too.
    if (!(await lease.renew().catch(() => false))) return { status: "skipped", reason: "the lane's lease could not be renewed" };
    return await stats();
  };
  // Field counts of published snapshots (scripts/lib/field-counts-step.ts, migration 0070): off unless
  // FIELD_COUNTS_ENABLED=1; only when no snapshot waits to be imported; a quiet no-op until the table exists; one
  // bounded child under this lane's lease, recorded in job_runs by childRun; never a reason to back off this lane.
  const fieldCounts = fieldCountsEnabled(process.env.FIELD_COUNTS_ENABLED)
    ? fieldCountsStep({
        probe: async () => {
          await dbGate("official-field-counts");
          return await sb.from("source_field_counts" as never).select("snapshot_id").limit(1);
        },
        log: (line) => log(SOURCE_WORKER_JOB, line),
      })
    : null;
  const fieldCountsPass = async (lease: Lease) => {
    if (!fieldCounts) return;
    const outcome = await fieldCounts.pass(async (args) => {
      if (!(await lease.renew().catch(() => false))) return { code: RESOURCE_WAIT_EXIT, told: null };
      return await childRun(lease, FIELD_COUNTS_SCRIPT, args, FIELD_COUNTS_CHILD_MS);
    });
    if (outcome.status === "probe_failed") log(SOURCE_WORKER_JOB, `field counts: ${outcome.error}`);
  };
  while (!stopped) {
    let lease: Lease | null = null;
    try {
      lease = await claim(SOURCE_WORKER_JOB);
      if (!lease) {
        await sleep(30_000);
        continue;
      }
      const held = lease;
      const pending = await sb
        .from("source_snapshots" as never)
        .select("id")
        .eq("status", "staging")
        .limit(1);
      if (pending.error) throw new Error(pending.error.message);
      if (pending.data?.length) {
        const { code, told } = await childRun(
          held,
          "scripts/source-import.ts",
          ["--all", "--max-snapshots=25", "--max-runtime-seconds=480"],
          570_000,
          async () => ({ stats: await statsPass(held) }),
        );
        failures = code === 0 || code === RESOURCE_WAIT_EXIT ? 0 : failures + 1;
        // new published snapshots get their field counts at the next idle pass
        if (typeof told?.published === "number" && told.published > 0) fieldCounts?.wake();
      } else {
        failures = 0;
        const started = new Date().toISOString();
        const row = statsOnlyRow(await statsPass(held));
        if (row) {
          const written = await sb.from("job_runs").insert({ job: SOURCE_WORKER_JOB, started_at: started,
            finished_at: new Date().toISOString(), ...row });
          if (written.error) log(SOURCE_WORKER_JOB, "statistics receipt failed", safeError(written.error));
        }
        await fieldCountsPass(held).catch((e: unknown) => log(SOURCE_WORKER_JOB, "field counts", safeError(e)));
      }
    } catch (e) {
      failures++;
      log(SOURCE_WORKER_JOB, safeError(e));
    } finally {
      await lease?.release();
    }
    if (!stopped) await sleep(failures ? retryDelay(failures) : 30_000);
  }
}

async function refreshLoop() {
  let failures = 0;
  while (!stopped) {
    let lease: Lease | null = null;
    try {
      lease = await claim(SOURCE_REFRESH_JOB);
      if (!lease) {
        await sleep(30_000);
        continue;
      }
      const { code } = await childRun(
        lease,
        "scripts/source-refresh.ts",
        ["--all", "--max-datasets=8", "--max-runtime-seconds=480"],
        570_000,
      );
      failures = code === 0 || code === RESOURCE_WAIT_EXIT ? 0 : failures + 1;
    } catch (e) {
      failures++;
      log(SOURCE_REFRESH_JOB, safeError(e));
    } finally {
      await lease?.release();
    }
    // Per-source due times are durable in job_state. This is only the scheduler's poll cadence.
    if (!stopped) await sleep(failures ? retryDelay(failures) : 5 * 60_000);
  }
}

async function absLoop() {
  // These optional CIKs are discovery candidates from the supplied workbook, not company ties.
  // The existing SEC reader verifies the filing's real issuer/depositor and file family.
  const watch = absWatchList();
  const cache = join(WORK, "sec");
  mkdirSync(cache, { recursive: true });
  let failures = 0;
  // What the lane knows of each watched CIK, by index: when it was last worked and what it had left
  // (rules: absNextTurn, absAfterRun). Looks that left nothing are kept in job_state, so a restart of
  // the worker does not look at all 91 issuers again.
  const ciks = watch.map((w) => w.cik);
  let seen = new Map<number, AbsSeen>();
  try {
    const kept = await sb.from("job_state").select("paused_reason").eq("job", ABS_SEEN_KEY).maybeSingle();
    if (kept.error) throw new Error(kept.error.message);
    seen = absSeenFromJson(kept.data?.paused_reason, ciks, Date.now());
    if (seen.size) log(ABS_WORKER_JOB, `${seen.size} of ${watch.length} issuers were looked at within six hours and are not looked at again yet`);
  } catch (e) {
    log(ABS_WORKER_JOB, "what was looked at before the restart could not be read", safeError(e));
  }
  const keepSeen = async () => {
    const r = await sb.from("job_state").upsert({ job: ABS_SEEN_KEY, cursor: seen.size, paused_reason: absSeenToJson(seen, ciks), updated_at: new Date().toISOString() });
    if (r.error) log(ABS_WORKER_JOB, "what was looked at could not be kept", safeError(r.error));
  };
  let stay: AbsStay | null = null;
  while (!stopped && watch.length) {
    let lease: Lease | null = null;
    let pause: number | null = null;
    try {
      lease = await claim(ABS_WORKER_JOB);
      if (!lease) {
        await sleep(30_000);
        continue;
      }
      const state = await sb.from("job_state").select("cursor").eq("job", ABS_WORKER_JOB).single();
      if (state.error) throw new Error(state.error.message);
      const cursor = Math.max(0, Number(state.data.cursor ?? 0)) % watch.length;
      const turn = absNextTurn({ count: watch.length, cursor, seen, stay, now: Date.now() });
      if ("waitMs" in turn) pause = turn.waitMs;
      else {
        const w = watch[turn.index]!;
        // `load` while staying on a CIK: its listing was read at the start of this visit.
        const args = [
          turn.command,
          `--cik=${w.cik}`,
          "--max-filings=3",
          "--retry-skipped",
          `--cache=${cache}`,
          ...(w.from ? [`--from=${w.from}`] : []),
        ];
        // One importer process at a time, under this lane's lease; it keeps SEC at two requests a second.
        const runStarted = Date.now();
        const { code, told } = await childRun(lease, "scripts/abs-ee.ts", args, 25 * 60_000);
        // The durable provenance is in abs_*; these are re-fetchable copies owned by this worker.
        // Pruning occurs only after the child exits, so no active reader loses its file.
        const cacheState = trimSourceCache(
          cache,
          Number(process.env.OFFICIAL_SEC_CACHE_BYTES ?? 2 * 1024 ** 3),
        );
        if (cacheState.removed) log(ABS_WORKER_JOB, "cache trimmed", cacheState);
        if (code === RESOURCE_WAIT_EXIT) failures = 0;
        else {
          const after = absAfterRun({
            count: watch.length,
            index: turn.index,
            exitCode: code,
            left: absLeftFromReceipt(told, w.cik),
            stay,
            now: Date.now(),
            startedAt: runStarted,
          });
          if (after.seen) seen.set(turn.index, after.seen);
          else seen.delete(turn.index);
          await keepSeen();
          stay = after.stay;
          pause = after.pauseMs;
          failures = code === 0 ? 0 : failures + 1;
          if (code === 0 && after.cursor !== cursor) {
            const updated = await sb
              .from("job_state")
              .update({ cursor: after.cursor, updated_at: new Date().toISOString() })
              .eq("job", ABS_WORKER_JOB)
              .eq("paused_reason", owner);
            if (updated.error) throw new Error(updated.error.message);
          }
        }
      }
    } catch (e) {
      failures++;
      log(ABS_WORKER_JOB, safeError(e));
    } finally {
      await lease?.release();
    }
    // A failed run (an SEC outage among them) backs off from a minute up to an hour; a clean run pauses
    // a minute before the next CIK, or a few seconds before the next batch of the same CIK.
    if (!stopped) await sleep(failures ? Math.max(ABS_MOVE_PAUSE_MS, retryDelay(failures)) : (pause ?? ABS_MOVE_PAUSE_MS));
  }
}

// Linux PSI tracks time runnable work spent stalled for CPU. Other supervisors share this cgroup.
function cpuContended(): boolean {
  try {
    const pressure = readFileSync('/sys/fs/cgroup/cpu.pressure', 'utf8').match(/^some avg10=([\d.]+)/m);
    return pressure != null && Number(pressure[1]) >= 20;
  } catch { return false; }
}

/** Price/event history replay has its own claims. It uses this worker's memory guard and yields between passes. */
async function setupReplayLoop() {
  const job = 'setup-replay-worker';
  let failures = 0;
  while (!stopped) {
    let lease: Lease | null = null;
    let pause = 8000;
    try {
      if (!waitingForReplay && !children.size && hasMemoryHeadroom() && !cpuContended()) lease = await claim(job);
      if (lease) {
        const result = await childRun(lease, 'scripts/setup-replay.ts', ['--max-tickers=12'], 135_000);
        const recovery = result.told?.sourcePackRecovery as { examined?: number } | undefined;
        if (result.told?.idle === true) pause = recovery?.examined ? 3000 : 15 * 60_000;
        else if (result.told?.processed === 12 && result.told?.interrupted !== true) pause = 1000;
        failures = result.code === 0 || result.code === RESOURCE_WAIT_EXIT ? 0 : failures + 1;
      }
    } catch (e) {
      failures++;
      log(job, safeError(e));
    } finally {
      await lease?.release();
    }
    if (!stopped) await sleep(failures ? retryDelay(failures) : pause);
  }
}

await Promise.all([
  ...(enabled(process.env.OFFICIAL_SOURCES_ENABLED) ? [sourceLoop()] : []),
  ...(enabled(process.env.OFFICIAL_REFRESH_ENABLED) ? [refreshLoop()] : []),
  ...(enabled(process.env.ABS_BULK_ENABLED) ? [absLoop()] : []),
  ...(enabled(process.env.SETUP_REPLAY_ENABLED) ? [setupReplayLoop()] : []),
]);
