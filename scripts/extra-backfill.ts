// Builds SEC statements + 10y prices for every non-bundled company (scripts/ingest.ts --extra)
// in small batches and uploads each batch to the public `datasets` bucket, with a merged
// companies/universe.json, so an interrupted run resumes where it stopped.
//   bun scripts/extra-backfill.ts [--batch=24] [--concurrency=3] [--redo]
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { sb, args, log } from "./lib/supa";
import { COVERAGE, isBundled } from "@/lib/coverage";
import type { Universe, UniverseEntry } from "@/lib/financials/types";

const BUCKET = "datasets";
const STAGE = "/tmp/ingest/extra";
const symbolFile = (s: string) => s.replace(/\^/g, "IDX_").replace(/[^A-Za-z0-9_.-]/g, "_");

async function loadUniverse(): Promise<Universe> {
  const { data } = await sb.storage.from(BUCKET).download("universe.json");
  return data ? (JSON.parse(await data.text()) as Universe) : { generatedAt: "", companies: [] };
}
async function put(path: string, body: string) {
  for (let i = 0; i < 4; i++) {
    const { error } = await sb.storage.from(BUCKET).upload(path, new Blob([body], { type: "application/json" }), { contentType: "application/json", upsert: true, cacheControl: "3600" });
    if (!error) return true;
    log("upload retry", path, error.message);
    await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
  }
  return false;
}

const universe = await loadUniverse();
const done = new Set(args.redo ? [] : universe.companies.map((c) => c.ticker));
const todo = COVERAGE.filter((c) => !isBundled(c.ticker) && !done.has(c.ticker)).map((c) => c.ticker);
const batch = Number(args.batch ?? 24);
log(`extra backfill: ${done.size} done, ${todo.length} to build`);

for (let i = 0; i < todo.length; i += batch) {
  const part = todo.slice(i, i + batch);
  spawnSync("bun", ["scripts/ingest.ts", "--extra", `--tickers=${part.join(",")}`, `--concurrency=${args.concurrency ?? 3}`], { stdio: "inherit" });
  const staged = existsSync(`${STAGE}/universe.json`) ? (JSON.parse(readFileSync(`${STAGE}/universe.json`, "utf8")) as Universe) : null;
  const byT = new Map<string, UniverseEntry>(universe.companies.map((c) => [c.ticker, c]));
  for (const t of part) {
    const cf = `${STAGE}/companies/${t}.json`;
    const pf = `${STAGE}/prices/${symbolFile(t)}.json`;
    const entry = staged?.companies.find((c) => c.ticker === t);
    if (!existsSync(cf) || !entry) {
      log(`  ${t}: no dataset built`);
      continue;
    }
    const ok = (await put(`companies/${t}.json`, readFileSync(cf, "utf8"))) && (!existsSync(pf) || (await put(`prices/${symbolFile(t)}.json`, readFileSync(pf, "utf8"))));
    if (ok) byT.set(t, entry);
  }
  const order = new Map(COVERAGE.map((c, k) => [c.ticker, k]));
  universe.companies = [...byT.values()].sort((a, b) => (order.get(a.ticker) ?? 0) - (order.get(b.ticker) ?? 0));
  universe.generatedAt = new Date().toISOString();
  await put("universe.json", JSON.stringify(universe));
  log(`batch ${i / batch + 1}: ${universe.companies.length} companies published`);
}
log("extra backfill finished", universe.companies.length);
