// Mirror the bundled company datasets, price histories, the core universe and markets.json into the
// private `datasets` bucket so server code (report generation, peer comparisons) can read them.
// Rerun after `bun scripts/ingest.ts` or `bun scripts/markets.ts`.
// Usage: bun scripts/sync-datasets.ts [--only=AAPL,MSFT] [--prices-only]
import { readdirSync, readFileSync } from "node:fs";
import { args, log, sb } from "./lib/supa";

const BUCKET = "datasets";
const only = args.only?.split(",").map((s) => s.trim().toUpperCase());

async function put(path: string, body: string) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await sb.storage.from(BUCKET).upload(path, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: true, cacheControl: "3600" });
    if (!error) return;
    log("retry", path, error.message);
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  throw new Error(`upload failed: ${path}`);
}

const pick = (dir: string) => readdirSync(dir).filter((f) => f.endsWith(".json") && (!only || only.includes(f.replace(/\.json$/, ""))));
const pricesOnly = args["prices-only"] !== undefined;
let n = 0;
if (!pricesOnly) {
  const files = pick("public/data/companies");
  for (const f of files) {
    await put(`companies/${f}`, readFileSync(`public/data/companies/${f}`, "utf8"));
    if (++n % 10 === 0) log(`${n}/${files.length} companies`);
  }
}
// Price histories of the bundled companies and the index ETFs (SPY, QQQ) for peer comparisons.
// The partner-universe companies' prices are written to the bucket by scripts/extra-backfill.ts.
let np = 0;
for (const f of pick("public/data/prices")) {
  await put(`prices/${f}`, readFileSync(`public/data/prices/${f}`, "utf8"));
  if (++np % 20 === 0) log(`${np} price files`);
}
if (!only) {
  await put("universe-core.json", readFileSync("public/data/universe.json", "utf8"));
  if (!pricesOnly) await put("markets.json", readFileSync("public/data/markets.json", "utf8"));
}
log(`synced ${n} company datasets, ${np} price files${only ? "" : " + universe-core.json + markets.json"}`);
