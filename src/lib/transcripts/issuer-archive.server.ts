// Lovable Cloud is the archive of record. Research requests use only the two local record types below.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { archivedCalls, type ArchiveEntry, type CallBundle, type TurnFile } from "./archive";

export type StoredIssuerIndex = { bundle: CallBundle; sha256: string };
export type StoredIssuerTurns = {
  file: TurnFile;
  sha256: string;
  sourceHash: string;
  sourceUrl: string;
  kind: string;
  ticker: string;
};
export const issuerIndexKey = (ticker: string) => `issuer-index:v1:${ticker}`;
export const issuerTurnKey = (ticker: string, id: string, hash: string) =>
  `issuer-turns:v1:${ticker}:${id}:${hash}`;

export async function issuerRecord<T>(key: string, signal?: AbortSignal): Promise<T | null> {
  const q = supabaseAdmin.from("ai_cache").select("payload").eq("key", key);
  const { data, error } = await (signal ? q.abortSignal(signal) : q).maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.payload as T) ?? null;
}
export const issuerStatisticsKey = (ticker: string, id: string, hash: string) =>
  `issuer-statistics:v1:${ticker}:${id}:${hash}`;
export const presentIssuerTurns = (ticker: string, signal?: AbortSignal) =>
  issuerKeys("issuer-turns:v1:" + ticker + ":", signal);
export async function issuerKeys(prefix: string, signal?: AbortSignal) {
  const keys = new Set<string>();
  // Range the prefix, including share classes literally; PostgREST instances may impose a row cap.
  for (let from = 0; ; from += 500) {
    const q = supabaseAdmin
      .from("ai_cache")
      .select("key")
      .like("key", prefix + "%")
      .order("key")
      .range(from, from + 499);
    const { data, error } = await (signal ? q.abortSignal(signal) : q);
    if (error) throw new Error(error.message);
    for (const r of data || []) keys.add(r.key);
    if ((data || []).length < 500) return keys;
  }
}
export async function archiveIndex(
  ticker: string,
  signal?: AbortSignal,
): Promise<{ entries: ArchiveEntry[] }> {
  const [staged, current] = await Promise.all([
    issuerRecord<StoredIssuerIndex>("issuer-stage:v1:" + ticker, signal),
    issuerRecord<StoredIssuerIndex>(issuerIndexKey(ticker), signal),
  ]);
  const entries = [staged, current].flatMap((doc) =>
    doc ? archivedCalls(doc.bundle, ticker) : [],
  );
  if (!entries.length) return { entries: [] };
  const present = await presentIssuerTurns(ticker, signal);
  return {
    entries: entries.filter((e) => present.has(issuerTurnKey(ticker, e.archiveId, e.textHash))),
  };
}
export async function issuerTurns(
  ticker: string,
  entry: ArchiveEntry,
  signal?: AbortSignal,
): Promise<TurnFile | null> {
  const record = await issuerRecord<StoredIssuerTurns>(
    issuerTurnKey(ticker, entry.archiveId, entry.textHash),
    signal,
  );
  if (
    !record ||
    record.ticker !== ticker ||
    record.sourceHash !== entry.textHash ||
    record.sourceUrl !== entry.url ||
    record.kind !== entry.archiveKind ||
    record.file.call_id !== entry.archiveId
  )
    return null;
  return record.file;
}
