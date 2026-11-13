/**
 * Prepare the stored IR files of chosen companies for reading, so the table reader sees clean tables
 * and every figure keeps a filing date:
 *   1. Dates and accession numbers from evidence only (partner index publish date, SEC title/URL, a
 *      printed date shortly after the reported period) — src/lib/ir/doc-meta.ts; unknown stays null.
 *   2. HTML copies ("renditions", `<path>.rendition.html`):
 *      - Markdown copies → tables (pipe tables) and pages (`---`)
 *      - PDF releases/supplements/data → Docling (layout model + TableFormer ACCURATE + Tesseract OCR
 *        for bitmap regions) in parallel persistent workers, merged page by page with the pdftotext
 *        layout grid so no printed number is lost (src/lib/ir/rendition.ts). Scanned pages keep their
 *        OCR words as searchable text; their numbers are read by the page-image reader (ir-vision).
 *      - company-site copies of a release whose figures the SEC exhibit already prints → layout copy,
 *        marked `skipped:duplicate of <id>` (src/lib/ir/dedupe.ts)
 *      - slide decks, transcripts, reports and very long PDFs → the layout grid only. Decks are read
 *        page by page by ir-vision, so they're marked `skipped:slides` for the table reader.
 *      - spreadsheets → scripts/ir-renditions.ts --sheets (every worksheet becomes a table)
 * Docling needs a Python env: python3 -m venv /tmp/dvenv && /tmp/dvenv/bin/pip install docling
 *   bun scripts/ir-docling.ts --tickers=CVS,MCK [--phase=dates|files] [--workers=4] [--threads=4] [--force] [--no-docling] [--python=/tmp/dvenv/bin/python]
 * --phase=dates runs step 1 only (seconds per company, so reading can start); --phase=files the rest.
 */
import { spawn, execFileSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { accnFromSecUrl, inferFiled } from "@/lib/ir/doc-meta";
import { duplicateOf, figureSet } from "@/lib/ir/dedupe";
import { markdownRendition, pdfRendition, type DoclingDoc } from "@/lib/ir/rendition";
import { args, dbGate, sb } from "./lib/supa";

const TICKERS = (args.tickers ?? args.ticker ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
if (!TICKERS.length) throw new Error("--tickers=CVS,MCK required");
const WORKERS = Number(args.workers ?? 4);
const THREADS = Number(args.threads ?? 4);
const PYTHON = args.python ?? "/tmp/dvenv/bin/python";
const PHASE = args.phase ?? "all";
const USE_DOCLING = PHASE !== "dates" && args["no-docling"] === undefined && existsSync(PYTHON);
const DOCLING_KINDS = ["press-release", "supplement", "data", "other"];
const MAX_DOCLING_PAGES = 90;
const JOB_TIMEOUT_MS = 20 * 60_000;
const WORK = "/tmp/irdl";
mkdirSync(WORK, { recursive: true });
const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
if (!USE_DOCLING && PHASE !== "dates") log(args["no-docling"] !== undefined ? "Docling off (--no-docling): layout copies only" : `Docling env not found at ${PYTHON} — layout copies only`);

// ---------- Docling worker pool ----------
interface Job {
  src: string;
  out: string;
  resolve: (r: { ok: boolean; error?: string; seconds?: number }) => void;
}
class DoclingPool {
  private idle: Worker[] = [];
  private queue: Job[] = [];
  private all: Worker[] = [];
  constructor(n: number) {
    for (let i = 0; i < n; i++) this.all.push(new Worker(i, this));
  }
  ready(w: Worker) {
    const job = this.queue.shift();
    if (job) w.run(job);
    else this.idle.push(w);
  }
  convert(src: string, out: string) {
    return new Promise<{ ok: boolean; error?: string; seconds?: number }>((resolve) => {
      const job = { src, out, resolve };
      const w = this.idle.shift();
      if (w) w.run(job);
      else this.queue.push(job);
    });
  }
  close() {
    for (const w of this.all) w.kill();
  }
}
class Worker {
  private proc!: ChildProcessWithoutNullStreams;
  private job: Job | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  constructor(
    private n: number,
    private pool: DoclingPool,
  ) {
    this.start();
  }
  private start() {
    this.proc = spawn(PYTHON, [join(import.meta.dir, "lib/docling_worker.py")], {
      env: { ...process.env, DOCLING_THREADS: String(THREADS), OMP_NUM_THREADS: String(THREADS), DOCLING_MAX_PAGES: String(MAX_DOCLING_PAGES), HF_HUB_DISABLE_PROGRESS_BARS: "1", TQDM_DISABLE: "1" },
    });
    this.proc.stderr.pipe(createWriteStream(join(WORK, `docling-${this.n}.log`), { flags: "a" }));
    const rl = createInterface({ input: this.proc.stdout });
    rl.on("line", (line) => {
      let msg: { ready?: boolean; ok?: boolean; error?: string; seconds?: number };
      try {
        msg = JSON.parse(line);
      } catch {
        return; // library chatter on stdout
      }
      if (msg.ready) return this.pool.ready(this);
      if (!this.job) return;
      const job = this.job;
      this.job = null;
      if (this.timer) clearTimeout(this.timer);
      job.resolve({ ok: !!msg.ok, error: msg.error, seconds: msg.seconds });
      this.pool.ready(this);
    });
    this.proc.on("exit", (code) => {
      if (this.closed) return;
      const job = this.job;
      this.job = null;
      if (this.timer) clearTimeout(this.timer);
      job?.resolve({ ok: false, error: `worker exited (${code})` });
      log(`docling worker ${this.n} exited (${code}) — restarting`);
      setTimeout(() => this.start(), 2000);
    });
  }
  run(job: Job) {
    this.job = job;
    this.timer = setTimeout(() => {
      log(`docling worker ${this.n}: timeout on ${job.src} — restarting it`);
      this.proc.kill("SIGKILL");
    }, JOB_TIMEOUT_MS);
    this.proc.stdin.write(`${JSON.stringify({ src: job.src, out: job.out })}\n`);
  }
  kill() {
    this.closed = true;
    this.proc.kill();
  }
}

// ---------- helpers ----------
interface Doc {
  id: string;
  ticker: string;
  kind: string;
  ext: string | null;
  path: string | null;
  rendition_path: string | null;
  title: string;
  source_url: string;
  filed: string | null;
  accn: string | null;
  pages: number | null;
  extract_status: string | null;
}
interface IndexRow {
  url: string;
  published?: string | null;
  period_end?: string | null;
}

async function docsOf(ticker: string): Promise<Doc[]> {
  const out: Doc[] = [];
  for (let from = 0; ; from += 1000) {
    await dbGate("ir-docling");
    const { data, error } = await sb.from("ir_documents").select("id, ticker, kind, ext, path, rendition_path, title, source_url, filed, accn, pages, extract_status").eq("ticker", ticker).range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as Doc[]));
    if ((data ?? []).length < 1000) return out;
  }
}

async function partnerIndex(ticker: string): Promise<Map<string, IndexRow>> {
  const { data } = await sb.storage.from("datasets").download(`ir/${ticker}.json`);
  if (!data) return new Map();
  try {
    const j = JSON.parse(await data.text()) as { documents?: IndexRow[] };
    return new Map((j.documents ?? []).map((d) => [d.url, d]));
  } catch {
    return new Map();
  }
}

async function update(id: string, patch: Record<string, unknown>) {
  await dbGate("ir-docling");
  const { error } = await sb.from("ir_documents").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

async function upload(path: string, html: string) {
  const up = await sb.storage.from("ir-documents").upload(path, new Blob([html], { type: "text/html" }), { contentType: "text/html", upsert: true });
  if (up.error) throw new Error(up.error.message);
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

const htmlText = (html: string) => html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

// ---------- main ----------
// Workers start on the first PDF that needs them (loading the models takes ~20 s each).
let docling: DoclingPool | null = null;
const doclingPool = () => (docling ??= new DoclingPool(WORKERS));
const summary: Record<string, unknown>[] = [];
for (const ticker of TICKERS) {
  const t0 = Date.now();
  const docs = await docsOf(ticker);
  const index = await partnerIndex(ticker);
  const stat = { ticker, docs: docs.length, dated: 0, accn: 0, markdown: 0, docling: 0, doclingFailed: 0, layout: 0, decks: 0, failed: 0, pages: { docling: 0, layout: 0, ocr: 0, empty: 0 }, sheets: 0, undated: 0 };

  // 1. Dates and accession numbers that need no download.
  for (const d of PHASE === "files" ? [] : docs) {
    const patch: Record<string, unknown> = {};
    if (!d.accn) {
      const a = accnFromSecUrl(d.source_url);
      if (a) (patch.accn = a), stat.accn++;
    }
    if (!d.filed) {
      const f = inferFiled({ published: index.get(d.source_url)?.published, title: d.title, url: d.source_url });
      if (f.filed) (patch.filed = f.filed), stat.dated++;
    }
    if (Object.keys(patch).length) {
      await update(d.id, patch);
      Object.assign(d, patch);
    }
  }

  if (PHASE === "dates") {
    stat.undated = docs.filter((d) => !d.filed).length;
    summary.push(stat);
    log(`${ticker} dated: ${stat.dated} dates, ${stat.accn} accession numbers, ${stat.undated} still undated`);
    continue;
  }

  // 2. Renditions for Markdown and PDF copies.
  const todo = docs.filter((d) => d.path && (d.ext === "md" || d.ext === "pdf") && (args.force !== undefined || d.rendition_path == null));
  /** Filing date from printed text, written in the same update that makes the file readable. */
  const textDate = (d: Doc, text: string): Record<string, unknown> => {
    if (d.filed) return {};
    const f = inferFiled({ text, periodEnd: index.get(d.source_url)?.period_end });
    if (!f.filed) return {};
    d.filed = f.filed;
    stat.dated++;
    return { filed: f.filed };
  };
  const dateFromText = async (d: Doc, text: string) => {
    const patch = textDate(d, text);
    if (Object.keys(patch).length) await update(d.id, patch);
  };
  // Company-site copies of a release the SEC exhibit already prints are kept for viewing but not
  // read again (src/lib/ir/dedupe.ts); the SEC copy carries the accession and exact filing date.
  let secSets: Promise<{ id: string; figures: Set<string> }[]> | null = null;
  const secCopies = () =>
    (secSets ??= (async () => {
      const sec = docs.filter((x) => x.path && x.source_url.includes("sec.gov") && (x.ext === "htm" || x.ext === "html"));
      const out: { id: string; figures: Set<string> }[] = [];
      await pool(sec, 8, async (x) => {
        const { data } = await sb.storage.from("ir-documents").download(x.path!);
        if (data) out.push({ id: x.id, figures: figureSet(htmlText(await data.text())) });
      });
      return out;
    })());
  const DEDUPE_KINDS = ["press-release", "supplement", "other", "data"];
  const duplicate = async (d: Doc, text: string) =>
    !d.source_url.includes("sec.gov") && DEDUPE_KINDS.includes(d.kind) ? duplicateOf(figureSet(text), await secCopies()) : null;
  const dupStatus = (id: string) => ({ extract_status: `skipped:duplicate of ${id}`, vision_status: "skipped:duplicate" });
  let duplicates = 0;

  await pool(todo, Math.max(2, WORKERS * 2), async (d) => {
    const dir = join(WORK, d.id);
    try {
      const { data: file, error } = await sb.storage.from("ir-documents").download(d.path!);
      if (error || !file) throw new Error(error?.message ?? "download failed");
      const rpath = `${d.path}.rendition.html`;
      if (d.ext === "md") {
        const md = await file.text();
        const r = markdownRendition(md, d.title);
        const dup = await duplicate(d, md);
        if (dup) duplicates++;
        await upload(rpath, r.html);
        await update(d.id, { rendition_path: rpath, pages: r.pages, extract_status: null, extracted_at: null, ...textDate(d, md), ...(dup ? dupStatus(dup.id) : {}) });
        stat.markdown++;
        return;
      }
      mkdirSync(dir, { recursive: true });
      const src = join(dir, "doc.pdf");
      writeFileSync(src, Buffer.from(await file.arrayBuffer()));
      const text = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", src, "-"], { maxBuffer: 256 * 1024 * 1024 }).toString("utf8");
      const layoutPages = text.split("\f");
      if (layoutPages.length > 1 && !layoutPages[layoutPages.length - 1].trim()) layoutPages.pop();
      const deck = d.kind === "presentation";
      const dup = deck ? null : await duplicate(d, text);
      if (dup) duplicates++;
      const wantDocling = USE_DOCLING && !deck && !dup && DOCLING_KINDS.includes(d.kind) && layoutPages.length <= MAX_DOCLING_PAGES;
      let dl: DoclingDoc | null = null;
      if (wantDocling) {
        const out = join(dir, "docling.json");
        const r = await doclingPool().convert(src, out);
        if (r.ok) dl = JSON.parse(readFileSync(out, "utf8")) as DoclingDoc;
        else {
          stat.doclingFailed++;
          log(`${ticker} docling failed (${r.error?.slice(0, 120)}) — layout copy: ${d.title.slice(0, 60)}`);
        }
      }
      const r = pdfRendition({ title: d.title, layoutPages, docling: dl, engine: dl ? "docling-hybrid" : "pdftotext-layout", scanned: "text" });
      await upload(rpath, r.html);
      await update(d.id, { rendition_path: rpath, pages: layoutPages.length, extract_status: deck ? "skipped:slides" : null, extracted_at: null, ...textDate(d, layoutPages.slice(0, 3).join("\n")), ...(dup ? dupStatus(dup.id) : {}) });
      if (dl) stat.docling++;
      else if (deck) stat.decks++;
      else stat.layout++;
      for (const k of ["docling", "layout", "ocr", "empty"] as const) stat.pages[k] += r.stats[k];
      if (dl) log(`${ticker} docling ${layoutPages.length}p (${r.stats.docling} docling / ${r.stats.layout} layout / ${r.stats.ocr} scanned) ${d.title.slice(0, 60)}`);
    } catch (e) {
      stat.failed++;
      await update(d.id, { rendition_path: "", extract_status: `rendition failed: ${(e as Error).message.slice(0, 120)}` }).catch(() => undefined);
      log(`${ticker} ! ${d.title.slice(0, 60)}: ${(e as Error).message.slice(0, 160)}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // Copies converted earlier but not read yet get the same check (text from their HTML copy).
  const converted = docs.filter((d) => d.rendition_path && d.extract_status == null && !todo.includes(d) && (d.ext === "pdf" || d.ext === "md"));
  await pool(converted, 6, async (d) => {
    const { data } = await sb.storage.from("ir-documents").download(d.rendition_path!);
    if (!data) return;
    const dup = await duplicate(d, htmlText(await data.text()));
    if (!dup) return;
    duplicates++;
    await update(d.id, dupStatus(dup.id));
  });
  (stat as Record<string, unknown>).duplicates = duplicates;

  // 3. Spreadsheets.
  const sheets = docs.filter((d) => d.path && ["xlsx", "xlsm", "xls", "csv"].includes(d.ext ?? "") && d.rendition_path == null);
  if (sheets.length) {
    execFileSync("bun", ["scripts/ir-renditions.ts", "--sheets", `--ticker=${ticker}`, "--limit=1000"], { stdio: "inherit" });
    stat.sheets = sheets.length;
  }

  // 4. Undated web pages: a printed date shortly after the period they report.
  const undated = docs.filter((d) => !d.filed && d.path && (d.ext === "htm" || d.ext === "html") && index.get(d.source_url)?.period_end);
  await pool(undated, 6, async (d) => {
    const { data: file } = await sb.storage.from("ir-documents").download(d.path!);
    if (file) await dateFromText(d, htmlText((await file.text()).slice(0, 400_000)));
  });
  stat.undated = docs.filter((d) => !d.filed).length;
  summary.push(stat);
  log(`${ticker} prepared in ${((Date.now() - t0) / 1000).toFixed(0)}s: ${JSON.stringify(stat)}`);
}
(docling as DoclingPool | null)?.close();
writeFileSync(join(WORK, `summary-${PHASE}-${TICKERS.join("_").slice(0, 60)}.json`), JSON.stringify(summary, null, 1));
process.exit(0);
