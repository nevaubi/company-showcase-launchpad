/**
 * Deep IR build for chosen companies, one company at a time, end to end:
 *   skip companies that already have IR figures → filing dates (ir-docling.ts --phase=dates) → read
 *   tables (ir-extract.ts) → read slides and scanned pages (ir-vision.ts) → retry failed files once
 *   → rebuild the company's series → per-company report. Docling/OCR conversion of PDFs, Markdown and
 *   spreadsheets runs in the background meanwhile; converted files are read in a final pass.
 * Table reading of company N+1 overlaps with slide reading of company N (separate leases).
 * Spend: each reader reports estimated gateway credits in a spend file; the running total lives in
 * job_state `ir-deep-ledger` (cursor = millicredits), and every reader is capped at what is left.
 *   bun scripts/ir-deep.ts --tickers=CVS,MCK --budget=200 [--model=google/gemini-3.1-flash-lite]
 *     [--escalate=openai/gpt-6-luna] [--chunk=16000] [--skip-prepare] [--include-existing] [--continue=CVS] [--reset-ledger]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rebuildCompany } from "@/lib/ir/rebuild.server";
import { args, dbGate, sb } from "./lib/supa";

const TICKERS = (args.tickers ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
if (!TICKERS.length) throw new Error("--tickers=CVS,MCK required");
const BUDGET = Number(args.budget ?? 0);
if (!(BUDGET > 0)) throw new Error("--budget=<credits> required");
const MODEL = args.model ?? "google/gemini-3.1-flash-lite";
const ESCALATE = args.escalate ?? "openai/gpt-6-luna";
const CHUNK = args.chunk ?? "16000";
const LEDGER = "ir-deep-ledger";
const OUT = args.out ?? "/tmp/ir-deep";
mkdirSync(OUT, { recursive: true });
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} [deep] ${s}`);

// ---------- spend ledger ----------
async function spent(): Promise<number> {
  const { data } = await sb.from("job_state").select("cursor").eq("job", LEDGER).maybeSingle();
  return Number(data?.cursor ?? 0) / 1000;
}
let ledgerLock = Promise.resolve();
function addSpend(credits: number) {
  ledgerLock = ledgerLock.then(async () => {
    const total = (await spent()) + credits;
    await sb.from("job_state").upsert({ job: LEDGER, cursor: Math.round(total * 1000), paused_reason: null, lease_until: null, updated_at: new Date().toISOString() });
  });
  return ledgerLock;
}
if (args["reset-ledger"] !== undefined) await sb.from("job_state").upsert({ job: LEDGER, cursor: 0, paused_reason: null, lease_until: null, updated_at: new Date().toISOString() });

// ---------- child runs ----------
interface Spend {
  credits: number;
  done: number;
  facts: number;
  stop: string | null;
}
function run(name: string, script: string, argv: string[], logFile: string): Promise<{ code: number; spend: Spend | null }> {
  const spendFile = join(OUT, `${name}.spend.json`);
  if (existsSync(spendFile)) writeFileSync(spendFile, "");
  return new Promise((resolve) => {
    const p = spawn("bun", [script, ...argv, `--spend-file=${spendFile}`], { stdio: ["ignore", "pipe", "pipe"] });
    const lines: string[] = [];
    const onData = (b: Buffer) => {
      const s = b.toString();
      lines.push(s);
      writeFileSync(logFile, s, { flag: "a" });
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("exit", (code) => {
      let spend: Spend | null = null;
      try {
        const raw = readFileSync(spendFile, "utf8");
        if (raw) spend = JSON.parse(raw) as Spend;
      } catch {
        spend = null;
      }
      resolve({ code: code ?? 1, spend });
    });
  });
}

/** Per-reader credit cap: what's left of the budget, split while two readers run at once. */
async function cap(share = 0.5) {
  return Math.max(0, (BUDGET - (await spent())) * share);
}

async function count(q: PromiseLike<{ count: number | null }>) {
  await dbGate("ir-deep");
  return (await q).count ?? 0;
}

async function requeueFailed(ticker: string, field: "extract_status" | "vision_status") {
  await dbGate("ir-deep");
  const patch = field === "extract_status" ? { extract_status: null, extracted_at: null } : { vision_status: null };
  const { data } = await sb.from("ir_documents").update(patch).eq("ticker", ticker).like(field, "error:%").select("id");
  return data?.length ?? 0;
}

const EXTRACTABLE = ["press-release", "supplement", "presentation", "data", "other"];
const VISION_PDF = ["press-release", "supplement", "other", "data"];
/** Give files no reader can take an explicit status, so the report's backlog tells the truth. */
async function markUnreadable(ticker: string) {
  await dbGate("ir-deep");
  const { data } = await sb.from("ir_documents").select("id, kind, ext, bytes, path, rendition_path, pages, extract_status, extracted_at, vision_status").eq("ticker", ticker).limit(5000);
  const sheets = ["xls", "xlsx", "xlsm", "csv"];
  const canExtract = (d: NonNullable<typeof data>[number]) =>
    d.extract_status === null && d.extracted_at === null && (d.ext === "htm" || d.ext === "html" || (d.rendition_path ?? "").includes("html")) && EXTRACTABLE.includes(d.kind) && (d.pages == null || d.pages <= 90);
  const canVision = (d: NonNullable<typeof data>[number]) =>
    d.vision_status === null && !!d.path && ((d.kind === "image" && (d.bytes ?? 0) > 40000) || (d.kind === "presentation" && d.ext === "pdf") || (d.ext === "pdf" && VISION_PDF.includes(d.kind)));
  const graphic = (data ?? []).filter((d) => d.kind === "image" && d.vision_status === null && !canVision(d)).map((d) => d.id);
  const noText = (data ?? []).filter((d) => d.kind !== "image" && d.extract_status === null && !sheets.includes(d.ext ?? "") && !canExtract(d) && !canVision(d)).map((d) => d.id);
  for (let i = 0; i < graphic.length; i += 300) await sb.from("ir_documents").update({ vision_status: "skipped:graphic" }).in("id", graphic.slice(i, i + 300));
  for (let i = 0; i < noText.length; i += 300) await sb.from("ir_documents").update({ extract_status: "skipped:no-text" }).in("id", noText.slice(i, i + 300));
  return { graphic: graphic.length, noText: noText.length };
}

const readerArgs = (ticker: string, credits: number) => [`--ticker=${ticker}`, `--model=${MODEL}`, `--escalate=${ESCALATE}`, "--quality", "--resume", `--max-credits=${credits.toFixed(2)}`];

async function extract(ticker: string) {
  const logFile = join(OUT, `${ticker}.extract.log`);
  const res = { credits: 0, done: 0, facts: 0, retried: 0, stop: null as string | null };
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      res.retried = await requeueFailed(ticker, "extract_status");
      if (!res.retried) break;
      log(`${ticker} tables: retrying ${res.retried} failed files`);
    }
    const c = await cap();
    if (c < 0.5) return { ...res, stop: "budget spent" };
    const r = await run(`${ticker}-extract-${pass}`, "scripts/ir-extract.ts", [...readerArgs(ticker, c), `--chunk=${CHUNK}`, "--concurrency=12", "--chunk-concurrency=4", "--max=5000"], logFile);
    if (r.spend) {
      await addSpend(r.spend.credits);
      res.credits += r.spend.credits;
      res.done += r.spend.done;
      res.facts += r.spend.facts;
      res.stop = r.spend.stop;
    } else res.stop = `extract exited ${r.code} without a spend report (see ${logFile})`;
    if (res.stop) return res;
  }
  return res;
}

async function vision(ticker: string) {
  const logFile = join(OUT, `${ticker}.vision.log`);
  const res = { credits: 0, done: 0, facts: 0, retried: 0, stop: null as string | null };
  for (let pass = 0; pass < 2; pass++) {
    if (pass === 1) {
      res.retried = await requeueFailed(ticker, "vision_status");
      if (!res.retried) break;
      log(`${ticker} slides: retrying ${res.retried} failed files`);
    }
    const c = await cap();
    if (c < 0.5) return { ...res, stop: "budget spent" };
    const r = await run(`${ticker}-vision-${pass}`, "scripts/ir-vision.ts", [...readerArgs(ticker, c), "--loop", "--concurrency=6", "--max=2000"], logFile);
    if (r.spend) {
      await addSpend(r.spend.credits);
      res.credits += r.spend.credits;
      res.done += r.spend.done;
      res.facts += r.spend.facts;
      res.stop = r.spend.stop;
    } else res.stop = `vision exited ${r.code} without a spend report (see ${logFile})`;
    if (res.stop) return res;
  }
  return res;
}

async function report(ticker: string, parts: Record<string, unknown>) {
  const docs = sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", ticker);
  const facts = (method: string) => sb.from("ir_kpi_facts").select("id", { count: "exact", head: true }).eq("ticker", ticker).eq("method", method);
  const [total, table, vis, waitingT, waitingV, errT, errV] = await Promise.all([
    count(docs),
    count(facts("table")),
    count(facts("vision")),
    count(sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", ticker).is("extract_status", null).is("extracted_at", null).or("ext.in.(htm,html),rendition_path.like.%html").in("kind", EXTRACTABLE)),
    count(sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", ticker).is("vision_status", null).not("path", "is", null).or(`and(kind.eq.image,bytes.gt.40000),and(kind.eq.presentation,ext.eq.pdf),and(ext.eq.pdf,kind.in.(${VISION_PDF.join(",")}))`)),
    count(sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", ticker).like("extract_status", "error:%")),
    count(sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", ticker).like("vision_status", "error:%")),
  ]);
  const { data: series } = await sb.from("ir_company_series").select("stats, built_at").eq("ticker", ticker).maybeSingle();
  const r = { ticker, files: total, tableFacts: table, visionFacts: vis, waitingTables: waitingT, waitingSlides: waitingV, failedTables: errT, failedSlides: errV, series: series?.stats ?? null, builtAt: series?.built_at ?? null, ...parts, ledgerCredits: +(await spent()).toFixed(2) };
  writeFileSync(join(OUT, `${ticker}.report.json`), JSON.stringify(r, null, 1));
  log(`REPORT ${JSON.stringify(r)}`);
  return r;
}

// ---------- main ----------
const queue: string[] = [];
// --continue lists companies this pipeline already started (partial figures are its own work).
const CONTINUE = new Set((args.continue ?? "").split(",").filter(Boolean));
for (const t of TICKERS) {
  const n = await count(sb.from("ir_kpi_facts").select("id", { count: "exact", head: true }).eq("ticker", t));
  if (n && args["include-existing"] === undefined && !CONTINUE.has(t)) log(`${t}: skipped — already has ${n.toLocaleString()} IR figures`);
  else queue.push(t);
}
log(`companies: ${queue.join(", ")} | budget ${BUDGET} credits, ${(await spent()).toFixed(2)} already used | ${MODEL} → ${ESCALATE}`);

// 1. Dates first (seconds per company): the readers validate periods against filing dates.
if (args["skip-prepare"] === undefined) {
  const r = await run("dates", "scripts/ir-docling.ts", [`--tickers=${queue.join(",")}`, "--phase=dates"], join(OUT, "dates.log"));
  log(r.code === 0 ? "filing dates set from evidence" : `dating exited ${r.code} (see ${OUT}/dates.log)`);
}

// 2. File conversion (Docling, CPU-bound) runs company by company in the background while the
//    already-readable files (HTML exhibits) are read; converted PDFs are read in a final pass.
let files: Promise<void> = Promise.resolve();
for (const t of queue) {
  files = files.then(async () => {
    if (args["skip-prepare"] !== undefined) return;
    log(`${t}: converting files`);
    const r = await run(`${t}-files`, "scripts/ir-docling.ts", [`--tickers=${t}`, "--phase=files", "--workers=4", "--threads=4"], join(OUT, `${t}.prepare.log`));
    log(r.code === 0 ? `${t}: files converted` : `${t}: conversion exited ${r.code} (see ${OUT}/${t}.prepare.log)`);
  });
}

// 3. Per company: tables, then slides (in the background, one company at a time).
const results = new Map<string, Record<string, unknown>>();
let slides: Promise<unknown> = Promise.resolve();
let stopped: string | null = null;
for (const t of queue) {
  if ((await cap(1)) < 0.5) {
    stopped = "budget spent";
    log(`budget spent — stopping before ${t}`);
    break;
  }
  const t0 = Date.now();
  log(`${t}: reading tables`);
  const tables = await extract(t);
  log(`${t}: tables done — ${tables.done} files, ${tables.facts} figures, ${tables.credits.toFixed(2)} credits${tables.stop ? ` (stopped: ${tables.stop})` : ""}`);
  const prev = slides;
  slides = (async () => {
    await prev;
    log(`${t}: reading slides and scanned pages`);
    const vis = await vision(t);
    log(`${t}: slides done — ${vis.done} files, ${vis.facts} figures, ${vis.credits.toFixed(2)} credits${vis.stop ? ` (stopped: ${vis.stop})` : ""}`);
    results.set(t, { tables, slides: vis, minutes: +((Date.now() - t0) / 60000).toFixed(1) });
    try {
      await dbGate("ir-deep");
      await rebuildCompany(t);
    } catch (e) {
      log(`${t}: rebuild failed: ${(e as Error).message.slice(0, 160)}`);
    }
    await report(t, { stage: "first pass", ...results.get(t) });
  })();
  if (tables.stop?.startsWith("budget") || tables.stop?.startsWith("auth") || tables.stop?.startsWith("quota")) {
    stopped = tables.stop;
    log(`stopping: ${tables.stop}`);
    break;
  }
}
await slides;

// 4. Final pass: files converted while earlier companies were read, plus one retry of failures.
await files;
if (!stopped) {
  for (const t of queue) {
    const unreadable = await markUnreadable(t);
    const waiting = await count(sb.from("ir_documents").select("id", { count: "exact", head: true }).eq("ticker", t).is("extract_status", null).is("extracted_at", null).or("ext.in.(htm,html),rendition_path.like.%html").in("kind", EXTRACTABLE));
    let late = null;
    if (waiting) {
      log(`${t}: reading ${waiting} converted files`);
      late = await extract(t);
      log(`${t}: converted files done — ${late.done} files, ${late.facts} figures, ${late.credits.toFixed(2)} credits${late.stop ? ` (stopped: ${late.stop})` : ""}`);
    }
    try {
      await dbGate("ir-deep");
      await rebuildCompany(t);
    } catch (e) {
      log(`${t}: rebuild failed: ${(e as Error).message.slice(0, 160)}`);
    }
    await report(t, { stage: "final", unreadable, ...results.get(t), converted: late });
    if (late?.stop?.startsWith("budget")) break;
  }
}
await ledgerLock;
writeFileSync(join(OUT, "last-run.json"), JSON.stringify({ at: new Date().toISOString(), queue, stopped }));
log(`all done — ${(await spent()).toFixed(2)} of ${BUDGET} credits used`);
process.exit(0);
