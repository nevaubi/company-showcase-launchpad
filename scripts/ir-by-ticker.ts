/**
 * One-company-at-a-time IR backfill: for each company, read all its waiting files (Sol/OpenAI)
 * and slides (Sonnet/Anthropic), retry failures once, rebuild its series, then move on.
 *   bun scripts/ir-by-ticker.ts [--start=GOOGL] [--concurrency=32] [--vision-concurrency=24]
 *
 * Companies go in ascending remaining-work order. If either runner stops on an auth/quota
 * error, the loop stops cleanly on the current company; rerun with --start=<that ticker>.
 * Lives in the repo (not /tmp) so it survives sandbox resets.
 */
import { spawn } from "node:child_process";
import { COVERAGE } from "@/lib/coverage";
import { args, log, sb } from "./lib/supa";

const EXTRACT_CONC = Number(args.concurrency ?? 32);
const VISION_CONC = Number(args["vision-concurrency"] ?? 24);

/** Run one script to completion; resolves with its exit code, streaming output to our stdout. */
function run(cmd: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd[0], cmd.slice(1), { stdio: ["ignore", "inherit", "inherit"], env: process.env });
    p.on("close", (code) => resolve(code ?? 1));
  });
}

/** Remaining work per ticker: unclaimed files + unclaimed slides. */
async function remaining(): Promise<Map<string, number>> {
  const { data, error } = await sb.from("ir_documents").select("ticker, kind, extract_status, vision_status");
  if (error) throw new Error(error.message);
  const left = new Map<string, number>();
  for (const d of data ?? []) {
    const waiting = d.kind === "image" ? !d.vision_status : !d.extract_status;
    if (waiting) left.set(d.ticker, (left.get(d.ticker) ?? 0) + 1);
  }
  return left;
}

/** True when a runner paused on auth/quota — continuing would just burn time. */
async function paused(job: string): Promise<string | null> {
  const { data } = await sb.from("job_state").select("paused_reason").eq("job", job).maybeSingle();
  const r = data?.paused_reason ?? "";
  return /auth|quota|credit|billing/i.test(r) ? r : null;
}

/** Requeue one company's failed items so they get a second pass. */
async function requeueFailures(ticker: string) {
  await sb.from("ir_documents").update({ extract_status: null }).eq("ticker", ticker).like("extract_status", "error:%");
  await sb.from("ir_documents").update({ vision_status: null }).eq("ticker", ticker).like("vision_status", "error:%");
}

const startAfter = args.start;
const left0 = await remaining();
const queue = COVERAGE.map((c) => c.ticker)
  .filter((t) => (left0.get(t) ?? 0) > 0)
  .sort((a, b) => (left0.get(a) ?? 0) - (left0.get(b) ?? 0));
const startIdx = startAfter ? Math.max(0, queue.indexOf(startAfter)) : 0;
log(`by-ticker: ${queue.length} companies with work left; starting at ${queue[startIdx]} (${startIdx + 1}/${queue.length})`);

for (let i = startIdx; i < queue.length; i++) {
  const t = queue[i];
  log(`=== ${t} (${i + 1}/${queue.length}, ${left0.get(t)} waiting) ===`);
  const extract = ["bun", "scripts/ir-extract.ts", `--ticker=${t}`, `--concurrency=${EXTRACT_CONC}`, "--chunk-concurrency=8", "--max=100000", "--resume", "--force"];
  const vision = ["bun", "scripts/ir-vision.ts", `--ticker=${t}`, `--concurrency=${VISION_CONC}`, "--max=100000", "--max-usd=750", "--resume", "--force"];
  let [exCode] = await Promise.all([run(extract), run(vision)]);

  // Second pass over anything that failed, then rebuild.
  await requeueFailures(t);
  const leftNow = (await remaining()).get(t) ?? 0;
  if (leftNow > 0) {
    log(`${t}: ${leftNow} items failed once — retrying`);
    [exCode] = await Promise.all([run(extract), run(vision)]);
  }

  const stop = (await paused("ir-extract-runner")) ?? (await paused("ir-vision-runner"));
  if (stop) {
    log(`by-ticker STOPPED on ${t} — ${stop}. Add credits and rerun with --start=${t}`);
    process.exit(1);
  }

  await run(["bun", "scripts/ir-build.ts", `--tickers=${t}`]);
  log(`=== ${t} done (${(await remaining()).get(t) ?? 0} left) ===`);
}
log("by-ticker: all companies finished");
process.exit(0);
