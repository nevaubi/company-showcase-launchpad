// Mirror the bundled company datasets and markets.json into the private `datasets` bucket so
// server code (report generation) can read them. Rerun after `bun scripts/ingest.ts` or
// `bun scripts/markets.ts`. Usage: bun scripts/sync-datasets.ts [--only=AAPL,MSFT]
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

const files = readdirSync("public/data/companies").filter((f) => f.endsWith(".json") && (!only || only.includes(f.replace(/\.json$/, ""))));
let n = 0;
for (const f of files) {
  await put(`companies/${f}`, readFileSync(`public/data/companies/${f}`, "utf8"));
  if (++n % 10 === 0) log(`${n}/${files.length} companies`);
}
if (!only) await put("markets.json", readFileSync("public/data/markets.json", "utf8"));
log(`synced ${n} company datasets${only ? "" : " + markets.json"}`);
