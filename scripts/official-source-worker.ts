/**
 * Durable official-data ingestion beside the existing IR worker. Two independent leases protect
 * source imports and larger ABS files. Reads wait on the shared database back-pressure gate.
 * No browser credentials, temporary upload tickets, or local scratch paths are needed here.
 * Disable either lane with OFFICIAL_SOURCES_ENABLED=0 or ABS_BULK_ENABLED=0.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { sb, dbGate, log, sleep } from "./lib/supa";
import { ABS_WATCH, type AbsWatch } from "../src/lib/abs/watch";
import {
  SOURCE_WORKER_JOB,
  ABS_WORKER_JOB,
  WORKER_LEASE_MS,
  advanceCursor,
  enabled,
  retryDelay,
  safeError,
} from "./lib/official-worker-plan";
import { trimSourceCache } from "./lib/source-cache";

const owner = `official:${process.env.RENDER_INSTANCE_ID ?? "worker"}:${randomUUID()}`;
const children = new Set<ChildProcess>();
let stopped = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    stopped = true;
    for (const child of children) child.kill(signal);
  });

type Lease = { job: string; renew: () => Promise<boolean>; release: () => Promise<void> };
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

async function childRun(
  lease: Lease,
  script: string,
  args: string[],
  maxMs: number,
): Promise<number | null> {
  const started = new Date().toISOString();
  const child = spawn("bun", [script, ...args], { stdio: "inherit", env: process.env });
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
  const receipt = await sb.from("job_runs").insert({
    job: lease.job,
    started_at: started,
    finished_at: new Date().toISOString(),
    ok: result === 0,
    items: 0,
    detail: {
      child: script,
      exit_code: result,
      note: "Process receipt; source rows are counted only by committed snapshots or ABS loads.",
    },
  });
  if (receipt.error) log(lease.job, "receipt failed", safeError(receipt.error));
  return result;
}

async function sourceLoop() {
  let failures = 0;
  while (!stopped) {
    let lease: Lease | null = null;
    try {
      lease = await claim(SOURCE_WORKER_JOB);
      if (!lease) {
        await sleep(30_000);
        continue;
      }
      const pending = await sb
        .from("source_snapshots" as never)
        .select("id")
        .eq("status", "staging")
        .limit(1);
      if (pending.error) throw new Error(pending.error.message);
      if (pending.data?.length) {
        const code = await childRun(
          lease,
          "scripts/source-import.ts",
          ["--all", "--max-snapshots=25", "--max-runtime-seconds=480"],
          570_000,
        );
        failures = code === 0 ? 0 : failures + 1;
      } else failures = 0;
    } catch (e) {
      failures++;
      log(SOURCE_WORKER_JOB, safeError(e));
    } finally {
      await lease?.release();
    }
    if (!stopped) await sleep(failures ? retryDelay(failures) : 30_000);
  }
}

function watches(): AbsWatch[] {
  // These optional CIKs are discovery candidates from the supplied workbook, not company ties.
  // The existing SEC reader verifies the filing's real issuer/depositor and file family.
  const file = join(import.meta.dir, "data", "abs-candidate-watch.json");
  const extra = existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")).candidates as AbsWatch[])
    : [];
  return [
    ...new Map(
      [
        ...ABS_WATCH,
        ...extra.filter((w) => Number.isInteger(w.cik) && w.cik > 0 && typeof w.name === "string"),
      ].map((w) => [w.cik, w]),
    ).values(),
  ];
}

async function absLoop() {
  const watch = watches();
  const cache = join(process.env.OFFICIAL_SOURCE_WORK_DIR ?? "/var/data/official-sources", "sec");
  mkdirSync(cache, { recursive: true });
  let failures = 0;
  while (!stopped && watch.length) {
    let lease: Lease | null = null;
    try {
      lease = await claim(ABS_WORKER_JOB);
      if (!lease) {
        await sleep(30_000);
        continue;
      }
      const state = await sb.from("job_state").select("cursor").eq("job", ABS_WORKER_JOB).single();
      if (state.error) throw new Error(state.error.message);
      const cursor = Math.max(0, Number(state.data.cursor ?? 0)) % watch.length;
      const w = watch[cursor]!;
      const args = [
        "run",
        `--cik=${w.cik}`,
        "--max-filings=3",
        "--retry-skipped",
        `--cache=${cache}`,
        ...(w.from ? [`--from=${w.from}`] : []),
      ];
      const code = await childRun(lease, "scripts/abs-ee.ts", args, 25 * 60_000);
      // The durable provenance is in abs_*; these are re-fetchable copies owned by this worker.
      // Pruning occurs only after the child exits, so no active reader loses its file.
      const cacheState = trimSourceCache(
        cache,
        Number(process.env.OFFICIAL_SEC_CACHE_BYTES ?? 2 * 1024 ** 3),
      );
      if (cacheState.removed) log(ABS_WORKER_JOB, "cache trimmed", cacheState);
      failures = code === 0 ? 0 : failures + 1;
      if (code === 0) {
        const updated = await sb
          .from("job_state")
          .update({
            cursor: advanceCursor(cursor, watch.length, code),
            updated_at: new Date().toISOString(),
          })
          .eq("job", ABS_WORKER_JOB)
          .eq("paused_reason", owner);
        if (updated.error) throw new Error(updated.error.message);
      }
    } catch (e) {
      failures++;
      log(ABS_WORKER_JOB, safeError(e));
    } finally {
      await lease?.release();
    }
    // At most one CIK a minute. Listing and asset downloads also use the SEC reader's rate limit.
    if (!stopped) await sleep(failures ? retryDelay(failures) : 60_000);
  }
}

await Promise.all([
  ...(enabled(process.env.OFFICIAL_SOURCES_ENABLED) ? [sourceLoop()] : []),
  ...(enabled(process.env.ABS_BULK_ENABLED) ? [absLoop()] : []),
]);
