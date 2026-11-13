// Copies the partner IR store (index, originals, extracted text, Docling tables) into this Cloud:
// files go to the private `ir-documents` bucket under `partner/`, indexes to `datasets`, and each
// copied object is recorded in the service-role-only `partner_mirror` table so reruns resume.
// Usage: bun scripts/partner-mirror-ir.ts [--concurrency=32] [--tickers=AAPL,MSFT]
import { sb, args, log, dbGate } from "./lib/supa";

const URL_ = process.env.PARTNER_DATA_URL || "https://filedunderai.vercel.app/api/app-data";
const KEY = process.env.PARTNER_DATA_KEY!;
const CONC = Number(args.concurrency ?? 32);

// Partner daily download cap: stop cleanly (nothing marked failed) and resume on the next run.
class DailyLimit extends Error { constructor() { super("partner daily limit"); } }
let limited = false;

async function partner(path: string, timeout = 60_000): Promise<Response | null> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${URL_}?path=${encodeURIComponent(path)}`, { headers: { "x-partner-key": KEY }, signal: AbortSignal.timeout(timeout) }).catch(() => null);
    if (r?.ok) return r;
    if (r?.status === 404) return null;
    if (r?.status === 429) { limited = true; throw new DailyLimit(); }
    await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error(`partner unavailable: ${path}`);
}

async function upload(bucket: string, path: string, body: Uint8Array, type: string) {
  for (let i = 0; i < 3; i++) {
    const { error } = await sb.storage.from(bucket).upload(path, body, { upsert: true, contentType: type || "application/octet-stream" });
    if (!error) return;
    if (i === 2) throw new Error(error.message);
    await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
  }
}

async function copyObject(objectPath: string): Promise<{ bytes: number; type: string } | null> {
  const signed = await partner(`irstore/${objectPath}`);
  if (!signed) return null;
  const { url } = (await signed.json()) as { url: string };
  let res: Response | null = null;
  for (let i = 0; i < 3 && !res?.ok; i++) res = await fetch(url, { signal: AbortSignal.timeout(180_000) }).catch(() => null);
  if (!res?.ok) throw new Error(`download ${res?.status ?? "failed"}`);
  const body = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get("content-type") ?? "";
  await upload("ir-documents", `partner/${objectPath}`, body, type);
  return { bytes: body.byteLength, type };
}

const uni = (await (await partner("universe.json").catch((e) => { if (e instanceof DailyLimit) { log("partner daily limit still active; try again after it resets"); process.exit(0); } throw e; }))!.json()) as { companies: { ticker: string }[] };
const tickers = args.tickers ? args.tickers.split(",") : uni.companies.map((c) => c.ticker);
const t0 = Date.now();
let files = 0, bytes = 0, failed = 0, skipped = 0, doneTk = 0;

async function doneSet(ticker: string) {
  const s = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from("partner_mirror").select("path").eq("ticker", ticker).eq("status", "done").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) s.add(r.path);
    if (!data || data.length < 1000) break;
  }
  return s;
}

type Job = { ticker: string; path: string; kind: string; sha256?: string | null; run: () => Promise<number | null> };
const jobs: Job[] = [];
let feeding = true;

async function record(rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  rows = rows.map((r) => ({ sha256: null, bytes: null, error: null, mirrored_at: new Date().toISOString(), ...r }));
  await dbGate("partner-mirror-ir");
  const { error } = await sb.from("partner_mirror").upsert(rows);
  if (error) log("manifest error", error.message);
}

const pending: Record<string, unknown>[] = [];
const workers = Array.from({ length: CONC }, async () => {
  while ((feeding || jobs.length) && !limited) {
    const j = jobs.shift();
    if (!j) { await new Promise((s) => setTimeout(s, 200)); continue; }
    try {
      const n = await j.run();
      if (n === null) { skipped++; pending.push({ path: j.path, ticker: j.ticker, kind: j.kind, status: "missing" }); }
      else { files++; bytes += n; pending.push({ path: j.path, ticker: j.ticker, kind: j.kind, sha256: j.sha256 ?? null, bytes: n, status: "done", mirrored_at: new Date().toISOString() }); }
    } catch (e) {
      if (e instanceof DailyLimit) break;
      failed++; pending.push({ path: j.path, ticker: j.ticker, kind: j.kind, status: "failed", error: String((e as Error).message).slice(0, 300) });
    }
    if (pending.length >= 200) await record(pending.splice(0));
  }
});

const progress = setInterval(() => {
  const s = (Date.now() - t0) / 1000;
  log(`tickers ${doneTk}/${tickers.length} files ${files} failed ${failed} missing ${skipped} ${(bytes / 1e9).toFixed(2)} GB ${(bytes / 1e6 / s).toFixed(1)} MB/s queue ${jobs.length}`);
}, 30_000);

for (const ticker of tickers) {
  if (limited) break;
  while (jobs.length > CONC * 20) await new Promise((s) => setTimeout(s, 250));
  try {
    const have = await doneSet(ticker);
    const idxRes = await partner(`ir/${ticker}.json`);
    if (idxRes) {
      const raw = new Uint8Array(await idxRes.arrayBuffer());
      await upload("datasets", `ir/${ticker}.json`, raw, "application/json");
      const idx = JSON.parse(new TextDecoder().decode(raw)) as { documents: { storage_path: string | null; text_path: string | null; sha256?: string | null }[] };
      for (const d of idx.documents ?? []) {
        for (const [p, kind] of [[d.storage_path, "original"], [d.text_path, "text"]] as const) {
          if (!p || have.has(p)) continue;
          jobs.push({ ticker, path: p, kind, sha256: kind === "original" ? d.sha256 : null, run: async () => (await copyObject(p))?.bytes ?? null });
        }
      }
    }
    const dtRes = await partner(`doctables/${ticker}/index.json`);
    if (dtRes) {
      const raw = new Uint8Array(await dtRes.arrayBuffer());
      await upload("datasets", `doctables/${ticker}/index.json`, raw, "application/json");
      const dt = JSON.parse(new TextDecoder().decode(raw)) as { documents: { id: string }[] };
      for (const d of dt.documents ?? []) {
        const p = `doctables/${ticker}/${d.id}.json`;
        if (have.has(p)) continue;
        jobs.push({ ticker, path: p, kind: "doctables", run: async () => {
          const r = await partner(p);
          if (!r) return null;
          const b = new Uint8Array(await r.arrayBuffer());
          await upload("datasets", p, b, "application/json");
          return b.byteLength;
        } });
      }
    }
  } catch (e) { if (e instanceof DailyLimit) break; log("index fail", ticker, (e as Error).message); }
  doneTk++;
}
feeding = false;
await Promise.all(workers);
await record(pending.splice(0));
clearInterval(progress);
if (limited) log("STOPPED: partner daily limit reached; rerun after it resets to continue");
log(`DONE files ${files} failed ${failed} missing ${skipped} ${(bytes / 1e9).toFixed(2)} GB in ${Math.round((Date.now() - t0) / 60000)} min`);
