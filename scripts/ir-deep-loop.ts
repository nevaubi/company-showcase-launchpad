/**
 * Nonstop deep IR build (owner, Nov 13: no spend cap, keep going; credits get refilled).
 * Each cycle:
 *   1. Background: every few hours resume the partner IR mirror (it stops cleanly on the partner's
 *      daily limit) and then register newly copied files (ir-import-partner.ts), so companies whose
 *      files weren't copied yet become readable.
 *   2. Next batch: companies this loop started whose run didn't reach its final report (stopped on
 *      credits or cut off) first (`--continue`), then companies with stored IR files and no IR
 *      figures, largest revenue first. A company that fails to finish three times is left for review.
 *   3. scripts/ir-deep.ts on the batch with no budget cap.
 *   4. When a run stops on credits (quota/auth) wait and try again — the first item of the next run
 *      is the probe; nothing is skipped or marked failed while credits are out.
 * Attempted companies are remembered in the private bucket (ops/ir-deep-loop.json).
 * Single flight: job_state `ir-deep-loop` lease.
 *   bun scripts/ir-deep-loop.ts [--batch=10] [--wait-minutes=10] [--mirror-hours=3] [--seed=CVS,MCK]
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { args, dbGate, sb } from "./lib/supa";

const BATCH = Number(args.batch ?? 10);
const WAIT_MS = Number(args["wait-minutes"] ?? 10) * 60_000;
const MIRROR_MS = Number(args["mirror-hours"] ?? 3) * 3_600_000;
const JOB = "ir-deep-loop";
const STATE = "ops/ir-deep-loop.json";
const OUT = "/tmp/ir-deep";
const log = (s: string) => console.log(`${new Date().toISOString().slice(0, 19).replace("T", " ")} [loop] ${s}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- single flight ----------
const { data: lease } = await sb.from("job_state").select("lease_until").eq("job", JOB).maybeSingle();
if (lease?.lease_until && new Date(lease.lease_until) > new Date() && args.force === undefined) {
  log(`another loop holds the lease until ${lease.lease_until}`);
  process.exit(0);
}
const renew = () => sb.from("job_state").upsert({ job: JOB, cursor: 0, paused_reason: null, lease_until: new Date(Date.now() + 15 * 60_000).toISOString(), updated_at: new Date().toISOString() });
await renew();
setInterval(() => void renew().then(undefined, () => undefined), 5 * 60_000);

// ---------- remembered state ----------
interface LoopState {
  attempted: string[];
  done: string[];
  lastMirror: string | null;
  /** times a company was resumed without finishing (credit outages don't count) */
  resumes?: Record<string, number>;
  /** unread files a company had when it finished; more than a few new ones later = revisit */
  unreadAtDone?: Record<string, number>;
}
async function loadState(): Promise<LoopState> {
  const { data } = await sb.storage.from("ir-documents").download(STATE);
  if (!data) return { attempted: [], done: [], lastMirror: null };
  try {
    return { attempted: [], done: [], lastMirror: null, ...(JSON.parse(await data.text()) as Partial<LoopState>) };
  } catch {
    return { attempted: [], done: [], lastMirror: null };
  }
}
async function saveState(s: LoopState) {
  await sb.storage.from("ir-documents").upload(STATE, new Blob([JSON.stringify(s)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
}
const state = await loadState();
for (const t of (args.seed ?? "").split(",").filter(Boolean)) if (!state.attempted.includes(t)) state.attempted.push(t);
await saveState(state);

// ---------- helpers ----------
function run(script: string, argv: string[], logFile: string) {
  return new Promise<number>((resolve) => {
    const p = spawn("sh", ["-c", `bun ${script} ${argv.map((a) => `'${a}'`).join(" ")} >> ${logFile} 2>&1`], { stdio: "ignore" });
    p.on("exit", (code) => resolve(code ?? 1));
  });
}
async function count(q: PromiseLike<{ count: number | null }>) {
  await dbGate(JOB);
  return (await q).count ?? 0;
}
const facts = (t: string) => count(sb.from("ir_kpi_facts").select("id", { count: "exact", head: true }).eq("ticker", t));
const files = (t: string) => count(sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", t).not("path", "is", null));
/** ir-deep.ts wrote its final report for the company (private storage copy, else this sandbox's). */
async function finished(t: string) {
  let r: { stage?: string } | null = null;
  const { data } = await sb.storage.from("ir-documents").download(`ops/ir-deep/${t}.json`);
  if (data) r = JSON.parse(await data.text()) as { stage?: string };
  else if (existsSync(`${OUT}/${t}.report.json`)) r = JSON.parse(readFileSync(`${OUT}/${t}.report.json`, "utf8")) as { stage?: string };
  // Reports from before stages were recorded only exist for companies whose run completed.
  return !!r && (r.stage === undefined || r.stage === "final");
}
const EXTRACTABLE = "(press-release,supplement,presentation,data,other)";
async function unread(t: string) {
  const [tables, slides, unconverted] = await Promise.all([
    count(sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", t).is("extract_status", null).is("extracted_at", null).or("ext.in.(htm,html),rendition_path.like.%html").filter("kind", "in", EXTRACTABLE).or("pages.is.null,pages.lte.90")),
    count(sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", t).is("vision_status", null).not("path", "is", null).or("and(kind.eq.image,bytes.gt.40000),and(kind.eq.presentation,ext.eq.pdf),and(ext.eq.pdf,kind.in.(press-release,supplement,other,data))")),
    count(sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", t).is("rendition_path", null).in("ext", ["pdf", "md", "xlsx", "xls", "xlsm", "csv"])),
  ]);
  return tables + slides + unconverted;
}
async function universe(): Promise<{ ticker: string; revenue: number }[]> {
  const { data } = await sb.storage.from("datasets").download("universe.json");
  const j = JSON.parse(await data!.text()) as { companies: { ticker: string; revenueTTM?: number; revenueFY?: number }[] };
  return j.companies.map((c) => ({ ticker: c.ticker, revenue: c.revenueTTM ?? c.revenueFY ?? 0 })).sort((a, b) => b.revenue - a.revenue);
}

// ---------- background mirror ----------
let mirroring = false;
/** New files may have been registered since finished companies were last checked. */
let importedSince = true;
async function maybeMirror() {
  if (mirroring) return;
  if (state.lastMirror && Date.now() - Date.parse(state.lastMirror) < MIRROR_MS) return;
  mirroring = true;
  state.lastMirror = new Date().toISOString();
  await saveState(state);
  log("resuming the partner IR mirror in the background");
  void (async () => {
    try {
      await run("scripts/partner-mirror-ir.ts", [], `${OUT}/mirror.log`);
      log("mirror run ended — registering newly copied files");
      await run("scripts/ir-import-partner.ts", [], `${OUT}/import.log`);
      log("import ended");
      importedSince = true;
    } finally {
      mirroring = false;
    }
  })();
}

// ---------- main loop ----------
/** A deep build started by hand (or a previous loop) shares the readers' leases: wait for it. */
function deepRunning() {
  try {
    return execSync("pgrep -f '^bun scripts/ir-deep.ts'").toString().trim().length > 0;
  } catch {
    return false;
  }
}
while (deepRunning()) {
  log("a deep build is already running — waiting for it to finish");
  await sleep(5 * 60_000);
}

let creditStop = false;
for (let cycle = 1; ; cycle++) {
  await maybeMirror();
  // 1. Companies this loop started whose run never reached its final report.
  const resume: string[] = [];
  state.resumes ??= {};
  for (const t of state.attempted) {
    if (state.done.includes(t)) continue;
    if (await finished(t)) {
      const n = await unread(t);
      if (n) log(`${t}: finished with ${n} files no reader could take — left for review`);
      state.done.push(t);
      (state.unreadAtDone ??= {})[t] = n;
      continue;
    }
    if (!creditStop) state.resumes[t] = (state.resumes[t] ?? 0) + 1;
    if (state.resumes[t] > 3) {
      log(`${t}: didn't finish after 3 resumes — left for review`);
      state.done.push(t);
    } else resume.push(t);
  }
  // 1b. Finished companies that gained new files since (the mirror copies more each day): read those.
  if (importedSince && resume.length < BATCH) {
    importedSince = false;
    state.unreadAtDone ??= {};
    for (const t of state.done) {
      if (resume.length >= BATCH) break;
      const n = await unread(t);
      if (n >= (state.unreadAtDone[t] ?? 0) + 5) {
        log(`${t}: ${n} unread files since it finished — reading the new ones`);
        state.done = state.done.filter((x) => x !== t);
        state.unreadAtDone[t] = n;
        resume.push(t);
      }
    }
  }
  // 2. New companies: stored files, no figures, largest first. Companies with a handful of files
  //    wait (the mirror is still copying theirs) unless nothing bigger is left.
  const fresh: string[] = [];
  for (const minFiles of [10, 1]) {
    if (fresh.length + resume.length >= BATCH) break;
    for (const c of await universe()) {
      if (fresh.length + resume.length >= BATCH) break;
      if (state.attempted.includes(c.ticker) || fresh.includes(c.ticker)) continue;
      if ((await files(c.ticker)) < minFiles) continue;
      if ((await facts(c.ticker)) > 0) continue;
      fresh.push(c.ticker);
    }
  }
  const batch = [...resume.slice(0, BATCH), ...fresh];
  await saveState(state);
  if (!batch.length) {
    log(`cycle ${cycle}: nothing readable left — waiting for the mirror to bring more files`);
    await sleep(60 * 60_000);
    continue;
  }
  for (const t of fresh) state.attempted.push(t);
  await saveState(state);
  log(`cycle ${cycle}: ${batch.join(", ")}${resume.length ? ` (continuing ${resume.slice(0, BATCH).join(", ")})` : ""}`);
  const lastRun = `${OUT}/last-run.json`;
  const before = existsSync(lastRun) ? readFileSync(lastRun, "utf8") : "";
  const code = await run("scripts/ir-deep.ts", [`--tickers=${batch.join(",")}`, `--continue=${state.attempted.join(",")}`, "--reset-ledger"], `${OUT}/run.log`);
  const after = existsSync(lastRun) ? readFileSync(lastRun, "utf8") : "";
  let stopped: string | null = code === 0 ? null : `exit ${code}`;
  if (after && after !== before) stopped = (JSON.parse(after) as { stopped: string | null }).stopped ?? stopped;
  creditStop = !!stopped && /quota|auth|credit|payment|402/i.test(stopped);
  if (creditStop) {
    log(`cycle ${cycle}: stopped on credits (${stopped.slice(0, 160)}) — waiting ${WAIT_MS / 60000} min, then probing again`);
    await sleep(WAIT_MS);
  } else if (stopped) {
    log(`cycle ${cycle}: run stopped (${stopped.slice(0, 160)}) — retrying after a short wait`);
    await sleep(2 * 60_000);
  } else log(`cycle ${cycle}: finished ${batch.join(", ")}`);
}
