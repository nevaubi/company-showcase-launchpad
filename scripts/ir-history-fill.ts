// Consumes an explicit native history request. Each pass has a lease, preserves the prior
// company object, and verifies canonical objects and the newly published chart before completion.
import { reportedChartAudit, scenarioDocument } from "../src/lib/ir/reported-scope";
import { documentRows, rebuildCompany } from "../src/lib/ir/rebuild.server";
import { fillCachePath } from "../src/lib/ir/table-fill-cache";
import {
  FILL_ATTEMPTS,
  FILL_STAGE_KEY,
  HISTORY_FILL_JOB,
  fillDigest,
  unpackStagedFill,
  type StagedFill,
} from "./lib/ir-history-fill";
import { args, dbGate, log, sb } from "./lib/supa";

async function promote(ticker: string): Promise<Map<string, string>> {
  const prefix = FILL_STAGE_KEY + ticker + ":";
  const { data: stages, error } = await sb
    .from("ai_cache")
    .select("key,payload")
    .like("key", prefix + "%")
    .limit(60);
  if (error) throw new Error(error.message);
  const bucket = sb.storage.from("ir-documents");
  const docs = new Map<string, string>();
  for (const row of stages ?? []) {
    const id = row.key.slice(prefix.length);
    const { data: doc, error: docError } = await sb
      .from("ir_documents")
      .select("id,ticker,accn,source_url,sha256")
      .eq("id", id)
      .eq("ticker", ticker)
      .single();
    if (docError) throw new Error(docError.message);
    const stage = row.payload as StagedFill;
    const body = unpackStagedFill(stage, doc, row.key);
    const path = fillCachePath(id);
    const existing = await bucket.download(path);
    if (!existing.data) {
      const saved = await bucket.upload(path, new Blob([body], { type: "application/json" }), {
        contentType: "application/json",
        upsert: false,
      });
      // If another native process wrote it first, the readback below still verifies its contents.
      if (saved.error && !/exist|duplicate|409/i.test(saved.error.message))
        throw new Error(saved.error.message);
    }
    const check = existing.data ?? (await bucket.download(path)).data;
    if (!check || fillDigest(await check.text()) !== stage.sha256)
      throw new Error("Private table-cache readback failed for " + id);
    docs.set(id, stage.sha256);
  }
  return docs;
}

async function run(ticker: string) {
  const job = HISTORY_FILL_JOB + ticker;
  const now = new Date().toISOString();
  const { data: row, error } = await sb
    .from("job_state")
    .select("job,cursor,paused_reason,lease_until")
    .eq("job", job)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (
    !row ||
    !row.paused_reason ||
    !(row.paused_reason === "requested" || row.paused_reason.startsWith("owner:")) ||
    (row.lease_until && row.lease_until > now)
  )
    return;
  const attempt = Number(row.cursor ?? 0) + 1;
  const owner = "owner:" + crypto.randomUUID();
  const { data: claim, error: claimError } = await sb
    .from("job_state")
    .update({
      lease_until: new Date(Date.now() + 60 * 60_000).toISOString(),
      cursor: attempt,
      paused_reason: owner,
      updated_at: now,
    })
    .eq("job", job)
    .eq("cursor", row.cursor)
    .eq("paused_reason", row.paused_reason)
    .or("lease_until.is.null,lease_until.lte." + now)
    .select("job")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claim) return;
  let status = "requested";
  let delay = 60_000;
  const detail: Record<string, unknown> = { ticker, attempt };
  try {
    await dbGate("ir-history-fill");
    const { data: previous, error: queryError } = await sb
      .from("ir_company_series")
      .select("built_at,payload_path")
      .eq("ticker", ticker)
      .single();
    if (queryError) throw new Error(queryError.message);
    const excluded = (await documentRows(ticker)).filter(scenarioDocument);
    const scenarioIds = new Set(excluded.map((d) => d.id));
    detail.excludedScenarioDocuments = excluded.map((d) => d.id);
    if (scenarioIds.size && previous.payload_path) {
      const prior = await sb.storage.from("ir-documents").download(previous.payload_path);
      if (prior.data)
        detail.previousReportedScope = reportedChartAudit(
          JSON.parse(await prior.data.text()),
          scenarioIds,
        );
    }
    const promoted = await promote(ticker);
    detail.promoted = promoted.size;
    const result = await rebuildCompany(ticker, { expectedBuiltAt: previous.built_at });
    if (!result) throw new Error("No native history was available for rebuild");
    const { data: saved, error: savedError } = await sb
      .from("ir_company_series")
      .select("built_at,payload_path,stats")
      .eq("ticker", ticker)
      .single();
    if (
      savedError ||
      !saved?.payload_path ||
      Date.parse(saved.built_at) !== Date.parse(result.builtAt)
    )
      throw new Error("Chart manifest readback failed");
    const blob = await sb.storage.from("ir-documents").download(saved.payload_path);
    if (blob.error || !blob.data) throw new Error("Published chart object unavailable");
    const sample = JSON.parse(await blob.data.text());
    if (
      sample.ticker !== ticker ||
      sample.builtAt !== result.builtAt ||
      sample.series?.length !== result.series.length ||
      sample.stats?.lastPeriod !== result.stats.lastPeriod
    )
      throw new Error("Published chart does not match this rebuild");
    const scope = reportedChartAudit(sample, scenarioIds);
    detail.publishedReportedScope = scope;
    if (scope.scenarioSources.length || scope.projectionSeries)
      throw new Error("Published chart contains scenario observations");
    const fill = sample.stats.quality?.fill;
    if (!fill || !Number.isInteger(fill.waiting) || fill.failed)
      throw new Error("Historical document fill is incomplete");
    Object.assign(detail, {
      path: saved.payload_path,
      previousPath: previous.payload_path,
      waiting: fill.waiting,
      read: fill.read,
      series: sample.series.length,
      periodEnd: sample.stats.lastPeriod,
      verified: [...promoted.keys()],
    });
    if (fill.waiting === 0) {
      status = "complete";
      // Staged copies are private; discard only the exact generation already read back from canonical storage.
      for (const [id, sha256] of promoted) {
        const { error: cleanupError } = await sb
          .from("ai_cache")
          .delete()
          .eq("key", FILL_STAGE_KEY + ticker + ":" + id)
          .eq("payload->>sha256", sha256);
        if (cleanupError) throw new Error(cleanupError.message);
      }
    } else if (attempt >= FILL_ATTEMPTS) status = "review";
  } catch (e) {
    detail.error = (e as Error).message.slice(0, 320);
    status = attempt >= FILL_ATTEMPTS ? "review" : "requested";
    delay = 10 * 60_000;
  }
  const finished = new Date().toISOString();
  const { error: releaseError } = await sb
    .from("job_state")
    .update({
      paused_reason: status,
      lease_until: status === "requested" ? new Date(Date.now() + delay).toISOString() : null,
      updated_at: finished,
    })
    .eq("job", job)
    .eq("paused_reason", owner);
  if (releaseError) throw new Error(releaseError.message);
  const { error: logError } = await sb.from("job_runs").insert({
    job,
    started_at: now,
    finished_at: finished,
    ok: !detail.error,
    items: Number(detail.promoted ?? 0),
    detail,
  });
  if (logError) throw new Error(logError.message);
  log(JSON.stringify({ ...detail, status }));
  if (detail.error) process.exitCode = 1;
}
const ticker = args.ticker;
if (!ticker || !/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker))
  throw new Error("A covered ticker is required");
await run(ticker);
