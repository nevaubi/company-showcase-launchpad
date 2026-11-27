/**
 * One bounded pass of the stale IR payload lane (rules in scripts/lib/ir-rebuild-stale.ts): rebuilds
 * companies whose ir_company_series stats lack the current BUILD_FORMAT, banks first, one at a time,
 * from stored facts, label maps and document text. No model or paid API is called.
 *   bun scripts/ir-rebuild-stale.ts [--max=20] [--minutes=15] [--skip=JPM,NVDA] [--dry]
 * --skip: companies a reading lane holds now (the loop passes them); left for a later pass.
 * The IR loop starts it in idle time (scripts/ir-deep-loop.ts); by hand it waits for nothing and
 * exits when another pass holds the `ir-rebuild-stale` lease.
 */
import { COVERAGE } from "@/lib/coverage";
import { BUILD_FORMAT } from "@/lib/ir/payload";
import { rebuildCompany } from "@/lib/ir/rebuild.server";
import { emptyState, passRunRow, REBUILD_JOB, REBUILD_STATE, rebuildOrder, rebuildSettings, runPass, staleTickers, type RebuildState, type SeriesRow } from "./lib/ir-rebuild-stale";
import { loadRank, pageAll } from "./lib/rank";
import { args, dbGate, log, sb } from "./lib/supa";

const settings = rebuildSettings({
  ...process.env,
  ...(args.max ? { IR_REBUILD_MAX: args.max } : {}),
  ...(args.minutes ? { IR_REBUILD_MINUTES: args.minutes } : {}),
});
const DRY = args.dry !== undefined;
/** The lease outlives the pass budget plus one slow company; the loop's deadline kills a pass before it ends. */
const LEASE_MS = settings.maxMs + 20 * 60_000;

async function loadState(): Promise<RebuildState> {
  const { data } = await sb.storage.from("ir-documents").download(REBUILD_STATE);
  if (!data) return emptyState();
  try {
    return { ...emptyState(), ...(JSON.parse(await data.text()) as Partial<RebuildState>) };
  } catch {
    return emptyState();
  }
}
async function saveState(s: RebuildState) {
  if (DRY) return;
  const { error } = await sb.storage.from("ir-documents").upload(REBUILD_STATE, new Blob([JSON.stringify(s)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) log(`saving lane state failed: ${error.message.slice(0, 160)}`);
}

const owner = `owner:${crypto.randomUUID()}`;
async function takeLease(): Promise<boolean> {
  const now = new Date().toISOString();
  // Create the initially unleased row once. Only the conditional UPDATE can claim it.
  const { error: seedError } = await sb.from("job_state").upsert(
    { job: REBUILD_JOB, cursor: 0 }, { onConflict: "job", ignoreDuplicates: true },
  );
  if (seedError) throw new Error(seedError.message);
  const claim = sb.from("job_state").update({
    paused_reason: owner, lease_until: new Date(Date.now() + LEASE_MS).toISOString(), updated_at: now,
  }).eq("job", REBUILD_JOB);
  if (args.force === undefined) claim.or(`lease_until.is.null,lease_until.lte.${now}`);
  const { data, error } = await claim.select("job").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) log("another pass holds the rebuild lease");
  return !!data;
}
const releaseLease = () => sb.from("job_state")
  .update({ paused_reason: null, lease_until: new Date().toISOString(), updated_at: new Date().toISOString() })
  .eq("job", REBUILD_JOB).eq("paused_reason", owner);

let stop = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    // The company in progress is abandoned (its row is untouched or already current); the next pass reselects.
    stop = true;
    void releaseLease().then(() => process.exit(0), () => process.exit(0));
  });

if (import.meta.main) {
  if (!settings.enabled) process.exit(0);
  const t0 = Date.now();
  await dbGate(REBUILD_JOB);
  if (!(await takeLease())) process.exit(0);
  let code = 0;
  try {
    // Only the ticker, stats->build and the fill's waiting count: ~700 small rows, no payload is read.
    const rows = await pageAll<SeriesRow>((a, b) => sb.from("ir_company_series").select("ticker, build:stats->build, fill:stats->quality->fill, built_at").order("ticker").range(a, b));
    const { stale: staleOn, repairBefore } = settings;
    const stale = staleTickers(rows, BUILD_FORMAT, Date.now(), { stale: staleOn, repairBefore });
    const order = rebuildOrder(stale, COVERAGE, await loadRank());
    const state = await loadState();
    if (repairBefore !== null) {
      const before = new Date(repairBefore).toISOString();
      const scope = staleOn ? "" : " only";
      log(`repair: payloads at build ${BUILD_FORMAT} written before ${before}${scope}`);
    }
    log(`${stale.length} of ${rows.length} payloads to rebuild (build ${BUILD_FORMAT}); this pass takes up to ${settings.maxCompanies} companies in ${settings.maxMs / 60_000} min, first ${order.slice(0, 6).join(", ") || "none"}`);
    const r = await runPass(state, order, settings, {
      rebuild: async (t) => (await rebuildCompany(t, { dry: DRY })) !== null,
      gate: () => dbGate(REBUILD_JOB),
      save: saveState,
      now: Date.now,
      log,
      stopped: () => stop,
      skip: new Set((args.skip ?? "").split(",").map((t) => t.trim()).filter(Boolean)),
    });
    log(`pass ended (${r.stoppedBy}): ${r.rebuilt.length} rebuilt, ${Object.keys(r.failed).length} failed, ${r.left} left, ${r.review.length} for review${r.review.length ? ` (${r.review.join(", ")})` : ""}`);
    if (!DRY) {
      const { error } = await sb.from("job_runs").insert(passRunRow(t0, Date.now(), r) as never);
      if (error) log(`job_runs row failed: ${error.message.slice(0, 160)}`);
    }
  } catch (e) {
    // Selection or state failed: nothing was changed; the loop backs off and tries again.
    log(`pass failed: ${(e as Error).message.slice(0, 200)}`);
    code = 1;
  } finally {
    await releaseLease().then(undefined, () => undefined);
  }
  process.exit(code);
}
