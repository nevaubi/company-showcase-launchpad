// Scheduled partner mirror: copies one partner dataset file per call (universe, company and
// price files for every covered ticker) into the `datasets` bucket, the copy `getDataset` and the
// report loader fall back to. Cursor in job_state; a full cycle of ~3,700 files takes about 2.5 days at one call a minute (partner rebuilds twice a week).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { COVERAGE } from "@/lib/coverage";

const URL_ = process.env["PARTNER_DATA_URL"] || "https://filedunderai.vercel.app/api/app-data";
const symbolFile = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");
export const MIRROR_STEP = 1;

export function mirrorPaths(tickers = COVERAGE.map((c) => c.ticker)) {
  return ["universe.json", ...tickers.flatMap((t) => [`companies/${symbolFile(t)}.json`, `prices/${symbolFile(t)}.json`])];
}

type Outcome = { path: string; result: "copied" | "missing" | "failed"; bytes?: number; error?: string };

export async function copyOne(path: string, key: string, ms: number, fetcher: typeof fetch = fetch): Promise<Outcome> {
  try {
    const r = await fetcher(`${URL_}?path=${encodeURIComponent(path)}`, { headers: { "x-partner-key": key }, signal: AbortSignal.timeout(ms) });
    if (r.status === 404) return { path, result: "missing" };
    if (!r.ok) return { path, result: "failed", error: `HTTP ${r.status}` };
    const body = new Uint8Array(await r.arrayBuffer());
    JSON.parse(new TextDecoder().decode(body)); // never overwrite a good copy with a broken file
    const { error } = await supabaseAdmin.storage.from("datasets").upload(path, body, { upsert: true, contentType: "application/json" });
    if (error) return { path, result: "failed", error: error.message };
    return { path, result: "copied", bytes: body.byteLength };
  } catch (e) {
    return { path, result: "failed", error: (e as Error).message.slice(0, 160) };
  }
}

export async function runPartnerMirror(ms: number, fetcher: typeof fetch = fetch) {
  const key = process.env["PARTNER_DATA_KEY"];
  if (!key) return { ok: false, items: 0, detail: { error: "PARTNER_DATA_KEY is not set" } };
  const paths = mirrorPaths();
  const { data: st, error } = await supabaseAdmin.from("job_state").select("cursor").eq("job", "partner-mirror").maybeSingle();
  if (error) throw new Error(error.message);
  const start = (st?.cursor ?? 0) % paths.length;
  const picked = paths.slice(start, start + MIRROR_STEP);
  const out = await Promise.all(picked.map((p) => copyOne(p, key, ms, fetcher)));
  // Partner unreachable for every file: stay on this cursor (retry next call) and say so.
  const down = out.every((o) => o.result === "failed");
  const next = down ? start : (start + picked.length) % paths.length;
  const { error: e2 } = await supabaseAdmin.from("job_state").upsert({ job: "partner-mirror", cursor: next, paused_reason: down ? `partner unreachable: ${out[0]?.error ?? ""}`.slice(0, 200) : null, updated_at: new Date().toISOString() });
  if (e2) throw new Error(e2.message);
  return { ok: !down, items: out.filter((o) => o.result === "copied").length, detail: { at: start, of: paths.length, out } };
}
