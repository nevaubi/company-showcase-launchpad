// Worker step (daily): registry upkeep for newly covered companies, then the slow alt-data sets
// (ownership, contracts, recalls) for one seventh of the covered list, and the CMS Medicare spending
// files once a month. Upserts only (alt-data.ts never deletes stored rows).
//   bun scripts/alt-slow.ts
import { spawnSync } from "node:child_process";
import { log, sb } from "./lib/supa";
import { COVERAGE } from "@/lib/coverage";
import { MEDICARE_EVERY_MS, missingFromRegistry, SLOW_SETS, weekSlice } from "./lib/alt-slow";

const now = () => new Date().toISOString();
const run = (file: string, argv: string[]) => spawnSync("bun", [file, ...argv], { stdio: "inherit", timeout: 3 * 3_600_000 }).status === 0;
const tickers = COVERAGE.map((c) => c.ticker);
const detail: Record<string, unknown> = {};

// 1. Registry upkeep: any covered company missing from the registry is resolved before collection.
const { data: blob } = await sb.storage.from("datasets").download("alt/registry.json");
const registry = blob ? (JSON.parse(await blob.text()) as Record<string, unknown>) : {};
const missing = missingFromRegistry(tickers, registry);
detail.registryMissing = missing.length;
if (missing.length) detail.registry = run("scripts/alt-registry.ts", [`--only=${missing.join(",")}`]) ? "updated" : "failed";

// 2. Slow sets, one seventh of the list today (newly covered companies join today's slice too).
const slice = [...new Set([...weekSlice(tickers), ...missing])];
detail.slowCompanies = slice.length;
detail.slow = run("scripts/alt-data.ts", [`--only=${slice.join(",")}`, `--sets=${SLOW_SETS}`, "--concurrency=4"]) ? "ok" : "failed";

// 3. Monthly Medicare spending (Part D + Part B).
const { data: med } = await sb.from("job_state").select("updated_at").eq("job", "gov-medicare").maybeSingle();
if (!med || Date.now() - Date.parse(med.updated_at) > MEDICARE_EVERY_MS) {
  const ok = run("scripts/gov-data.ts", ["--medicare"]);
  detail.medicare = ok ? "ok" : "failed";
  if (ok) await sb.from("job_state").upsert({ job: "gov-medicare", cursor: 0, paused_reason: null, updated_at: now() });
}

const ok = detail.slow === "ok" && detail.registry !== "failed" && detail.medicare !== "failed";
await sb.from("job_state").upsert({ job: "alt-slow", cursor: slice.length, paused_reason: ok ? null : "a step failed; retried tomorrow", updated_at: now() });
await sb.from("job_runs").insert({ job: "alt-slow", started_at: now(), finished_at: now(), ok, items: slice.length, detail });
log(`alt-slow: ${JSON.stringify(detail)}`);
process.exit(0);
