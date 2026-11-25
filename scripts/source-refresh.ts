/**
 * Refresh reviewed official CSV endpoints into immutable staged snapshots.
 *   bun scripts/source-refresh.ts --all --max-datasets=8 --max-runtime-seconds=480
 *   bun scripts/source-refresh.ts --dataset=<id>
 *   bun scripts/source-refresh.ts --all --plan
 * Options: --receipt=<file> (the worker passes it: what the run did, as JSON, for job_runs) and
 * --probe (make the FRED reachability probe in this run, whatever the six-hour rule says).
 *
 * Hash-proven original URLs plus an exact endpoint allowlist are required. This
 * script never publishes or changes a dataset's current snapshot pointer.
 *
 * Exit code 0 means the run did its work, whatever each dataset's outcome: a dataset that failed
 * keeps its own failure state and next try, and the receipt lists it. 1 means the run itself failed
 * (planning or the state store), 124 that a signal stopped it. Rules: scripts/lib/source-refresh-run.ts.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { OFFICIAL_USER_AGENT, REFRESH_FAMILY_SWITCH, directRefreshProvenance, refreshChecked, refreshEligibility, refreshHeld,
  refreshFamilyDisabledReason, refreshFamilyEnabled, isRefreshDue, safeRefreshRedirect,
  type RefreshFamily, type RefreshState, type RefreshEligibility } from "../src/lib/sources/refresh-plan";
import type { SourceDataset, SourceFileManifest, SourceSnapshot, SourceIngest } from "../src/lib/sources/schema";
import { stageNativeRefresh } from "./lib/source-refresh-io";
import { writeOfficialResponseBody } from "./lib/official-response-body";
import { downloadFred } from "./lib/fred-transport";
import { collectFdicNative, FDIC_BASELINE_DATASET_ID, FDIC_CURRENT_DATASET } from "./lib/fdic-native";
import { collectTaiwanRevenue, TAIWAN_REVENUE_DATASETS, type TaiwanRevenueMarket } from "./lib/taiwan-revenue-native";
import { receiptText, writeRunReceipt } from "./lib/run-receipt";
import { FRED_PROBE_JOB, FRED_PROBE_TIMEOUT_MS, FamilyBreaker, RefreshStoreError, RefreshTransferError, START_MARGIN_MS,
  TRANSFER_ALLOWANCE_MS, attemptDataset, familyCircuitJob, fredProbeDue, http1Probe, http2Probe, providerStatus,
  refreshExitCode, refreshReceipt, runFredProbe, runQueue,
  type CircuitRow, type FredProbeReport, type QueueUnit, type RefreshOutcome, type RefreshStore, type StopCause, type Worked,
} from "./lib/source-refresh-run";

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : "true"];
}));
if (options.help === "true") {
  console.log("source-refresh --all|--dataset=<id> [--max-datasets=1] [--max-runtime-seconds=480] [--plan] [--probe] [--receipt=<file>]");
  process.exit(0);
}
if ((options.all === "true") === Boolean(options.dataset)) throw new Error("Choose exactly one of --all or --dataset=<id>");
const maxDatasets = Number(options["max-datasets"] ?? 1);
const runtimeSeconds = Number(options["max-runtime-seconds"] ?? 480);
if (!Number.isInteger(maxDatasets) || maxDatasets < 1 || maxDatasets > 100) throw new Error("--max-datasets must be 1–100");
if (!Number.isInteger(runtimeSeconds) || runtimeSeconds < 1 || runtimeSeconds > 3600) throw new Error("--max-runtime-seconds must be 1–3600");
const started = Date.now();
const deadline = started + runtimeSeconds * 1000;
const stop = new AbortController();
let stopCause: StopCause = null;
function halt(cause: Exclude<StopCause, null>, reason: string) {
  // A signal outranks the budget: it is the worker asking for the process to end now.
  if (stopCause === "signal" || stopCause === cause) return;
  const first = stopCause === null;
  stopCause = cause;
  if (!first) return;
  stop.abort(new Error(reason));
  // What follows a stop is a few bounded database calls. This is the last resort if they hang.
  setTimeout(() => process.exit(124), 60_000).unref();
}
const timer = setTimeout(() => halt("budget", "Refresh runtime budget reached"), runtimeSeconds * 1000);
timer.unref();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => halt("signal", `Refresh stopped by ${signal}`));
const baseFetch = globalThis.fetch;
const { dbGate } = await import("./lib/supa");
async function gate(label: string) {
  stop.signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const aborted = () => reject(stop.signal.reason);
    stop.signal.addEventListener("abort", aborted, { once: true });
    dbGate(label).then(() => { stop.signal.removeEventListener("abort", aborted); resolve(); }, error => { stop.signal.removeEventListener("abort", aborted); reject(error); });
  });
  stop.signal.throwIfAborted();
}
/** The work's client: every request ends when the run is told to stop. */
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
  global: { fetch: (input, init) => baseFetch(input, { ...init,
    signal: AbortSignal.any([stop.signal, AbortSignal.timeout(Math.max(1, Math.min(90_000, deadline - Date.now()))), ...(init?.signal ? [init.signal] : [])]),
  }) },
});
/**
 * The bookkeeping client: dataset state, locks, family circuits and the probe time. It does not
 * share the stop signal, so a failure state and a lock release still reach the database after the
 * budget fired or a signal arrived. Each request has its own short limit instead.
 */
const STATE_REQUEST_MS = 15_000;
const sbState: SupabaseClient = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
  global: { fetch: (input, init) => baseFetch(input, { ...init,
    signal: AbortSignal.any([AbortSignal.timeout(STATE_REQUEST_MS), ...(init?.signal ? [init.signal] : [])]),
  }) },
});
const log = (value: unknown) => console.log(JSON.stringify(value));
/** Error text as it may be stored: no URL query strings, nothing that looks like a credential. */
const errorText = (error: unknown) => receiptText(error, 1000);
const stateJob = (id: string) => `source-refresh-state:${id}`;
const lockJob = (id: string) => `source-refresh-lock:${id}`;
const owner = `refresh:${randomUUID()}`;
const WORK = process.env.OFFICIAL_SOURCE_WORK_DIR ?? "/var/data/official-sources";
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const FDIC_ENABLED = refreshFamilyEnabled("fdic", process.env);
const TAIWAN_ENABLED = refreshFamilyEnabled("taiwan", process.env);
const NATIVE_DATASET_IDS = new Set([FDIC_CURRENT_DATASET.id, ...Object.values(TAIWAN_REVENUE_DATASETS).map(dataset => dataset.id)]);
const DIRECT_FAMILIES: RefreshFamily[] = ["fred", "eia_mer", "fhfa"];

type Candidate = { dataset: SourceDataset; snapshot: Pick<SourceSnapshot, "id" | "dataset_id" | "file_sha256" | "source_path" | "ingest" | "expected_rows">;
  file: Pick<SourceFileManifest, "sha256" | "provenance">; state: RefreshState;
  eligibility: Extract<RefreshEligibility, { eligible: true }> };

function parseState(value: unknown): RefreshState {
  if (typeof value !== "string") return {};
  try { const data = JSON.parse(value); return data && typeof data === "object" && !Array.isArray(data) ? data : {}; }
  catch { return {}; }
}

/** Dataset state and locks, through the bookkeeping client. A failed call is the run's failure. */
const store: RefreshStore = {
  async readState(id) {
    const result = await sbState.from("job_state").select("paused_reason").eq("job", stateJob(id)).maybeSingle();
    if (result.error) throw new RefreshStoreError(`Read refresh state: ${errorText(result.error.message)}`);
    return parseState(result.data?.paused_reason);
  },
  async writeState(id, state) {
    const result = await sbState.from("job_state").upsert({ job: stateJob(id), paused_reason: JSON.stringify(state),
      cursor: state.last_success_at ? Math.floor(Date.parse(state.last_success_at) / 1000) : 0,
      updated_at: new Date().toISOString() }, { onConflict: "job" });
    if (result.error) throw new RefreshStoreError(`Write refresh state: ${errorText(result.error.message)}`);
  },
  async claim(id) {
    const job = lockJob(id);
    const seed = await sbState.from("job_state").upsert({ job, cursor: 0 }, { onConflict: "job", ignoreDuplicates: true });
    if (seed.error) throw new RefreshStoreError(`Seed refresh lock: ${errorText(seed.error.message)}`);
    const now = new Date().toISOString();
    const claim = await sbState.from("job_state").update({ paused_reason: owner, lease_until: new Date(deadline + 60_000).toISOString(), updated_at: now })
      .eq("job", job).or(`lease_until.is.null,lease_until.lt.${now}`).select("job");
    if (claim.error) throw new RefreshStoreError(`Claim refresh lock: ${errorText(claim.error.message)}`);
    return Boolean(claim.data?.length);
  },
  async release(id) {
    const result = await sbState.from("job_state").update({ paused_reason: null, lease_until: null, updated_at: new Date().toISOString() })
      .eq("job", lockJob(id)).eq("paused_reason", owner);
    if (result.error) throw new RefreshStoreError(`Release refresh lock: ${errorText(result.error.message)}`);
  },
};

/** One dataset under its lock; the database gate is waited for first. */
async function guarded(id: string, family: string, work: (state: RefreshState) => Promise<Worked>,
  cleanup?: (outcome: RefreshOutcome) => Promise<void>): Promise<RefreshOutcome> {
  // The gate only ends early when the run is told to stop; nothing is counted against the dataset.
  try { await gate("source-refresh-dataset"); }
  catch (error) {
    return { id, family, outcome: "skipped", reason: stopCause ? "the run stopped while waiting for the database"
      : `the database gate failed: ${errorText(error).slice(0, 120)}` };
  }
  return attemptDataset({ id, family, store, stopCause: () => stopCause, work, cleanup });
}

async function planCandidates() {
  const datasets: SourceDataset[] = [];
  for (let offset = 0; ; offset += 500) {
    await gate("source-refresh-plan-datasets");
    let query = sb.from("source_datasets").select("*").not("latest_snapshot_id", "is", null).order("id").range(offset, offset + 499);
    if (options.dataset) query = query.eq("id", options.dataset);
    const result = await query;
    if (result.error) throw new Error(`List refresh datasets: ${result.error.message}`);
    datasets.push(...result.data as SourceDataset[]);
    if (result.data.length < 500) break;
  }
  const candidates: Candidate[] = [];
  const skipped: { dataset_id: string; reason: string }[] = [];
  const switchedOff = new Map<RefreshFamily, number>();
  let awaitingImport = 0;
  for (let start = 0; start < datasets.length; start += 100) {
    stop.signal.throwIfAborted();
    await gate("source-refresh-plan");
    const batch = datasets.slice(start, start + 100);
    const snapshots = await sb.from("source_snapshots").select("id,dataset_id,file_sha256,source_path,ingest,expected_rows,status")
      .in("id", batch.map(d => d.latest_snapshot_id!)).eq("status", "ready");
    if (snapshots.error) throw new Error(`List refresh snapshots: ${snapshots.error.message}`);
    const native = snapshots.data as (Candidate["snapshot"] & { status: string })[];
    if (!native.length) continue;
    const files = await sb.from("source_files").select("sha256,provenance").in("sha256", [...new Set(native.map(s => s.file_sha256))]);
    if (files.error) throw new Error(`List refresh source evidence: ${files.error.message}`);
    const fileByHash = new Map((files.data as Candidate["file"][]).map(file => [file.sha256, file]));
    const states = await sb.from("job_state").select("job,paused_reason").in("job", batch.map(d => stateJob(d.id)));
    if (states.error) throw new Error(`List refresh state: ${states.error.message}`);
    const stateByJob = new Map(states.data.map(s => [s.job, parseState(s.paused_reason)]));
    const pending = await sb.from("source_snapshots").select("dataset_id").in("dataset_id", batch.map(d => d.id)).eq("status", "staging");
    if (pending.error) throw new Error(`List pending source imports: ${pending.error.message}`);
    const pendingIds = new Set(pending.data.map(s => s.dataset_id));
    for (const dataset of batch) {
      if (NATIVE_DATASET_IDS.has(dataset.id)) continue;
      const snapshot = native.find(s => s.id === dataset.latest_snapshot_id);
      if (!snapshot) continue;
      const file = fileByHash.get(snapshot.file_sha256);
      if (!file) throw new Error("Published snapshot has no source file evidence");
      const eligibility = refreshEligibility(file, snapshot.ingest as SourceIngest, new Date(), dataset.id);
      if (!eligibility.eligible) { skipped.push({ dataset_id: dataset.id, reason: eligibility.reason }); continue; }
      const off = refreshFamilyDisabledReason(eligibility.family, process.env);
      if (off) { switchedOff.set(eligibility.family, (switchedOff.get(eligibility.family) ?? 0) + 1); skipped.push({ dataset_id: dataset.id, reason: off }); continue; }
      if (pendingIds.has(dataset.id)) { awaitingImport++; skipped.push({ dataset_id: dataset.id, reason: "A complete refresh is already staged and awaiting verified import." }); continue; }
      const state = stateByJob.get(stateJob(dataset.id)) ?? {};
      if (options.dataset || isRefreshDue(state, Date.now())) candidates.push({ dataset, snapshot, file, state, eligibility });
    }
  }
  // Longest overdue first; a dataset never tried sorts before every dated one.
  candidates.sort((a, b) => (Date.parse(a.state.next_due_at ?? "1970-01-01") || 0) - (Date.parse(b.state.next_due_at ?? "1970-01-01") || 0)
    || a.dataset.id.localeCompare(b.dataset.id));
  return { candidates, skipped, switchedOff, awaitingImport, publishedDatasets: datasets.length };
}

/** The stored circuit of each direct family (see FamilyBreaker). */
async function familyCircuits(): Promise<Map<RefreshFamily, CircuitRow>> {
  const result = await sb.from("job_state").select("job,cursor,paused_reason").in("job", DIRECT_FAMILIES.map(familyCircuitJob));
  if (result.error) throw new Error(`Read family circuits: ${result.error.message}`);
  const rows = new Map<RefreshFamily, CircuitRow>();
  for (const family of DIRECT_FAMILIES) {
    const row = result.data.find(r => r.job === familyCircuitJob(family));
    if (row) rows.set(family, { cursor: row.cursor, paused_reason: row.paused_reason });
  }
  return rows;
}
async function saveCircuit(family: RefreshFamily, row: CircuitRow) {
  const result = await sbState.from("job_state").upsert({ job: familyCircuitJob(family), cursor: row.cursor ?? 0,
    paused_reason: row.paused_reason, updated_at: new Date().toISOString() }, { onConflict: "job" });
  if (result.error) throw new RefreshStoreError(`Write family circuit: ${errorText(result.error.message)}`);
  log({ event: row.paused_reason ? "source_refresh_family_paused" : "source_refresh_family_resumed", family,
    ...(row.paused_reason ? { retry_at: new Date(Number(row.cursor) * 1000).toISOString(), reason: row.paused_reason } : {}) });
}

async function downloadOfficial(candidate: Candidate, folder: string, state: RefreshState) {
  const requestedUrl = candidate.eligibility.url;
  const family = candidate.eligibility.family;
  let url = requestedUrl;
  const headers: Record<string, string> = { Accept: "text/csv,text/plain,application/octet-stream;q=0.8", "Accept-Encoding": "identity",
    "User-Agent": OFFICIAL_USER_AGENT };
  if (state.last_requested_url === requestedUrl) {
    if (state.etag) headers["If-None-Match"] = state.etag;
    else if (state.last_modified) headers["If-Modified-Since"] = state.last_modified;
  }
  const filePath = join(folder, "response.csv" + (candidate.snapshot.ingest.compression ? ".gz" : ""));
  // One limit for the whole transfer of this dataset, redirects and body included.
  const transferEnd = Math.min(deadline, Date.now() + TRANSFER_ALLOWANCE_MS[family]);
  if (family === "fred") {
    return await downloadFred({ url: requestedUrl, filePath, userAgent: headers["User-Agent"],
      etag: headers["If-None-Match"], lastModified: headers["If-Modified-Since"], signal: stop.signal, deadline: transferEnd });
  }
  const transfer = AbortSignal.any([stop.signal, AbortSignal.timeout(Math.max(1, transferEnd - Date.now()))]);
  /** No response, or one that broke off: the publisher's side, unless the run itself is stopping. */
  const unanswered = (error: unknown) => {
    if (error instanceof RefreshTransferError || stop.signal.aborted) return error;
    return new RefreshTransferError(`Official source did not answer: ${errorText(error)}`, "provider");
  };
  let response: Response | null = null;
  for (let redirects = 0; redirects <= 3; redirects++) {
    stop.signal.throwIfAborted();
    try { response = await baseFetch(url, { headers, redirect: "manual", signal: transfer }); }
    catch (error) { throw unanswered(error); }
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 3) throw new RefreshTransferError("Official source redirect limit reached", "dataset");
    const next = new URL(location, url).href;
    if (!safeRefreshRedirect(requestedUrl, next)) throw new RefreshTransferError("Official source redirected outside its reviewed endpoint and series", "dataset");
    url = next;
  }
  if (!response) throw new RefreshTransferError("No official source response", "provider");
  const etag = response.headers.get("etag") ?? undefined;
  const lastModified = response.headers.get("last-modified") ?? undefined;
  if (response.status === 304) return { notModified: true as const, url: requestedUrl, etag: etag ?? state.etag, lastModified: lastModified ?? state.last_modified };
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new RefreshTransferError(`Official source returned HTTP ${response.status}; complete 200 response required`,
      providerStatus(response.status) ? "provider" : "dataset");
  }
  const contentType = response.headers.get("content-type") ?? "text/csv";
  if (/html|json|xml/i.test(contentType)) { await response.body.cancel(); throw new RefreshTransferError("Endpoint returned a document or JSON response; a native CSV adapter is required", "dataset"); }
  const transferEncoding = response.headers.get("content-encoding");
  if (transferEncoding && transferEncoding.toLowerCase() !== "identity") { await response.body.cancel(); throw new RefreshTransferError("Official endpoint ignored identity transfer encoding; exact-byte handling requires a reviewed adapter", "dataset"); }
  const declaredLength = response.headers.has("content-length") ? Number(response.headers.get("content-length")) : null;
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_FILE_BYTES)) {
    await response.body.cancel(); throw new RefreshTransferError("Official source declared an invalid or oversized payload", "dataset");
  }
  let bytes: number;
  try { bytes = await writeOfficialResponseBody(response.body, filePath, transfer, MAX_FILE_BYTES); }
  catch (error) {
    // Too large, or the local file could not be written: not a silent publisher.
    if (/bounded refresh payload size|Could not persist|EEXIST|ENOSPC|EACCES|ENOENT/.test(errorText(error))) throw error;
    throw unanswered(error);
  }
  if (declaredLength !== null && bytes !== declaredLength) throw new RefreshTransferError("Official response byte count differs from Content-Length", "dataset");
  return { notModified: false as const, filePath, bytes, url: requestedUrl, resolvedUrl: url,
    retrievedAt: new Date().toISOString(), contentType, etag, lastModified };
}

function refreshOne(candidate: Candidate): Promise<RefreshOutcome> {
  const id = candidate.dataset.id;
  let folder: string | null = null;
  return guarded(id, candidate.eligibility.family, async saved => {
    const pending = await sb.from("source_snapshots").select("id").eq("dataset_id", id).eq("status", "staging").limit(1);
    if (pending.error) throw new Error(`Read pending refresh: ${pending.error.message}`);
    if (pending.data.length) return { outcome: "skipped", reason: "a staged refresh of this dataset is waiting for import" };
    const state: RefreshState = { ...saved, last_attempt_at: new Date().toISOString() };
    await store.writeState(id, state);
    await mkdir(WORK, { recursive: true });
    folder = await mkdtemp(join(WORK, "refresh-"));
    const downloaded = await downloadOfficial(candidate, folder, state);
    if (downloaded.notModified) {
      await store.writeState(id, refreshChecked(state, new Date(), candidate.eligibility.intervalMs, { url: downloaded.url, etag: downloaded.etag, lastModified: downloaded.lastModified }));
      return { outcome: "unchanged" };
    }
    const current = await sb.from("source_snapshots").select("*").eq("id", candidate.snapshot.id).single();
    if (current.error) throw new Error(`Read source schema: ${current.error.message}`);
    const baseline = current.data as SourceSnapshot;
    const result = await stageNativeRefresh({ sb, filePath: downloaded.filePath, retrievedAt: downloaded.retrievedAt,
      template: { datasetId: id, previousSnapshotId: baseline.id, previousFileSha256: baseline.file_sha256,
        previousRows: baseline.expected_rows, columns: baseline.columns, ingest: baseline.ingest, coverage: baseline.coverage },
      sourceUrl: downloaded.url, contentType: downloaded.contentType, signal: stop.signal, gate,
      provenance: { ...directRefreshProvenance(candidate.file, candidate.eligibility, downloaded),
        ...("transport" in downloaded ? { retrieval_transport: downloaded.transport } : {}) } });
    if (result.outcome === "quarantined") {
      const reason = result.reason ?? "Refreshed native schema requires review";
      await store.writeState(id, refreshHeld(state, new Date(), reason));
      return { outcome: "held", reason, snapshot_id: result.snapshotId };
    }
    await store.writeState(id, refreshChecked(state, new Date(), candidate.eligibility.intervalMs, {
      url: downloaded.url, etag: downloaded.etag, lastModified: downloaded.lastModified,
      ...(result.snapshotId ? { stagedSnapshotId: result.snapshotId } : {}) }));
    return result.snapshotId ? { outcome: "staged", snapshot_id: result.snapshotId, rows: result.expectedRows } : { outcome: "unchanged" };
  }, async () => { if (folder) await rm(folder, { recursive: true, force: true }); });
}

async function fdicAdapterPlan() {
  const requested = options.all === "true" || options.dataset === FDIC_CURRENT_DATASET.id;
  if (!requested) return { selected: false, reason: "not_requested" };
  if (!FDIC_ENABLED) return { selected: false, reason: `Reviewed FDIC native adapter is switched off by ${REFRESH_FAMILY_SWITCH.fdic}.` };
  await gate("source-refresh-plan-fdic");
  const state = await store.readState(FDIC_CURRENT_DATASET.id);
  if (!options.dataset && !isRefreshDue(state, Date.now())) return { selected: false, reason: "not_due", state };
  const pending = await sb.from("source_snapshots").select("id").eq("dataset_id", FDIC_CURRENT_DATASET.id).eq("status", "staging").limit(1);
  if (pending.error) throw new Error(`Read pending FDIC refresh: ${pending.error.message}`);
  if (pending.data.length) return { selected: false, reason: "A complete FDIC refresh is already staged and awaiting verified import.", state };
  const baseline = await sb.from("source_snapshots").select("id").eq("dataset_id", FDIC_BASELINE_DATASET_ID).eq("status", "ready").limit(1);
  if (baseline.error) throw new Error(`Read FDIC baseline: ${baseline.error.message}`);
  if (!baseline.data.length) return { selected: false, reason: "Waiting for verified full historical FDIC baseline", state };
  return { selected: true, state, baselineId: baseline.data[0].id as string };
}

/** A native collection under the run's stop signal and the family's own limit, with the limit named when it ends the collection. */
async function collectWithin<T>(family: "fdic" | "taiwan", collect: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const limit = AbortSignal.timeout(TRANSFER_ALLOWANCE_MS[family]);
  try { return await collect(AbortSignal.any([stop.signal, limit])); }
  catch (error) {
    if (limit.aborted && !stop.signal.aborted) throw new Error(`Collection exceeded its ${TRANSFER_ALLOWANCE_MS[family] / 1000} s limit: ${errorText(error)}`);
    throw error;
  }
}

function refreshFdic(baselineId: string): Promise<RefreshOutcome> {
  const id = FDIC_CURRENT_DATASET.id;
  let folder: string | null = null;
  return guarded(id, "fdic", async saved => {
    const pending = await sb.from("source_snapshots").select("id").eq("dataset_id", id).eq("status", "staging").limit(1);
    if (pending.error) throw new Error(pending.error.message);
    if (pending.data.length) return { outcome: "skipped", reason: "a staged refresh of this dataset is waiting for import" };
    const baselineResult = await sb.from("source_snapshots").select("*").eq("id", baselineId).single();
    if (baselineResult.error) throw new Error(baselineResult.error.message);
    const baseline = baselineResult.data as SourceSnapshot;
    await gate("source-refresh-fdic-register");
    const registered = await sb.from("source_datasets").upsert(FDIC_CURRENT_DATASET, { onConflict: "id", ignoreDuplicates: true });
    if (registered.error) throw new Error(`Register FDIC current-quarter dataset: ${registered.error.message}`);
    const currentDataset = await sb.from("source_datasets").select("latest_snapshot_id").eq("id", id).single();
    if (currentDataset.error) throw new Error(currentDataset.error.message);
    let previous: SourceSnapshot | null = null;
    if (currentDataset.data.latest_snapshot_id) {
      const currentSnapshot = await sb.from("source_snapshots").select("*").eq("id", currentDataset.data.latest_snapshot_id).single();
      if (currentSnapshot.error) throw new Error(currentSnapshot.error.message);
      previous = currentSnapshot.data as SourceSnapshot;
    }
    const state: RefreshState = { ...saved, last_attempt_at: new Date().toISOString() };
    await store.writeState(id, state);
    await mkdir(WORK, { recursive: true });
    folder = await mkdtemp(join(WORK, "refresh-fdic-"));
    const workDir = folder;
    const collected = await collectWithin("fdic", signal => collectFdicNative({ columns: baseline.columns, baselineSnapshotId: baseline.id,
      workDir, signal, onProgress: progress => log({ event: "source_refresh_fdic_collect", ...progress }) }));
    const result = await stageNativeRefresh({ sb, filePath: collected.filePath, retrievedAt: collected.retrievedAt,
      template: { datasetId: id, previousSnapshotId: previous?.id ?? null, previousFileSha256: previous?.file_sha256 ?? null,
        previousRows: previous?.expected_rows ?? 0, columns: previous?.columns ?? collected.columns,
        ingest: previous?.ingest ?? collected.ingest, coverage: previous?.coverage ?? {} },
      sourceUrl: FDIC_CURRENT_DATASET.source_url, provenance: collected.provenance, freshCoverage: collected.coverage,
      freshQuality: { requested_field_count: collected.coverage.requested_field_count ?? baseline.columns.length,
        returned_field_count: collected.columns.length,
        requested_but_not_returned_fields: collected.coverage.requested_but_not_returned_fields ?? [],
        requested_but_not_returned_count: collected.coverage.requested_but_not_returned_count ?? 0, omission_verified: true },
      supportingFiles: collected.supportingFiles, contentType: "text/csv", signal: stop.signal, gate });
    if (result.outcome === "quarantined") {
      const reason = result.reason ?? "FDIC source schema requires review";
      await store.writeState(id, refreshHeld(state, new Date(), reason));
      return { outcome: "held", reason, snapshot_id: result.snapshotId };
    }
    await store.writeState(id, refreshChecked(state, new Date(), 24 * 3600_000, { url: FDIC_CURRENT_DATASET.source_url,
      ...(result.snapshotId ? { stagedSnapshotId: result.snapshotId } : {}) }));
    log({ event: "source_refresh_fdic_report_date", dataset_id: id, report_date: collected.reportDate });
    return result.snapshotId ? { outcome: "staged", snapshot_id: result.snapshotId, rows: result.expectedRows } : { outcome: "unchanged" };
  }, async outcome => {
    // The responses behind a failed or held collection stay on disk as evidence; the worker sweeps old folders.
    if (!folder) return;
    if (outcome.outcome === "unchanged" || outcome.outcome === "staged") await rm(folder, { recursive: true, force: true });
    else log({ event: "source_refresh_evidence_kept", dataset_id: id, evidence_path: folder });
  });
}

type TaiwanPlan = { market: TaiwanRevenueMarket; selected: boolean; reason?: string };
async function taiwanAdapterPlans(): Promise<TaiwanPlan[]> {
  const plans: TaiwanPlan[] = [];
  for (const market of ["TWSE", "TPEX"] as const) {
    const dataset = TAIWAN_REVENUE_DATASETS[market];
    if (options.all !== "true" && options.dataset !== dataset.id) { plans.push({ market, selected: false, reason: "not_requested" }); continue; }
    if (!TAIWAN_ENABLED) { plans.push({ market, selected: false, reason: `Reviewed Taiwan native revenue adapter is switched off by ${REFRESH_FAMILY_SWITCH.taiwan}.` }); continue; }
    await gate("source-refresh-plan-taiwan");
    const state = await store.readState(dataset.id);
    if (!options.dataset && !isRefreshDue(state, Date.now())) { plans.push({ market, selected: false, reason: "not_due" }); continue; }
    const pending = await sb.from("source_snapshots").select("id").eq("dataset_id", dataset.id).eq("status", "staging").limit(1);
    if (pending.error) throw new Error(`Read pending Taiwan revenue refresh: ${pending.error.message}`);
    plans.push({ market, selected: !pending.data.length, ...(pending.data.length ? { reason: "A complete exchange refresh is already staged and awaiting verified import." } : {}) });
  }
  return plans;
}

function refreshTaiwan(market: TaiwanRevenueMarket): Promise<RefreshOutcome> {
  const dataset = TAIWAN_REVENUE_DATASETS[market], id = dataset.id;
  let folder: string | null = null;
  return guarded(id, "taiwan", async saved => {
    const pending = await sb.from("source_snapshots").select("id").eq("dataset_id", id).eq("status", "staging").limit(1);
    if (pending.error) throw new Error(pending.error.message);
    if (pending.data.length) return { outcome: "skipped", reason: "a staged refresh of this dataset is waiting for import" };
    await gate("source-refresh-taiwan-register");
    const registered = await sb.from("source_datasets").upsert(dataset, { onConflict: "id", ignoreDuplicates: true });
    if (registered.error) throw new Error(`Register Taiwan revenue dataset: ${registered.error.message}`);
    const currentDataset = await sb.from("source_datasets").select("latest_snapshot_id").eq("id", id).single();
    if (currentDataset.error) throw new Error(currentDataset.error.message);
    let previous: SourceSnapshot | null = null;
    if (currentDataset.data.latest_snapshot_id) {
      const currentSnapshot = await sb.from("source_snapshots").select("*").eq("id", currentDataset.data.latest_snapshot_id).single();
      if (currentSnapshot.error) throw new Error(currentSnapshot.error.message);
      previous = currentSnapshot.data as SourceSnapshot;
    }
    const priorCodes = previous?.coverage.reported_company_codes;
    if (priorCodes !== undefined && (!Array.isArray(priorCodes) || priorCodes.some(code => typeof code !== "string"))) throw new Error("Previous exchange issuer-code evidence is malformed");
    const state: RefreshState = { ...saved, last_attempt_at: new Date().toISOString() };
    await store.writeState(id, state);
    await mkdir(WORK, { recursive: true });
    folder = await mkdtemp(join(WORK, `refresh-${market.toLowerCase()}-`));
    const workDir = folder;
    const collected = await collectWithin("taiwan", signal => collectTaiwanRevenue({ market, workDir, signal,
      ...(priorCodes ? { previousCompanyCodes: priorCodes as string[] } : {}) }));
    const result = await stageNativeRefresh({ sb, filePath: collected.filePath, retrievedAt: collected.retrievedAt,
      template: { datasetId: id, previousSnapshotId: previous?.id ?? null, previousFileSha256: previous?.file_sha256 ?? null,
        previousRows: previous?.expected_rows ?? 0, columns: previous?.columns ?? collected.columns,
        // The reviewed collector verifies this response's ROC month before it
        // creates the Gregorian index constant; never carry forward last month.
        ingest: collected.ingest, coverage: previous?.coverage ?? {} },
      sourceUrl: dataset.source_url, provenance: collected.provenance, freshCoverage: collected.coverage,
      supportingFiles: collected.supportingFiles, contentType: "text/csv", signal: stop.signal, gate });
    if (result.outcome === "quarantined") {
      const reason = result.reason ?? "Exchange source schema requires review";
      await store.writeState(id, refreshHeld(state, new Date(), reason));
      return { outcome: "held", reason, snapshot_id: result.snapshotId };
    }
    await store.writeState(id, refreshChecked(state, new Date(), 24 * 3600_000, { url: dataset.source_url,
      ...(result.snapshotId ? { stagedSnapshotId: result.snapshotId } : {}) }));
    log({ event: "source_refresh_taiwan_month", dataset_id: id, market, reported_month: collected.period, native_reported_month: collected.nativePeriod });
    return result.snapshotId ? { outcome: "staged", snapshot_id: result.snapshotId, rows: result.expectedRows } : { outcome: "unchanged" };
  }, async outcome => {
    if (!folder) return;
    if (outcome.outcome === "unchanged" || outcome.outcome === "staged") await rm(folder, { recursive: true, force: true });
    else log({ event: "source_refresh_evidence_kept", dataset_id: id, evidence_path: folder });
  });
}

/**
 * Settles why FRED does not answer the worker: three bounded requests, at most once in six hours,
 * with the result in this run's receipt. Runs only while the FRED family is switched on.
 */
async function fredProbe(): Promise<FredProbeReport | null> {
  if (options.all !== "true" || !refreshFamilyEnabled("fred", process.env)) return null;
  if (deadline - Date.now() < 3 * FRED_PROBE_TIMEOUT_MS + START_MARGIN_MS) return null;
  const last = await sbState.from("job_state").select("cursor").eq("job", FRED_PROBE_JOB).maybeSingle();
  if (last.error) { log({ event: "source_refresh_probe_skipped", reason: errorText(last.error.message) }); return null; }
  if (options.probe !== "true" && !fredProbeDue(last.data?.cursor, Date.now())) return null;
  // The time is written before the requests: a run cut off underway does not probe again for six hours.
  // The row holds only that time; the results are in this run's receipt (job_runs.detail.fred_probe).
  const claimed = await sbState.from("job_state").upsert({ job: FRED_PROBE_JOB, cursor: Math.floor(Date.now() / 1000),
    paused_reason: null, updated_at: new Date().toISOString() }, { onConflict: "job" });
  if (claimed.error) { log({ event: "source_refresh_probe_skipped", reason: errorText(claimed.error.message) }); return null; }
  const report = await runFredProbe({ now: Date.now, transports: { "http/1.1": http1Probe(baseFetch), h2: http2Probe }, signal: stop.signal });
  log({ event: "source_refresh_fred_probe", ...report });
  return report;
}

const outcomes: RefreshOutcome[] = [];
let runError: string | null = null;
try {
  const plan = await planCandidates();
  const fdicPlan = await fdicAdapterPlan();
  const taiwanPlans = await taiwanAdapterPlans();
  const breaker = new FamilyBreaker(await familyCircuits(), Boolean(options.dataset));
  const switchedOff = [
    ...[...plan.switchedOff].map(([family, datasets]) => ({ family, variable: REFRESH_FAMILY_SWITCH[family], datasets })),
    ...(options.all === "true" && !FDIC_ENABLED ? [{ family: "fdic", variable: REFRESH_FAMILY_SWITCH.fdic, datasets: 1 }] : []),
    ...(options.all === "true" && !TAIWAN_ENABLED ? [{ family: "taiwan", variable: REFRESH_FAMILY_SWITCH.taiwan, datasets: 2 }] : []),
  ];
  const units: QueueUnit[] = [
    ...(fdicPlan.selected && fdicPlan.baselineId
      ? [{ id: FDIC_CURRENT_DATASET.id, family: "fdic" as const, attempt: () => refreshFdic(fdicPlan.baselineId!) }] : []),
    ...taiwanPlans.filter(p => p.selected).map(p => ({ id: TAIWAN_REVENUE_DATASETS[p.market].id, family: "taiwan" as const,
      attempt: () => refreshTaiwan(p.market) })),
    ...plan.candidates.map(c => ({ id: c.dataset.id, family: c.eligibility.family, circuit: c.eligibility.family,
      attempt: () => refreshOne(c) })),
  ];
  if (options.plan === "true") {
    log({ event: "source_refresh_plan", published_datasets: plan.publishedDatasets, eligible_due: units.length,
      due: plan.candidates.slice(0, maxDatasets).map(c => ({ dataset_id: c.dataset.id, family: c.eligibility.family, url: c.eligibility.url,
        next_due_at: c.state.next_due_at ?? null, interval_hours: c.eligibility.intervalMs / 3600_000 })),
      ineligible: options.dataset ? plan.skipped : plan.skipped.length, awaiting_import: plan.awaitingImport,
      switched_off: switchedOff, paused_families: breaker.summary(Date.now()),
      native_adapters: [{ dataset_id: FDIC_CURRENT_DATASET.id, enabled: FDIC_ENABLED, selected: fdicPlan.selected, reason: fdicPlan.reason ?? null },
        ...taiwanPlans.map(p => ({ dataset_id: TAIWAN_REVENUE_DATASETS[p.market].id, enabled: TAIWAN_ENABLED, selected: p.selected, reason: p.reason ?? null }))] });
  } else {
    // The probe only informs: whatever goes wrong in it, the datasets are still collected.
    const probe = await fredProbe().catch(error => { log({ event: "source_refresh_probe_skipped", reason: errorText(error) }); return null; });
    if (options.dataset && !units.length) log({ event: "source_refresh_not_selected", dataset_id: options.dataset,
      reason: options.dataset === FDIC_CURRENT_DATASET.id ? fdicPlan.reason
        : taiwanPlans.find(p => TAIWAN_REVENUE_DATASETS[p.market].id === options.dataset)?.reason
          ?? plan.skipped.find(item => item.dataset_id === options.dataset)?.reason ?? "No published ready source snapshot is available for this dataset." });
    let queue: Awaited<ReturnType<typeof runQueue>> = { outcomes, notStarted: [], attempted: 0 };
    try {
      queue = await runQueue(units, { maxDatasets, deadline, now: Date.now, stopCause: () => stopCause, breaker, saveCircuit,
        onOutcome: outcome => { outcomes.push(outcome); log({ event: "source_refresh_dataset", ...outcome }); } });
    } catch (error) {
      runError = errorText(error);
    }
    const receipt = { ...refreshReceipt({ mode: options.dataset ? "dataset" : "all", startedMs: started, finishedMs: Date.now(),
      due: units.length, outcomes, notStarted: queue.notStarted, switchedOff, circuits: breaker.summary(Date.now()), probe,
      stop: stopCause, runError }), awaiting_import: plan.awaitingImport };
    log({ event: runError ? "source_refresh_run_failed" : "source_refresh_run_complete", ...receipt, published_by_this_step: false });
    writeRunReceipt(options.receipt, receipt);
  }
} catch (error) {
  runError = errorText(error);
  log({ event: "source_refresh_run_failed", error: runError, stopped: stopCause });
  writeRunReceipt(options.receipt, refreshReceipt({ mode: options.dataset ? "dataset" : "all", startedMs: started, finishedMs: Date.now(),
    due: 0, outcomes, notStarted: [], switchedOff: [], circuits: {}, stop: stopCause, runError }));
} finally {
  clearTimeout(timer);
  // Shared back-pressure probes own retry timers. All requests, local cleanup
  // and lease release have completed by this boundary; flush logs then exit so
  // those probe timers cannot extend the runner's explicit budget.
  await new Promise<void>(resolve => process.stdout.write("", () => resolve()));
  process.exit(refreshExitCode({ stop: stopCause, runError: runError !== null }));
}
