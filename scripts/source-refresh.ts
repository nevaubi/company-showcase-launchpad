/**
 * Refresh reviewed official CSV endpoints into immutable staged snapshots.
 *   bun scripts/source-refresh.ts --all --max-datasets=8 --max-runtime-seconds=480
 *   bun scripts/source-refresh.ts --dataset=<id>
 *   bun scripts/source-refresh.ts --all --plan
 *
 * Hash-proven original URLs plus an exact endpoint allowlist are required. This
 * script never publishes or changes a dataset's current snapshot pointer.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { directRefreshProvenance, refreshChecked, refreshEligibility, refreshFailure, isRefreshDue, safeRefreshRedirect,
  type RefreshState, type RefreshEligibility } from "../src/lib/sources/refresh-plan";
import type { SourceDataset, SourceFileManifest, SourceSnapshot, SourceIngest } from "../src/lib/sources/schema";
import { stageNativeRefresh } from "./lib/source-refresh-io";
import { downloadFred } from "./lib/fred-transport";
import { collectFdicNative, FDIC_BASELINE_DATASET_ID, FDIC_CURRENT_DATASET } from "./lib/fdic-native";
import { collectTaiwanRevenue, TAIWAN_REVENUE_DATASETS, type TaiwanRevenueMarket } from "./lib/taiwan-revenue-native";

const options = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key, ...value] = arg.replace(/^--/, "").split("=");
  return [key, value.length ? value.join("=") : "true"];
}));
if (options.help === "true") {
  console.log("source-refresh --all|--dataset=<id> [--max-datasets=1] [--max-runtime-seconds=480] [--plan]");
  process.exit(0);
}
if ((options.all === "true") === Boolean(options.dataset)) throw new Error("Choose exactly one of --all or --dataset=<id>");
const maxDatasets = Number(options["max-datasets"] ?? 1);
const runtimeSeconds = Number(options["max-runtime-seconds"] ?? 480);
if (!Number.isInteger(maxDatasets) || maxDatasets < 1 || maxDatasets > 100) throw new Error("--max-datasets must be 1–100");
if (!Number.isInteger(runtimeSeconds) || runtimeSeconds < 1 || runtimeSeconds > 3600) throw new Error("--max-runtime-seconds must be 1–3600");
const deadline = Date.now() + runtimeSeconds * 1000;
const stop = new AbortController();
const timer = setTimeout(() => stop.abort(new Error("Refresh runtime budget reached")), runtimeSeconds * 1000);
timer.unref();
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => stop.abort(new Error(`Refresh stopped by ${signal}`)));
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
const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
  global: { fetch: (input, init) => baseFetch(input, { ...init,
    signal: AbortSignal.any([stop.signal, AbortSignal.timeout(Math.max(1, Math.min(90_000, deadline - Date.now()))), ...(init?.signal ? [init.signal] : [])]),
  }) },
});
const log = (value: unknown) => console.log(JSON.stringify(value));
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000);
const stateJob = (id: string) => `source-refresh-state:${id}`;
const owner = `refresh:${randomUUID()}`;
const WORK = process.env.OFFICIAL_SOURCE_WORK_DIR ?? "/var/data/official-sources";
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const FDIC_ENABLED = process.env.OFFICIAL_FDIC_NATIVE_ENABLED !== "0";
const TAIWAN_ENABLED = process.env.OFFICIAL_TAIWAN_REVENUE_ENABLED !== "0";
const NATIVE_DATASET_IDS = new Set([FDIC_CURRENT_DATASET.id, ...Object.values(TAIWAN_REVENUE_DATASETS).map(dataset => dataset.id)]);

type Candidate = { dataset: SourceDataset; snapshot: Pick<SourceSnapshot, "id" | "dataset_id" | "file_sha256" | "source_path" | "ingest" | "expected_rows">;
  file: Pick<SourceFileManifest, "sha256" | "provenance">; state: RefreshState;
  eligibility: Extract<RefreshEligibility, { eligible: true }> };

function parseState(value: unknown): RefreshState {
  if (typeof value !== "string") return {};
  try { const data = JSON.parse(value); return data && typeof data === "object" && !Array.isArray(data) ? data : {}; }
  catch { return {}; }
}
async function savedState(id: string): Promise<RefreshState> {
  const result = await sb.from("job_state").select("paused_reason").eq("job", stateJob(id)).maybeSingle();
  if (result.error) throw new Error(`Read refresh state: ${result.error.message}`);
  return parseState(result.data?.paused_reason);
}
async function saveState(id: string, state: RefreshState) {
  const result = await sb.from("job_state").upsert({ job: stateJob(id), paused_reason: JSON.stringify(state),
    cursor: state.last_success_at ? Math.floor(Date.parse(state.last_success_at) / 1000) : 0,
    updated_at: new Date().toISOString() }, { onConflict: "job" });
  if (result.error) throw new Error(`Write refresh state: ${result.error.message}`);
}
async function claimDataset(id: string): Promise<(() => Promise<void>) | null> {
  const job = `source-refresh-lock:${id}`;
  const seed = await sb.from("job_state").upsert({ job, cursor: 0 }, { onConflict: "job", ignoreDuplicates: true });
  if (seed.error) throw new Error(seed.error.message);
  const now = new Date().toISOString();
  const claim = await sb.from("job_state").update({ paused_reason: owner, lease_until: new Date(deadline + 60_000).toISOString(), updated_at: now })
    .eq("job", job).or(`lease_until.is.null,lease_until.lt.${now}`).select("job");
  if (claim.error) throw new Error(claim.error.message);
  if (!claim.data?.length) return null;
  return async () => {
    const result = await sb.from("job_state").update({ paused_reason: null, lease_until: null, updated_at: new Date().toISOString() })
      .eq("job", job).eq("paused_reason", owner);
    if (result.error && !stop.signal.aborted) log({ event: "source_refresh_lock_release_failed", dataset_id: id, error: result.error.message });
  };
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
      if (pendingIds.has(dataset.id)) { skipped.push({ dataset_id: dataset.id, reason: "A complete refresh is already staged and awaiting verified import." }); continue; }
      const snapshot = native.find(s => s.id === dataset.latest_snapshot_id);
      if (!snapshot) continue;
      const file = fileByHash.get(snapshot.file_sha256);
      if (!file) throw new Error("Published snapshot has no source file evidence");
      const eligibility = refreshEligibility(file, snapshot.ingest as SourceIngest, new Date(), dataset.id);
      if (!eligibility.eligible) { skipped.push({ dataset_id: dataset.id, reason: eligibility.reason }); continue; }
      const state = stateByJob.get(stateJob(dataset.id)) ?? {};
      if (options.dataset || isRefreshDue(state, Date.now())) candidates.push({ dataset, snapshot, file, state, eligibility });
    }
  }
  candidates.sort((a, b) => (Date.parse(a.state.next_due_at ?? "1970-01-01") || 0) - (Date.parse(b.state.next_due_at ?? "1970-01-01") || 0)
    || a.dataset.id.localeCompare(b.dataset.id));
  return { candidates, skipped, publishedDatasets: datasets.length };
}

async function downloadOfficial(candidate: Candidate, folder: string, state: RefreshState) {
  const requestedUrl = candidate.eligibility.url;
  let url = requestedUrl;
  const headers: Record<string, string> = { Accept: "text/csv,text/plain,application/octet-stream;q=0.8", "Accept-Encoding": "identity",
    "User-Agent": process.env.OFFICIAL_SOURCE_USER_AGENT ?? "FiledUnder official-data refresh" };
  if (state.last_requested_url === requestedUrl) {
    if (state.etag) headers["If-None-Match"] = state.etag;
    else if (state.last_modified) headers["If-Modified-Since"] = state.last_modified;
  }
  const filePath = join(folder, "response.csv" + (candidate.snapshot.ingest.compression ? ".gz" : ""));
  if (candidate.eligibility.family === "fred") {
    return await downloadFred({ url: requestedUrl, filePath, userAgent: headers["User-Agent"],
      etag: headers["If-None-Match"], lastModified: headers["If-Modified-Since"], signal: stop.signal, deadline });
  }
  let response: Response | null = null;
  for (let redirects = 0; redirects <= 3; redirects++) {
    stop.signal.throwIfAborted();
    response = await baseFetch(url, { headers, redirect: "manual", signal: AbortSignal.any([stop.signal, AbortSignal.timeout(Math.min(120_000, Math.max(1, deadline - Date.now())))]) });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location || redirects === 3) throw new Error("Official source redirect limit reached");
    const next = new URL(location, url).href;
    if (!safeRefreshRedirect(requestedUrl, next)) throw new Error("Official source redirected outside its reviewed endpoint and series");
    url = next;
  }
  if (!response) throw new Error("No official source response");
  const etag = response.headers.get("etag") ?? undefined;
  const lastModified = response.headers.get("last-modified") ?? undefined;
  if (response.status === 304) return { notModified: true as const, url: requestedUrl, etag: etag ?? state.etag, lastModified: lastModified ?? state.last_modified };
  if (response.status !== 200 || !response.body) throw new Error(`Official source returned HTTP ${response.status}; complete 200 response required`);
  const contentType = response.headers.get("content-type") ?? "text/csv";
  if (/html|json|xml/i.test(contentType)) { await response.body.cancel(); throw new Error("Endpoint returned a document or JSON response; a native CSV adapter is required"); }
  const transferEncoding = response.headers.get("content-encoding");
  if (transferEncoding && transferEncoding.toLowerCase() !== "identity") { await response.body.cancel(); throw new Error("Official endpoint ignored identity transfer encoding; exact-byte handling requires a reviewed adapter"); }
  const declaredLength = response.headers.has("content-length") ? Number(response.headers.get("content-length")) : null;
  if (declaredLength !== null && (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > MAX_FILE_BYTES)) {
    await response.body.cancel(); throw new Error("Official source declared an invalid or oversized payload");
  }
  const file = await open(filePath, "wx", 0o600);
  const reader = response.body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      stop.signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_FILE_BYTES) throw new Error("Official source exceeds the bounded refresh payload size");
      let offset = 0;
      while (offset < value.length) {
        const written = await file.write(value, offset, value.length - offset);
        if (!written.bytesWritten) throw new Error("Could not persist complete official response bytes");
        offset += written.bytesWritten;
      }
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { await file.close(); reader.releaseLock(); }
  if (declaredLength !== null && bytes !== declaredLength) throw new Error("Official response byte count differs from Content-Length");
  return { notModified: false as const, filePath, bytes, url: requestedUrl, resolvedUrl: url,
    retrievedAt: new Date().toISOString(), contentType, etag, lastModified };
}

async function refreshOne(candidate: Candidate) {
  const id = candidate.dataset.id;
  await gate("source-refresh-dataset");
  const release = await claimDataset(id);
  if (!release) return { event: "source_refresh_already_leased", dataset_id: id };
  let folder: string | null = null;
  let state: RefreshState = {};
  try {
    state = await savedState(id);
    const pending = await sb.from("source_snapshots").select("id").eq("dataset_id", id).eq("status", "staging").limit(1);
    if (pending.error) throw new Error(`Read pending refresh: ${pending.error.message}`);
    if (pending.data.length) return { event: "source_refresh_waiting_for_import", dataset_id: id, snapshot_id: pending.data[0].id };
    state = { ...state, last_attempt_at: new Date().toISOString() };
    await saveState(id, state);
    await mkdir(WORK, { recursive: true });
    folder = await mkdtemp(join(WORK, "refresh-"));
    const downloaded = await downloadOfficial(candidate, folder, state);
    if (downloaded.notModified) {
      await saveState(id, refreshChecked(state, new Date(), candidate.eligibility.intervalMs, { url: downloaded.url, etag: downloaded.etag, lastModified: downloaded.lastModified }));
      return { event: "source_refresh_not_modified", dataset_id: id };
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
      await saveState(id, refreshFailure(state, new Date(), result.reason ?? "Refreshed native schema requires review"));
      return { event: "source_refresh_quarantined", dataset_id: id, ...result };
    }
    await saveState(id, refreshChecked(state, new Date(), candidate.eligibility.intervalMs, {
      url: downloaded.url, etag: downloaded.etag, lastModified: downloaded.lastModified,
      ...(result.snapshotId ? { stagedSnapshotId: result.snapshotId } : {}) }));
    return { event: "source_refresh_complete", dataset_id: id, ...result, published_by_this_step: false };
  } catch (error) {
    if (!stop.signal.aborted) await saveState(id, refreshFailure(state, new Date(), errorText(error)));
    return { event: "source_refresh_failed", dataset_id: id, error: errorText(error) };
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true });
    await release();
  }
}

async function fdicAdapterPlan() {
  const requested = options.all === "true" || options.dataset === FDIC_CURRENT_DATASET.id;
  if (!requested) return { selected: false, reason: "not_requested" };
  if (!FDIC_ENABLED) return { selected: false, reason: "Reviewed FDIC native adapter is disabled by OFFICIAL_FDIC_NATIVE_ENABLED=0." };
  await gate("source-refresh-plan-fdic");
  const state = await savedState(FDIC_CURRENT_DATASET.id);
  if (!options.dataset && !isRefreshDue(state, Date.now())) return { selected: false, reason: "not_due", state };
  const pending = await sb.from("source_snapshots").select("id").eq("dataset_id", FDIC_CURRENT_DATASET.id).eq("status", "staging").limit(1);
  if (pending.error) throw new Error(`Read pending FDIC refresh: ${pending.error.message}`);
  if (pending.data.length) return { selected: false, reason: "A complete FDIC refresh is already staged and awaiting verified import.", state };
  const baseline = await sb.from("source_snapshots").select("id").eq("dataset_id", FDIC_BASELINE_DATASET_ID).eq("status", "ready").limit(1);
  if (baseline.error) throw new Error(`Read FDIC baseline: ${baseline.error.message}`);
  if (!baseline.data.length) return { selected: false, reason: "Waiting for verified full historical FDIC baseline", state };
  return { selected: true, state, baselineId: baseline.data[0].id as string };
}

async function refreshFdic(baselineId: string) {
  const id = FDIC_CURRENT_DATASET.id;
  await gate("source-refresh-fdic");
  const release = await claimDataset(id);
  if (!release) return { event: "source_refresh_already_leased", dataset_id: id };
  let folder: string | null = null;
  let removeFolder = false;
  let state: RefreshState = {};
  try {
    state = await savedState(id);
    const pending = await sb.from("source_snapshots").select("id").eq("dataset_id", id).eq("status", "staging").limit(1);
    if (pending.error) throw new Error(pending.error.message);
    if (pending.data.length) return { event: "source_refresh_waiting_for_import", dataset_id: id, snapshot_id: pending.data[0].id };
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
    state = { ...state, last_attempt_at: new Date().toISOString() };
    await saveState(id, state);
    await mkdir(WORK, { recursive: true });
    folder = await mkdtemp(join(WORK, "refresh-fdic-"));
    const collected = await collectFdicNative({ columns: baseline.columns, baselineSnapshotId: baseline.id,
      workDir: folder, signal: stop.signal, onProgress: progress => log({ event: "source_refresh_fdic_collect", ...progress }) });
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
      await saveState(id, refreshFailure(state, new Date(), result.reason ?? "FDIC source schema requires review"));
      return { event: "source_refresh_quarantined", dataset_id: id, ...result, evidence_path: folder };
    }
    await saveState(id, refreshChecked(state, new Date(), 24 * 3600_000, { url: FDIC_CURRENT_DATASET.source_url,
      ...(result.snapshotId ? { stagedSnapshotId: result.snapshotId } : {}) }));
    removeFolder = true;
    return { event: "source_refresh_complete", adapter: "fdic_native", dataset_id: id, report_date: collected.reportDate,
      ...result, published_by_this_step: false };
  } catch (error) {
    if (!stop.signal.aborted) await saveState(id, refreshFailure(state, new Date(), errorText(error)));
    return { event: "source_refresh_failed", adapter: "fdic_native", dataset_id: id, error: errorText(error), evidence_path: folder };
  } finally {
    if (folder && removeFolder) await rm(folder, { recursive: true, force: true });
    await release();
  }
}

type TaiwanPlan = { market: TaiwanRevenueMarket; selected: boolean; reason?: string };
async function taiwanAdapterPlans(): Promise<TaiwanPlan[]> {
  const plans: TaiwanPlan[] = [];
  for (const market of ["TWSE", "TPEX"] as const) {
    const dataset = TAIWAN_REVENUE_DATASETS[market];
    if (options.all !== "true" && options.dataset !== dataset.id) { plans.push({ market, selected: false, reason: "not_requested" }); continue; }
    if (!TAIWAN_ENABLED) { plans.push({ market, selected: false, reason: "Reviewed Taiwan native revenue adapter is disabled by OFFICIAL_TAIWAN_REVENUE_ENABLED=0." }); continue; }
    await gate("source-refresh-plan-taiwan");
    const state = await savedState(dataset.id);
    if (!options.dataset && !isRefreshDue(state, Date.now())) { plans.push({ market, selected: false, reason: "not_due" }); continue; }
    const pending = await sb.from("source_snapshots").select("id").eq("dataset_id", dataset.id).eq("status", "staging").limit(1);
    if (pending.error) throw new Error(`Read pending Taiwan revenue refresh: ${pending.error.message}`);
    plans.push({ market, selected: !pending.data.length, ...(pending.data.length ? { reason: "A complete exchange refresh is already staged and awaiting verified import." } : {}) });
  }
  return plans;
}

async function refreshTaiwan(market: TaiwanRevenueMarket) {
  const dataset = TAIWAN_REVENUE_DATASETS[market], id = dataset.id;
  await gate("source-refresh-taiwan");
  const release = await claimDataset(id);
  if (!release) return { event: "source_refresh_already_leased", dataset_id: id };
  let folder: string | null = null;
  let removeFolder = false;
  let state: RefreshState = {};
  try {
    state = await savedState(id);
    const pending = await sb.from("source_snapshots").select("id").eq("dataset_id", id).eq("status", "staging").limit(1);
    if (pending.error) throw new Error(pending.error.message);
    if (pending.data.length) return { event: "source_refresh_waiting_for_import", dataset_id: id, snapshot_id: pending.data[0].id };
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
    state = { ...state, last_attempt_at: new Date().toISOString() };
    await saveState(id, state);
    await mkdir(WORK, { recursive: true });
    folder = await mkdtemp(join(WORK, `refresh-${market.toLowerCase()}-`));
    const collected = await collectTaiwanRevenue({ market, workDir: folder, signal: stop.signal,
      ...(priorCodes ? { previousCompanyCodes: priorCodes as string[] } : {}) });
    const result = await stageNativeRefresh({ sb, filePath: collected.filePath, retrievedAt: collected.retrievedAt,
      template: { datasetId: id, previousSnapshotId: previous?.id ?? null, previousFileSha256: previous?.file_sha256 ?? null,
        previousRows: previous?.expected_rows ?? 0, columns: previous?.columns ?? collected.columns,
        // The reviewed collector verifies this response's ROC month before it
        // creates the Gregorian index constant; never carry forward last month.
        ingest: collected.ingest, coverage: previous?.coverage ?? {} },
      sourceUrl: dataset.source_url, provenance: collected.provenance, freshCoverage: collected.coverage,
      supportingFiles: collected.supportingFiles, contentType: "text/csv", signal: stop.signal, gate });
    if (result.outcome === "quarantined") {
      await saveState(id, refreshFailure(state, new Date(), result.reason ?? "Exchange source schema requires review"));
      return { event: "source_refresh_quarantined", dataset_id: id, ...result, evidence_path: folder };
    }
    await saveState(id, refreshChecked(state, new Date(), 24 * 3600_000, { url: dataset.source_url,
      ...(result.snapshotId ? { stagedSnapshotId: result.snapshotId } : {}) }));
    removeFolder = true;
    return { event: "source_refresh_complete", adapter: "taiwan_revenue_native", market, dataset_id: id,
      reported_month: collected.period, native_reported_month: collected.nativePeriod, ...result, published_by_this_step: false };
  } catch (error) {
    if (!stop.signal.aborted) await saveState(id, refreshFailure(state, new Date(), errorText(error)));
    return { event: "source_refresh_failed", adapter: "taiwan_revenue_native", market, dataset_id: id, error: errorText(error), evidence_path: folder };
  } finally {
    if (folder && removeFolder) await rm(folder, { recursive: true, force: true });
    await release();
  }
}

try {
  const plan = await planCandidates();
  const fdicPlan = await fdicAdapterPlan();
  const taiwanPlans = await taiwanAdapterPlans();
  const nativeDue = Number(fdicPlan.selected) + taiwanPlans.filter(p => p.selected).length;
  if (options.plan === "true") {
    log({ event: "source_refresh_plan", published_datasets: plan.publishedDatasets, eligible_due: plan.candidates.length + nativeDue,
      due: plan.candidates.slice(0, maxDatasets).map(c => ({ dataset_id: c.dataset.id, family: c.eligibility.family, url: c.eligibility.url,
        next_due_at: c.state.next_due_at ?? null, interval_hours: c.eligibility.intervalMs / 3600_000 })),
      ineligible: options.dataset ? plan.skipped : plan.skipped.length,
      native_adapters: [{ dataset_id: FDIC_CURRENT_DATASET.id, enabled: FDIC_ENABLED, selected: fdicPlan.selected, reason: fdicPlan.reason ?? null },
        ...taiwanPlans.map(p => ({ dataset_id: TAIWAN_REVENUE_DATASETS[p.market].id, enabled: TAIWAN_ENABLED, selected: p.selected, reason: p.reason ?? null }))] });
  } else {
    let attempted = 0;
    let directAttempted = 0;
    let nativeAttempted = 0;
    let failures = 0;
    if (fdicPlan.selected && fdicPlan.baselineId && !stop.signal.aborted && deadline - Date.now() >= 30_000) {
      const result = await refreshFdic(fdicPlan.baselineId);
      attempted++;
      nativeAttempted++;
      if (result.event === "source_refresh_failed" || result.event === "source_refresh_quarantined") failures++;
      log(result);
    }
    for (const native of taiwanPlans.filter(p => p.selected)) {
      if (attempted >= maxDatasets || stop.signal.aborted || deadline - Date.now() < 30_000) break;
      const result = await refreshTaiwan(native.market);
      attempted++; nativeAttempted++;
      if (result.event === "source_refresh_failed" || result.event === "source_refresh_quarantined") failures++;
      log(result);
    }
    if (options.dataset && !plan.candidates.length && !nativeDue) log({ event: "source_refresh_not_selected", dataset_id: options.dataset,
      reason: options.dataset === FDIC_CURRENT_DATASET.id ? fdicPlan.reason
        : taiwanPlans.find(p => TAIWAN_REVENUE_DATASETS[p.market].id === options.dataset)?.reason
          ?? plan.skipped.find(item => item.dataset_id === options.dataset)?.reason ?? "No published ready source snapshot is available for this dataset." });
    for (const candidate of plan.candidates) {
      if (attempted >= maxDatasets || stop.signal.aborted || deadline - Date.now() < 10_000) break;
      const result = await refreshOne(candidate);
      attempted++;
      directAttempted++;
      if (result.event === "source_refresh_failed" || result.event === "source_refresh_quarantined") failures++;
      log(result);
    }
    log({ event: "source_refresh_run_complete", attempted, failed_or_quarantined: failures,
      due_remaining: Math.max(0, plan.candidates.length - directAttempted) + Math.max(0, nativeDue - nativeAttempted),
      ineligible_requires_separate_adapter: plan.skipped.length, published_by_this_step: false });
    if (failures) process.exitCode = 1;
  }
} catch (error) {
  log({ event: "source_refresh_run_failed", error: errorText(error), timed_out: stop.signal.aborted });
  process.exitCode = 1;
} finally {
  clearTimeout(timer);
  // Shared back-pressure probes own retry timers. All requests, local cleanup
  // and lease release have completed by this boundary; flush logs then exit so
  // those probe timers cannot extend the runner's explicit budget.
  await new Promise<void>(resolve => process.stdout.write("", () => resolve()));
  process.exit(stop.signal.aborted ? 124 : process.exitCode ?? 0);
}
