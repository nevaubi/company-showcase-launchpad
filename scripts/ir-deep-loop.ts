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
 *   bun scripts/ir-deep-loop.ts [--batch=10] [--wait-minutes=10] [--mirror-hours=3] [--detail-hours=12] [--seed=CVS,MCK]
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { args, dbGate, sb } from "./lib/supa";
import { REREAD_WINDOW_DAYS, rereadTickers } from "./lib/ir-requeue";

const BATCH_ARG = args.batch === undefined ? null : Number(args.batch);
const WAIT_MS = Number(args["wait-minutes"] ?? 10) * 60_000;
const MIRROR_MS = Number(args["mirror-hours"] ?? 3) * 3_600_000;
/** Filing detail (10-K/10-Q breakdowns) re-check: only companies with a new filing are re-read. */
const DETAIL_MS = Number(args["detail-hours"] ?? 12) * 3_600_000;
const JOB = "ir-deep-loop";
const STATE = "ops/ir-deep-loop.json";
const OUT = process.env.IR_WORK_DIR ?? "/tmp/ir-deep";
// Child runs append their logs here; a missing folder made every run exit 1 before starting.
mkdirSync(OUT, { recursive: true });
/** Recent loop lines, saved with the state so the admin progress view can show them. */
const recent: string[] = [];
const log = (s: string) => {
  const line = `${new Date().toISOString().slice(0, 19).replace("T", " ")} [loop] ${s}`;
  console.log(line);
  recent.push(line);
  if (recent.length > 60) recent.shift();
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- single flight ----------
// Each start has its own id. The lease is short (3 min, renewed every minute); a lease left by a
// run that died (out-of-memory kill, redeploy) lapses within minutes instead of idling 15.
// A lease owned by this same host's previous run is taken over immediately: one container = one loop.
const INSTANCE = `${process.env.RENDER_INSTANCE_ID ?? process.env.HOSTNAME ?? "local"}:${process.pid}:${Date.now()}`;
const HOST = INSTANCE.split(":")[0];
const LEASE_MS = 3 * 60_000;
for (;;) {
  const { data: lease } = await sb.from("job_state").select("lease_until, paused_reason").eq("job", JOB).maybeSingle();
  const owner = lease?.paused_reason?.startsWith("owner:") ? lease.paused_reason.slice(6) : "";
  if (!lease?.lease_until || new Date(lease.lease_until) <= new Date() || args.force !== undefined || (owner && owner.split(":")[0] === HOST)) break;
  if (args["wait-lease"] === undefined && !process.env.IR_WAIT_LEASE) {
    log(`another loop holds the lease until ${lease.lease_until}`);
    process.exit(0);
  }
  log(`another live loop (${owner || "unknown"}) holds the lease until ${lease.lease_until} — waiting`);
  await sleep(30_000);
}
const renew = () => sb.from("job_state").upsert({ job: JOB, cursor: 0, paused_reason: `owner:${INSTANCE}`, lease_until: new Date(Date.now() + LEASE_MS).toISOString(), updated_at: new Date().toISOString() });
await renew();
for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.on(sig, () => {
    void sb.from("job_state").update({ lease_until: new Date().toISOString() }).eq("job", JOB).then(() => process.exit(0), () => process.exit(0));
  });
setInterval(() => void renew().then(undefined, () => undefined), 60_000);
const STARTED = Date.now();

// ---------- memory-aware sizing ----------
function memLimitGB() {
  for (const f of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const v = readFileSync(f, "utf8").trim();
      if (v && v !== "max" && Number(v) < 1e15) return Number(v) / 2 ** 30;
    } catch {
      /* not a cgroup host */
    }
  }
  return 8;
}
function memUsedGB() {
  for (const f of ["/sys/fs/cgroup/memory.current", "/sys/fs/cgroup/memory/memory.usage_in_bytes"]) {
    try {
      return Number(readFileSync(f, "utf8").trim()) / 2 ** 30;
    } catch {
      /* ignore */
    }
  }
  return 0;
}
const MEM_GB = memLimitGB();
/** Parallel companies and per-company reader settings scale with the real memory limit. */
const LANES = Number(process.env.IR_LANES ?? Math.max(1, Math.min(3, Math.floor(MEM_GB / 10))));
const lanePerGB = MEM_GB / LANES;
const childEnv = {
  ...process.env,
  IR_DOCLING_WORKERS: process.env.IR_DOCLING_WORKERS_FIXED ?? String(Math.max(1, Math.min(4, Math.floor(lanePerGB / 3)))),
  IR_DOCLING_THREADS: process.env.IR_DOCLING_THREADS_FIXED ?? "2",
  IR_EXTRACT_CONCURRENCY: process.env.IR_EXTRACT_CONCURRENCY_FIXED ?? String(Math.max(4, Math.min(20, Math.floor(lanePerGB * 2)))),
  IR_VISION_CONCURRENCY: process.env.IR_VISION_CONCURRENCY_FIXED ?? String(Math.max(2, Math.min(8, Math.floor(lanePerGB)))),
  NODE_OPTIONS: `--max-old-space-size=${Math.max(1024, Math.min(6144, Math.floor(lanePerGB * 1024 * 0.35)))}`,
};
log(`instance ${INSTANCE}: memory limit ${MEM_GB.toFixed(1)} GB → ${LANES} parallel companies, docling ${childEnv.IR_DOCLING_WORKERS}, readers ${childEnv.IR_EXTRACT_CONCURRENCY}, vision ${childEnv.IR_VISION_CONCURRENCY}`);

// ---------- remembered state ----------
interface LoopState {
  attempted: string[];
  done: string[];
  lastMirror: string | null;
  lastDetail?: string | null;
  lastSod?: string | null;
  lastReactions?: string | null;
  lastProse?: string | null;
  lastIrSite?: string | null;
  lastCanon?: string | null;
  lastAltSlow?: string | null;
  lastVerify?: string | null;
  /** times a company was resumed without finishing (credit outages don't count) */
  resumes?: Record<string, number>;
  /** unread files a company had when it finished; more than a few new ones later = revisit */
  unreadAtDone?: Record<string, number>;
  /** companies re-queued once because they were marked done with no figures (broken-worker runs) */
  healed?: string[];
  /** finished companies re-queued once because files were still waiting */
  rechecked?: string[];
  /** live view for the admin panel */
  current?: string[];
  cycleStartedAt?: string | null;
  cycle?: number;
  heartbeat?: string;
  log?: string[];
  /** companies set aside with a reason; never re-queued except when new files arrive */
  review?: Record<string, string>;
  /** per-company stage while running */
  stage?: Record<string, string>;
  memLimitGB?: number;
  memUsedGB?: number;
  instance?: string;
  startedAt?: string;
  finishedLog?: { t: string; at: string }[];
  /** high-water mark of ir_documents.fetched_at already checked for finished-company re-reads */
  docsCheckedThrough?: string;
  /** one-time reset of attempt counts inflated by out-of-memory restarts */
  oomReset?: boolean;
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
  s.heartbeat = new Date().toISOString();
  s.memLimitGB = +MEM_GB.toFixed(2);
  s.memUsedGB = +memUsedGB().toFixed(2);
  s.instance = INSTANCE;
  s.startedAt = new Date(STARTED).toISOString();
  s.log = recent.slice();
  await sb.storage.from("ir-documents").upload(STATE, new Blob([JSON.stringify(s)], { type: "application/json" }), { upsert: true, contentType: "application/json" });
}
const state = await loadState();
for (const t of (args.seed ?? "").split(",").filter(Boolean)) if (!state.attempted.includes(t)) state.attempted.push(t);
await saveState(state);

// ---------- helpers ----------
function run(script: string, argv: string[], logFile: string, env: NodeJS.ProcessEnv = process.env) {
  return new Promise<number>((resolve) => {
    const p = spawn("sh", ["-c", `bun ${script} ${argv.map((a) => `'${a}'`).join(" ")} >> ${logFile} 2>&1`], { stdio: "ignore", env });
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
async function reportStage(t: string): Promise<string | null> {
  let r: { stage?: string } | null = null;
  const { data } = await sb.storage.from("ir-documents").download(`ops/ir-deep/${t}.json`);
  if (data) r = JSON.parse(await data.text()) as { stage?: string };
  else if (existsSync(`${OUT}/${t}/${t}.report.json`)) r = JSON.parse(readFileSync(`${OUT}/${t}/${t}.report.json`, "utf8")) as { stage?: string };
  // Reports from before stages were recorded only exist for companies whose run completed.
  return r ? (r.stage ?? "final") : null;
}
async function finished(t: string) {
  return (await reportStage(t)) === "final";
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
/** Side jobs share this machine's memory: hold them until the main loop has run stably for a while. */
const sideReady = () => Date.now() - STARTED > 20 * 60_000 && memUsedGB() < MEM_GB * 0.6;
let sideBusy = () => mirroring || detailing || sodChecking || reacting || irSiting || canoning || altSlowing;
async function maybeMirror() {
  if (mirroring || !sideReady() || sideBusy()) return;
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

// ---------- background IR-website collection ----------
/** Every 2 hours: IR-site files for recent reporters first, under a 300-credit daily Firecrawl cap. */
let irSiting = false;
async function maybeIrSite() {
  if (irSiting || !sideReady() || sideBusy()) return;
  if (state.lastIrSite && Date.now() - Date.parse(state.lastIrSite) < 2 * 3_600_000) return;
  irSiting = true;
  state.lastIrSite = new Date().toISOString();
  await saveState(state);
  log("collecting IR-website files in the background");
  void run("scripts/ir-site-daily.ts", [], `${OUT}/ir-site.log`).finally(() => {
    irSiting = false;
    importedSince = true;
    log("IR-website collection ended");
  });
}

// ---------- daily label canon ----------
/** Once a day: cross-document label canon for the next 40 companies with figures (resumes from its cursor). */
let canoning = false;
async function maybeCanon() {
  if (canoning || !sideReady() || sideBusy()) return;
  if (state.lastCanon && Date.now() - Date.parse(state.lastCanon) < 24 * 3_600_000) return;
  canoning = true;
  state.lastCanon = new Date().toISOString();
  await saveState(state);
  log("daily label canon pass in the background");
  void run("scripts/ir-canon.ts", ["--resume", "--max=40", "--concurrency=2"], `${OUT}/canon.log`).finally(() => {
    canoning = false;
    log("label canon pass ended");
  });
}

// ---------- scheduled standard reports ----------
/** Every 10 minutes: one due recap/preview (reports-due.ts pauses itself on AI credit outages). */
let reporting = false;
let lastReports = 0;
function maybeReports() {
  if (reporting || Date.now() - lastReports < 10 * 60_000 || memUsedGB() > MEM_GB * 0.8) return;
  reporting = true;
  lastReports = Date.now();
  void run("scripts/reports-due.ts", [], `${OUT}/reports.log`).finally(() => { reporting = false; });
}

// ---------- new-filing steps (redlines, supply links, weekly supply intel) ----------
/** Every 30 minutes: filings discovered since the last run (filing-steps.ts keeps its own cursor and retry receipts). */
let filingStepping = false;
let lastFilingSteps = 0;
function maybeFilingSteps() {
  if (filingStepping || Date.now() - lastFilingSteps < 30 * 60_000 || memUsedGB() > MEM_GB * 0.8) return;
  filingStepping = true;
  lastFilingSteps = Date.now();
  void run("scripts/filing-steps.ts", [], `${OUT}/filing-steps.log`).finally(() => { filingStepping = false; });
}

// ---------- analytics files (analytics-publish.ts → datasets/analytics/) ----------
/** markets+returns daily after the nightly setups cycle finishes, auctions daily, hedge funds weekly, company context 20/day. */
let publishing = false;
const lastPublish: Record<string, number> = {};
async function setupsFinishedAt(): Promise<number> {
  const { data } = await sb.from("setup_cycles").select("finished_at").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle();
  return data?.finished_at ? Date.parse(data.finished_at) : 0;
}
async function maybeAnalytics() {
  if (publishing || memUsedGB() > MEM_GB * 0.7) return;
  const due = async (set: string, everyMs: number) => {
    if (!lastPublish[set]) {
      const { data } = await sb.from("job_state").select("updated_at").eq("job", `analytics-${set}`).maybeSingle();
      lastPublish[set] = data ? Date.parse(data.updated_at) : 0;
    }
    return Date.now() - lastPublish[set] >= everyMs;
  };
  let set: string | null = null;
  if ((await setupsFinishedAt()) > (lastPublish.markets ?? 0) && (await due("markets", 20 * 3_600_000))) set = "markets";
  else if (await due("auctions", 24 * 3_600_000)) set = "auctions";
  else if (await due("hedge", 7 * 86_400_000)) set = "hedge";
  else if (await due("context", 24 * 3_600_000)) set = "context";
  if (!set) return;
  publishing = true;
  lastPublish[set] = Date.now();
  log(`publishing analytics: ${set}`);
  void run("scripts/analytics-publish.ts", [`--set=${set}`], `${OUT}/analytics.log`).finally(() => { publishing = false; });
}

// ---------- slow alt data (daily: registry upkeep, 1/7 of ownership/contracts/recalls, monthly Medicare) ----------
let altSlowing = false;
async function maybeAltSlow() {
  if (altSlowing || !sideReady() || sideBusy()) return;
  if (state.lastAltSlow && Date.now() - Date.parse(state.lastAltSlow) < 24 * 3_600_000) return;
  altSlowing = true;
  state.lastAltSlow = new Date().toISOString();
  await saveState(state);
  log("slow alt-data pass in the background");
  void run("scripts/alt-slow.ts", [], `${OUT}/alt-slow.log`).finally(() => { altSlowing = false; log("slow alt-data pass ended"); });
}

// ---------- background filing detail ----------
let detailing = false;
async function maybeDetail() {
  if (detailing || !sideReady() || sideBusy()) return;
  if (state.lastDetail && Date.now() - Date.parse(state.lastDetail) < DETAIL_MS) return;
  detailing = true;
  state.lastDetail = new Date().toISOString();
  await saveState(state);
  log("checking for new 10-K/10-Q filing detail in the background");
  void run("scripts/xbrl-detail.ts", [], `${OUT}/detail.log`).finally(() => {
    detailing = false;
    log("filing detail check ended");
  });
}

// ---------- background FDIC branch survey ----------
/** The FDIC publishes each June 30 Summary of Deposits once a year (autumn); check weekly, import only when a new year is out. */
let sodChecking = false;
async function maybeSod() {
  if (sodChecking || !sideReady() || sideBusy()) return;
  if (state.lastSod && Date.now() - Date.parse(state.lastSod) < 7 * 86_400_000) return;
  sodChecking = true;
  state.lastSod = new Date().toISOString();
  await saveState(state);
  // CMS publishes Part D drug costs by prescriber state yearly (spring); same weekly check
  void run("scripts/gov-data.ts", ["--sod", "--if-new"], `${OUT}/sod.log`)
    .then(() => run("scripts/gov-data.ts", ["--medicare-states", "--if-new"], `${OUT}/medicare-states.log`))
    .then(() => run("scripts/gov-data.ts", ["--tri", "--if-new"], `${OUT}/tri.log`))
    .finally(() => {
      sodChecking = false;
    });
}

// ---------- background earnings reactions ----------
/** Past report reactions for the Options page's priced-vs-past comparison; daily, since new reports land every day in season. */
let reacting = false;
async function maybeReactions() {
  if (reacting || !sideReady() || sideBusy()) return;
  if (state.lastReactions && Date.now() - Date.parse(state.lastReactions) < 86_400_000) return;
  reacting = true;
  state.lastReactions = new Date().toISOString();
  await saveState(state);
  void run("scripts/earnings-reactions.ts", [], `${OUT}/reactions.log`).finally(() => {
    reacting = false;
  });
}

// ---------- background text reading ----------
/**
 * Companies finished before the text reader existed: read the figures stated in their releases'
 * running text, newest releases first across all companies (the reader rebuilds companies that gain
 * figures). Network-bound and light on memory, so it runs beside the other side jobs.
 */
let prosing = false;
async function maybeProse() {
  if (prosing || !sideReady() || process.env.IR_PROSE_SWEEP === "0") return;
  if (state.lastProse && Date.now() - Date.parse(state.lastProse) < 10 * 60_000) return;
  prosing = true;
  state.lastProse = new Date().toISOString();
  await saveState(state);
  void run("scripts/ir-prose.ts", ["--resume", `--concurrency=${process.env.IR_PROSE_SWEEP_CONCURRENCY ?? "8"}`, "--max=1500"], `${OUT}/prose.log`).finally(() => {
    prosing = false;
  });
}

/**
 * Every 30 minutes, hold text figures stored before the OpenAI second reader existed to its
 * cross-check (scripts/ir-prose-verify.ts) — free daily allowance only; it exits by itself when
 * new reads need what is left of the day, or there is no key.
 */
let verifying = false;
async function verifySweep() {
  if (verifying || !sideReady() || !process.env.OPENAI_API_KEY || process.env.IR_PROSE_VERIFY === "0") return;
  if (state.lastVerify && Date.now() - Date.parse(state.lastVerify) < 30 * 60_000) return;
  verifying = true;
  state.lastVerify = new Date().toISOString();
  await saveState(state);
  void run("scripts/ir-prose-verify.ts", ["--resume", "--concurrency=6", "--max=400"], `${OUT}/prose-verify.log`).finally(() => {
    verifying = false;
  });
}

// ---------- main loop ----------
/** A deep build started by hand (or a previous loop) shares the readers' leases: wait for it. */
function deepRunning() {
  try {
    return execSync("ps -eo args").toString().split("\n").some((l) => l.startsWith("bun scripts/ir-deep.ts"));
  } catch {
    return false;
  }
}
while (deepRunning()) {
  log("a deep build is already running — waiting for it to finish");
  await sleep(5 * 60_000);
}

let creditStop = false;
state.review ??= {};
state.resumes ??= {};
state.stage = {};
if (!state.oomReset) {
  // Attempts counted while the machine was being out-of-memory killed say nothing about the company.
  for (const t of Object.keys(state.resumes)) state.resumes[t] = 0;
  state.done = state.done.filter((t) => !state.attempted.includes(t) || state.unreadAtDone?.[t] !== undefined);
  state.oomReset = true;
  log("reset attempt counts inflated by out-of-memory restarts");
}
// The previous container died mid-company (no clean exit): those companies resume without penalty.
const interrupted = new Set(state.current ?? []);
state.current = [];
// Companies counted finished while files were still waiting (a reader was blocked by a replaced
// machine's hold) are read again once.
state.rechecked ??= [];
for (const t of [...state.done]) {
  if ((state.unreadAtDone?.[t] ?? 0) < 5 || state.rechecked.includes(t)) continue;
  state.done = state.done.filter((x) => x !== t);
  state.rechecked.push(t);
  interrupted.add(t);
  log(`${t}: finished with ${state.unreadAtDone![t]} files still waiting — reading them`);
}
await saveState(state);

let lastDocCheck = 0;
const pendingReread: string[] = [];
/** Next company: interrupted ones first, then started-but-unfinished, then new (largest revenue), then finished with new files. */
async function pickNext(busy: Set<string>): Promise<string | null> {
  const free = (t: string) => !busy.has(t) && !state.review![t];
  for (const t of interrupted) if (free(t) && !state.done.includes(t)) return (interrupted.delete(t), t);
  for (const t of state.attempted) {
    if (!free(t) || state.done.includes(t)) continue;
    if (await finished(t)) {
      state.done.push(t);
      (state.unreadAtDone ??= {})[t] = await unread(t);
      continue;
    }
    if ((state.resumes![t] ?? 0) >= 3) {
      state.review![t] = "failed 3 runs with company-specific errors";
      log(`${t}: failed 3 runs — set aside for review`);
      continue;
    }
    return t;
  }
  // Finished companies with a newly filed file come before untouched ones, so fresh releases are read promptly.
  // Any new readable file filed in the last 30 days (from any source, not only the mirror import)
  // re-queues its finished company: one is enough.
  if (Date.now() - lastDocCheck > 60_000) {
    lastDocCheck = Date.now();
    const since = state.docsCheckedThrough ?? new Date(Date.now() - 86400000).toISOString();
    await dbGate(JOB);
    const { data, error } = await sb.from("ir_documents").select("ticker, fetched_at, filed, kind").gt("fetched_at", since).gte("filed", new Date(Date.now() - REREAD_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)).order("fetched_at").limit(1000);
    if (!error) {
      const r = rereadTickers(state.done, data ?? [], since);
      state.docsCheckedThrough = r.last;
      for (const t of r.tickers) if (!pendingReread.includes(t)) pendingReread.push(t);
    }
  }
  for (const t of [...pendingReread]) {
    if (busy.has(t)) continue;
    pendingReread.splice(pendingReread.indexOf(t), 1);
    if (!state.done.includes(t)) continue;
    log(`${t}: new file since it finished — reading the new ones`);
    state.done = state.done.filter((x) => x !== t);
    delete state.review![t];
    (state.unreadAtDone ??= {})[t] = await unread(t);
    return t;
  }
  for (const minFiles of [10, 1])
    for (const c of await universe()) {
      if (state.attempted.includes(c.ticker) || !free(c.ticker)) continue;
      if ((await files(c.ticker)) < minFiles) continue;
      if ((await facts(c.ticker)) > 0) continue;
      state.attempted.push(c.ticker);
      return c.ticker;
    }
  importedSince = false;
  return null;
}

async function runCompany(t: string) {
  const t0 = Date.now();
  state.stage![t] = "running";
  log(`${t}: starting`);
  const lastRun = `${OUT}/${t}/last-run.json`;
  rmSync(lastRun, { force: true });
  const code = await run("scripts/ir-deep.ts", [`--tickers=${t}`, `--continue=${t}`, `--out=${OUT}/${t}`, "--reset-ledger"], `${OUT}/${t}.run.log`, childEnv);
  let stopped: string | null = code === 0 ? null : `exit ${code}`;
  if (existsSync(lastRun)) stopped = (JSON.parse(readFileSync(lastRun, "utf8")) as { stopped: string | null }).stopped ?? stopped;
  delete state.stage![t];
  if (stopped && /quota|auth|credit|payment|402/i.test(stopped)) {
    creditStop = true;
    log(`${t}: stopped on credits (${stopped.slice(0, 160)})`);
    return;
  }
  if (await finished(t)) {
    state.done.push(t);
    (state.unreadAtDone ??= {})[t] = await unread(t);
    (state.finishedLog ??= []).push({ t, at: new Date().toISOString() });
    if (state.finishedLog.length > 200) state.finishedLog.shift();
    log(`${t}: finished in ${((Date.now() - t0) / 60000).toFixed(1)} min — ${(await facts(t)).toLocaleString()} figures`);
  } else {
    // Exit 137 = killed for memory, "incomplete" = a reader couldn't start (busy elsewhere): the
    // machine's fault, not the company's, so neither counts toward setting the company aside.
    if (code !== 137 && (await reportStage(t)) !== "incomplete") state.resumes![t] = (state.resumes![t] ?? 0) + 1;
    log(`${t}: run ended without finishing (${stopped ?? "no final report"}) — attempt ${state.resumes![t] ?? 0}`);
  }
}

// ---------- lanes ----------
const busy = new Set<string>();
let idleLogged = false;
for (;;) {
  await maybeMirror();
  await maybeDetail();
  await maybeIrSite();
  maybeReports();
  maybeFilingSteps();
  await maybeAnalytics().catch((e) => log(`analytics check failed: ${(e as Error).message}`));
  await maybeCanon();
  await maybeAltSlow();
  await maybeSod();
  await maybeReactions();
  await maybeProse();
  await verifySweep();
  // self-heal: done with files but no figures, once (never for companies set aside)
  state.healed ??= [];
  for (const t of [...state.done]) {
    if (state.healed.includes(t) || state.review[t]) continue;
    if ((await facts(t)) > 0 || (await files(t)) === 0) continue;
    state.done = state.done.filter((x) => x !== t);
    state.resumes[t] = 0;
    state.healed.push(t);
    log(`${t}: marked done with no figures — queued again`);
  }
  const lanes = BATCH_ARG ?? LANES;
  const memOk = memUsedGB() < MEM_GB * 0.8;
  while (!creditStop && memOk && busy.size < lanes) {
    const t = await pickNext(busy);
    if (!t) break;
    idleLogged = false;
    busy.add(t);
    state.current = [...busy];
    await saveState(state);
    void runCompany(t).finally(() => {
      busy.delete(t);
      state.current = [...busy];
      void saveState(state);
    });
  }
  if (!busy.size && !creditStop && !idleLogged) {
    log("nothing readable left — waiting for the mirror to bring more files");
    idleLogged = true;
  }
  await saveState(state);
  if (creditStop && !busy.size) {
    log(`waiting ${WAIT_MS / 60000} min for credits, then probing again`);
    await sleep(WAIT_MS);
    creditStop = false;
  } else await sleep(busy.size ? 30_000 : 10 * 60_000);
}
