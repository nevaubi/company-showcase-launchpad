// Copies the partner's company, price and universe files into the private `datasets` bucket, the
// fallback `getDataset` already reads, so the app keeps working if the partner service is down.
// Usage: bun scripts/partner-mirror.ts [--concurrency=12] [--only=companies|prices]
import { sb, args, log, dbGate } from "./lib/supa";

const URL_ = process.env.PARTNER_DATA_URL || "https://filedunderai.vercel.app/api/app-data";
const KEY = process.env.PARTNER_DATA_KEY!;
const symbolFile = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");

async function fetchPartner(path: string): Promise<Uint8Array | null> {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${URL_}?path=${encodeURIComponent(path)}`, { headers: { "x-partner-key": KEY }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
    if (r?.ok) return new Uint8Array(await r.arrayBuffer());
    if (r?.status === 404) return null;
    await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
  }
  throw new Error(`partner unavailable: ${path}`);
}

async function existing(prefix: string): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.storage.from("datasets").list(prefix, { limit: 1000, offset: off });
    if (error) throw new Error(error.message);
    for (const o of data ?? []) m.set(`${prefix}/${o.name}`, Number((o.metadata as { size?: number } | null)?.size ?? -1));
    if (!data || data.length < 1000) break;
  }
  return m;
}

async function put(path: string, body: Uint8Array) {
  for (let i = 0; i < 3; i++) {
    const { error } = await sb.storage.from("datasets").upload(path, body, { upsert: true, contentType: "application/json" });
    if (!error) return;
    if (i === 2) throw new Error(`${path}: ${error.message}`);
    await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
  }
}

const uniBytes = await fetchPartner("universe.json");
if (!uniBytes) throw new Error("partner universe missing");
const tickers: string[] = JSON.parse(new TextDecoder().decode(uniBytes)).companies.map((c: { ticker: string }) => c.ticker);
await put("universe.json", uniBytes);
log("universe", tickers.length);

const kinds = (args.only ? [args.only] : ["companies", "prices"]) as ("companies" | "prices")[];
const conc = Number(args.concurrency ?? 12);
for (const kind of kinds) {
  const have = await existing(kind);
  const queue = tickers.map((t) => `${kind}/${symbolFile(t)}.json`);
  let copied = 0, same = 0, missing = 0, failed = 0, bytes = 0;
  await Promise.all(Array.from({ length: conc }, async () => {
    for (let p; (p = queue.shift());) {
      try {
        const body = await fetchPartner(p);
        if (!body) { missing++; continue; }
        if (have.get(p) === body.byteLength) { same++; continue; }
        await dbGate("partner-mirror");
        await put(p, body);
        copied++; bytes += body.byteLength;
      } catch (e) { failed++; log("fail", p, (e as Error).message); }
      const done = copied + same + missing + failed;
      if (done % 200 === 0) log(kind, done, "/", tickers.length);
    }
  }));
  log(kind, JSON.stringify({ copied, same, missing, failed, mb: Math.round(bytes / 1e6) }));
}
