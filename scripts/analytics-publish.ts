// Worker step: rebuild a bundled analytics set and publish it to the `datasets` bucket under
// analytics/ (the app's loaders read that copy first, see src/lib/analytics-files.ts).
//   bun scripts/analytics-publish.ts --set=markets|auctions|hedge|context
// context: next 20 companies per run from a rolling cursor (job_state `analytics-context`) over the
// whole covered list; a full lap then keeps refreshing the oldest.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { args, log, sb } from "./lib/supa";
import { COVERAGE } from "@/lib/coverage";
import { contextSlice } from "./lib/analytics-publish";

const set = args.set;
const now = () => new Date().toISOString();
function gen(file: string, argv: string[] = []) {
  const r = spawnSync("bun", [file, ...argv], { stdio: "inherit", timeout: 50 * 60_000 });
  if (r.status !== 0) throw new Error(`${file} exited ${r.status}`);
}
const STARTED = Date.now();
/** Uploads only files this run rebuilt, so a stale bundled copy is never republished as fresh. */
async function upload(local: string, name: string) {
  if (!existsSync(local) || statSync(local).mtimeMs < STARTED - 1000) return false;
  const { error } = await sb.storage.from("datasets").upload(`analytics/${name}`, new Blob([readFileSync(local)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
  if (error) throw new Error(`${name}: ${error.message}`);
  return true;
}

const JOB = `analytics-${set}`;
let items = 0;
try {
  if (set === "markets") { gen("scripts/markets.ts"); items += +(await upload("public/data/markets.json", "markets.json")) + +(await upload("public/data/returns.json", "returns.json")); }
  else if (set === "auctions") { gen("scripts/treasury-auctions.ts"); items += +(await upload("public/data/treasury-auctions.json", "treasury-auctions.json")); }
  else if (set === "hedge") { gen("scripts/hedge-funds.ts"); items += +(await upload("public/data/hedge-funds.json", "hedge-funds.json")); }
  else if (set === "context") {
    const { data: st } = await sb.from("job_state").select("cursor").eq("job", JOB).maybeSingle();
    const { tickers, next } = contextSlice(COVERAGE.map((c) => c.ticker), st?.cursor ?? 0);
    gen("scripts/company-context.ts", [`--only=${tickers.join(",")}`]);
    for (const t of tickers) items += +(await upload(`public/data/context/${t}.json`, `context/${t}.json`));
    await sb.from("job_state").upsert({ job: JOB, cursor: next, paused_reason: null, updated_at: now() });
  } else throw new Error("--set must be markets, auctions, hedge or context");
  if (set !== "context") await sb.from("job_state").upsert({ job: JOB, cursor: items, paused_reason: null, updated_at: now() });
  await sb.from("job_runs").insert({ job: JOB, started_at: now(), finished_at: now(), ok: true, items, detail: { set } });
  log(`${JOB}: published ${items} file(s)`);
  process.exit(0);
} catch (e) {
  const m = (e as Error).message;
  await sb.from("job_runs").insert({ job: JOB, started_at: now(), finished_at: now(), ok: false, items, detail: { set, error: m.slice(0, 300) } });
  log(`${JOB} failed: ${m}`);
  process.exit(1);
}
