import { createHash } from "node:crypto";
import {
  archivedCalls,
  fromArchive,
  type ArchiveCall,
  type CallBundle,
  type TurnFile,
} from "@/lib/transcripts/archive";
import { transcriptStatistics } from "@/lib/transcripts/statistics";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  archiveIndex,
  issuerKeys,
  issuerStatisticsKey,
  issuerTurns,
  issuerIndexKey,
  issuerRecord,
  issuerTurnKey,
  presentIssuerTurns,
  type StoredIssuerIndex,
} from "@/lib/transcripts/issuer-archive.server";
import type { CoverageCompany } from "@/lib/coverage";

const SOURCE =
  "https://apxfeteebnspwyajlxfh.supabase.co/storage/v1/object/public/public-data/calls/";
const TICKER = /^[A-Z0-9][A-Z0-9.-]{0,15}$/;
type SourceFile<T> = { value: T; sha256: string };
async function sourceFile<T>(path: string): Promise<SourceFile<T> | null> {
  const r = await fetch(SOURCE + path, { signal: AbortSignal.timeout(18_000) });
  if (r.status === 404) return null;
  if (r.status === 400) {
    const detail = await r.json().catch(() => null);
    if (detail?.statusCode === "404" && detail?.code === "NoSuchKey") return null;
  }
  if (!r.ok) throw new Error("Issuer archive source HTTP " + r.status);
  const bytes = Buffer.from(await r.arrayBuffer());
  return {
    value: JSON.parse(bytes.toString("utf8")) as T,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
async function put(key: string, payload: unknown, signal?: AbortSignal) {
  const q = supabaseAdmin
    .from("ai_cache")
    .upsert({ key, payload: payload as never, created_at: new Date().toISOString() });
  const { error } = await (signal ? q.abortSignal(signal) : q);
  if (error) throw error;
}
export function verifiedIssuerCall(c: ArchiveCall, b: CallBundle) {
  const prefix = b.ticker + "-" + c.date + "-";
  return (
    c.ticker === b.ticker &&
    TICKER.test(b.ticker) &&
    /^\d{4}-\d{2}-\d{2}$/.test(c.date) &&
    c.call_id.startsWith(prefix) &&
    /^[a-f0-9]{6}$/.test(c.call_id.slice(prefix.length)) &&
    /^[a-f0-9]{64}$/.test(c.sha) &&
    Number.isInteger(c.n_turns) &&
    c.n_turns! > 0 &&
    !!b.docs?.[c.doc]?.url?.match(/^https?:\/\//i)
  );
}
export function completeIssuerTurns(call: ArchiveCall, file: TurnFile) {
  if (file?.call_id !== call.call_id || !Array.isArray(file.turns) || !file.turns.length)
    return false;
  const roster = new Map(call.speakers.map((s) => [s.idx, s]));
  const counts = new Map<number, { turns: number; words: number }>();
  let totalWords = 0;
  for (const [i, t] of file.turns.entries()) {
    if (
      t.i !== i ||
      typeof t.x !== "string" ||
      !roster.has(t.sp) ||
      !Number.isInteger(t.w) ||
      t.w < 0 ||
      !["prepared", "qa"].includes(t.sec)
    )
      return false;
    const seen = counts.get(t.sp) ?? { turns: 0, words: 0 };
    seen.turns++;
    seen.words += t.w;
    totalWords += t.w;
    counts.set(t.sp, seen);
  }
  if (file.turns.length === call.n_turns) return true;
  // Some management scripts split one long speech over printed pages. The headline turn total can
  // be stale; accept that exception only if every speaker total AND the document word total agree.
  return (
    call.kind === "remarks" &&
    file.turns.every((t) => t.sec === "prepared") &&
    totalWords === call.words &&
    call.speakers.every(
      (s) =>
        s.turns === (counts.get(s.idx)?.turns || 0) && s.words === (counts.get(s.idx)?.words || 0),
    )
  );
}

/** Stage the latest complete index, import a bounded portion of its immutable files, then promote it.
 * A missed source object or interrupted import never overwrites a complete local copy. */
export async function mirrorIssuerSlice(
  co: Pick<CoverageCompany, "ticker" | "shortName">,
  limit = 5,
) {
  const ticker = co.ticker;
  if (!TICKER.test(ticker)) throw new Error("Unexpected issuer ticker");
  const pendingKey = "issuer-stage:v1:" + ticker;
  type Stage = StoredIssuerIndex & { checked: number; retry: Record<string, number> };
  let staged = await issuerRecord<Stage>(pendingKey);
  const oldStage = staged;
  const now = Date.now();
  const current = await issuerRecord<StoredIssuerIndex>(issuerIndexKey(ticker));
  if (!staged || now - staged.checked > 86400_000) {
    const response = await sourceFile<CallBundle>(ticker + ".json");
    if (!response) return { copied: 0, remaining: 0 };
    const bundle = response.value;
    if (bundle.ticker !== ticker || !Array.isArray(bundle.calls) || !bundle.docs)
      throw new Error("Ticker or call index mismatch");
    staged = { bundle, sha256: response.sha256, checked: now, retry: {} };
  }
  const bundle = staged.bundle;
  const archived = await presentIssuerTurns(ticker);
  const missing = bundle.calls.filter(
    (c) => verifiedIssuerCall(c, bundle) && !archived.has(issuerTurnKey(ticker, c.call_id, c.sha)),
  );
  if (!missing.length && !oldStage && current?.sha256 === staged.sha256)
    return { copied: 0, remaining: 0 };
  if (!oldStage || oldStage.sha256 !== staged.sha256) await put(pendingKey, staged);
  const available = missing.filter((c) => (staged.retry[c.call_id] || 0) <= now);
  const selected = available.slice(0, limit);
  const byId = new Map(archivedCalls(bundle, ticker).map((entry) => [entry.archiveId, entry]));
  let copied = 0;
  for (const c of selected) {
    const source = await sourceFile<TurnFile>(ticker + "/" + c.call_id + ".json");
    if (!source || !completeIssuerTurns(c, source.value)) {
      staged.retry[c.call_id] = now + 6 * 3600_000;
      console.warn("Issuer archive awaiting complete turn file", c.call_id);
      continue;
    }
    const file = source.value;
    await put(issuerTurnKey(ticker, c.call_id, c.sha), {
      file,
      sha256: source.sha256,
      sourceHash: c.sha,
      sourceUrl: bundle.docs[c.doc].url,
      kind: c.kind,
      ticker,
      indexedTurnCount: c.n_turns,
      verifiedTurnCount: file.turns.length,
    });
    // Persist the reader's established measurements along with native source text.
    const entry = byId.get(c.call_id);
    if (entry) {
      const transcript = fromArchive(ticker, co.shortName, entry, file);
      if (transcript)
        await put(issuerStatisticsKey(ticker, c.call_id, c.sha), {
          statistics: transcriptStatistics(transcript),
        });
    }
    copied++;
  }
  if (missing.length === copied) {
    if (current?.sha256 !== staged.sha256)
      await put(issuerIndexKey(ticker), { bundle, sha256: staged.sha256 });
    const { error } = await supabaseAdmin
      .from("ai_cache")
      .delete()
      .eq("key", pendingKey)
      .eq("payload->>sha256", staged.sha256);
    if (error) throw error;
  } else await put(pendingKey, staged);
  return { copied, remaining: available.length - selected.length };
}

/** Build the indexed earnings analysis directly from local originals, even when the source service is offline. */
export async function analyzeIssuerSlice(
  co: Pick<CoverageCompany, "ticker" | "shortName">,
  limit = 8,
  signal?: AbortSignal,
) {
  const [archive, measured] = await Promise.all([
    archiveIndex(co.ticker, signal),
    issuerKeys("issuer-statistics:v1:" + co.ticker + ":", signal),
  ]);
  const pending = new Map<string, (typeof archive.entries)[number]>();
  for (const entry of archive.entries) {
    const key = issuerStatisticsKey(co.ticker, entry.archiveId, entry.textHash);
    if (!measured.has(key) && !pending.has(key)) pending.set(key, entry);
  }
  let processed = 0;
  for (const [key, entry] of pending) {
    if (processed >= limit) break;
    signal?.throwIfAborted();
    const file = await issuerTurns(co.ticker, entry, signal);
    const transcript = file && fromArchive(co.ticker, co.shortName, entry, file);
    if (!transcript) throw new Error("Incomplete native transcript " + entry.archiveId);
    const statistics = transcriptStatistics(transcript);
    signal?.throwIfAborted();
    await put(key, { statistics }, signal);
    processed++;
  }
  return { processed, remaining: pending.size - processed };
}
