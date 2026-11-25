/**
 * Durable official-data ingestion beside the existing IR worker. Independent leases protect
 * source imports, refreshes and larger ABS files. Reads wait on the shared database back-pressure gate.
 * No browser credentials, temporary upload tickets, or local scratch paths are needed here.
 * Disable lanes with OFFICIAL_SOURCES_ENABLED=0, OFFICIAL_REFRESH_ENABLED=0 or ABS_BULK_ENABLED=0.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sb, dbGate, log, sleep } from "./lib/supa";
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
  type AbsSeen,
  type AbsStay,
} from "./lib/official-worker-plan";
import { absWatchList } from "./lib/abs-watch-list";
import { sweepRunReceipts, takeRunReceipt } from "./lib/run-receipt";
import { sweepRefreshFolders, trimSourceCache } from "./lib/source-cache";
import { snapshotStatsStep, statsOnlyRow, type StatsList, type StatsOutcome } from "./lib/snapshot-stats";

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

async function claim(job: string): Promise<Lease | null> {
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
  if (stopped || !hasMemoryHeadroom()) {
    log(lease.job, "waiting for memory headroom before starting new work");
    return { code: RESOURCE_WAIT_EXIT, told: null };
  }
  const started = new Date().toISOString();
  const receiptFile = join(RECEIPTS, `${lease.job}-${randomUUID()}.json`);
  const child = spawn("bun", [script, ...args, `--receipt=${receiptFile}`], {
    stdio: "inherit",
    env: process.env,
  });
  children.add(child);
  let killed = false;
  let renewing = false;
  const stop = () => {
    killed = true;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
  };
  const timer = setTimeout(stop, maxMs);
  const heartbeat = setInterval(() => {
    if (renewing) return;
    renewing = true;
    void lease
      .renew()
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
  children.delete(child);
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
  if (after) Object.assign(row.detail, await after().catch((e: unknown) => ({ after_error: safeError(e) })));
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
        const { code } = await childRun(
          held,
          "scripts/source-import.ts",
          ["--all", "--max-snapshots=25", "--max-runtime-seconds=480"],
          570_000,
          async () => ({ stats: await statsPass(held) }),
        );
        failures = code === 0 || code === RESOURCE_WAIT_EXIT ? 0 : failures + 1;
      } else {
        failures = 0;
        const started = new Date().toISOString();
        const row = statsOnlyRow(await statsPass(held));
        if (row) {
          const written = await sb.from("job_runs").insert({ job: SOURCE_WORKER_JOB, started_at: started,
            finished_at: new Date().toISOString(), ...row });
          if (written.error) log(SOURCE_WORKER_JOB, "statistics receipt failed", safeError(written.error));
        }
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
  // What this process knows of each watched CIK, by index: when it was last worked and what it had
  // left (rules: absNextTurn, absAfterRun). Lost on restart, which only means one more look at each.
  const seen = new Map<number, AbsSeen>();
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
          });
          if (after.seen) seen.set(turn.index, after.seen);
          else seen.delete(turn.index);
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

await Promise.all([
  ...(enabled(process.env.OFFICIAL_SOURCES_ENABLED) ? [sourceLoop()] : []),
  ...(enabled(process.env.OFFICIAL_REFRESH_ENABLED) ? [refreshLoop()] : []),
  ...(enabled(process.env.ABS_BULK_ENABLED) ? [absLoop()] : []),
]);
