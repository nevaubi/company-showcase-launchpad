/**
 * One-company-at-a-time IR backfill: for each company, read all its waiting files (Sol/OpenAI)
 * and slides (Sonnet/Anthropic), retry failures once, rebuild its series, then move on.
 *   bun scripts/ir-by-ticker.ts [--start=GOOGL] [--concurrency=32] [--vision-concurrency=24]
 *
 * Companies go in ascending remaining-work order. If either runner stops on an auth/quota
 * error, the loop stops cleanly on the current company; rerun with --start=<that ticker>.
 * Lives in the repo (not /tmp) so it survives sandbox resets.
 *
 * "Waiting" means work a reader can actually pick up: exactly the filters nextToExtract() and
 * ir-vision's claim() use (status IS NULL — an empty string means already processed). Items no
 * reader can ever read (decorative graphics under the slide size floor, PDFs with no text copy
 * and no vision path) are marked `skipped:...` at startup so they stop counting as backlog and a
 * company can genuinely finish.
 */
import { spawn } from "node:child_process";
import { COVERAGE } from "@/lib/coverage";
import { args, log, sb } from "./lib/supa";

const EXTRACT_CONC = Number(args.concurrency ?? 32);
const VISION_CONC = Number(args["vision-concurrency"] ?? 24);

/** Mirrors EXTRACTABLE_KINDS in src/lib/ir/extract.server.ts. */
const EXTRACTABLE_KINDS = ["press-release", "supplement", "presentation", "data", "other"];
/** PDFs the slide reader renders page-by-page (ir-vision.ts filterFor). */
const VISION_PDF_KINDS = ["press-release", "supplement", "other", "data"];
/** Slide images below this size are logos, rules and icons, not pages (ir-vision.ts bytes.gt.40000). */
const VISION_MIN_BYTES = 40000;
/** PostgREST returns at most this many rows per request, so full-table reads must page. */
const PAGE = 1000;

interface Row {
  id: string;
  ticker: string;
  kind: string;
  ext: string | null;
  pages: number | null;
  bytes: number | null;
  path: string | null;
  rendition_path: string | null;
  extract_status: string | null;
  vision_status: string | null;
  extracted_at: string | null;
}

/** Run one script to completion; resolves with its exit code, streaming output to our stdout. */
function run(cmd: string[]): Promise<number> {
  return new Promise((resolve) => {
    const p = spawn(cmd[0], cmd.slice(1), { stdio: ["ignore", "inherit", "inherit"], env: process.env });
    p.on("close", (code) => resolve(code ?? 1));
  });
}

const COLUMNS = "id,ticker,kind,ext,pages,bytes,path,rendition_path,extract_status,vision_status,extracted_at";

/** Every document row, paged so a 73k-row table isn't silently cut at the first page. */
async function rows(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from("ir_documents").select(COLUMNS).range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const page = (data ?? []) as Row[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** Can the text reader take this? Same conditions as nextToExtract(). */
const canExtract = (d: Row) =>
  d.extract_status === null &&
  d.extracted_at === null &&
  (d.ext === "htm" || d.ext === "html" || (d.rendition_path ?? "").includes("html")) &&
  EXTRACTABLE_KINDS.includes(d.kind) &&
  (d.pages == null || d.pages <= 90);

/** Can the slide reader take this? Same conditions as ir-vision's claim(). */
const canVision = (d: Row) =>
  d.vision_status === null &&
  !!d.path &&
  ((d.kind === "image" && (d.bytes ?? 0) > VISION_MIN_BYTES) ||
    (d.kind === "presentation" && d.ext === "pdf") ||
    (d.ext === "pdf" && VISION_PDF_KINDS.includes(d.kind)));

const waiting = (d: Row) => canExtract(d) || canVision(d);

/** Remaining *readable* work per ticker, straight from the database. */
async function waitingCount(ticker: string): Promise<number> {
  const extract = sb
    .from("ir_documents")
    .select("id", { count: "exact", head: true })
    .eq("ticker", ticker)
    .is("extracted_at", null)
    .is("extract_status", null)
    .or("ext.in.(htm,html),rendition_path.like.%html")
    .in("kind", EXTRACTABLE_KINDS)
    .or("pages.is.null,pages.lte.90");
  const vision = sb
    .from("ir_documents")
    .select("id", { count: "exact", head: true })
    .eq("ticker", ticker)
    .is("vision_status", null)
    .not("path", "is", null)
    .or(
      `and(kind.eq.image,bytes.gt.${VISION_MIN_BYTES}),and(kind.eq.presentation,ext.eq.pdf),and(ext.eq.pdf,kind.in.(${VISION_PDF_KINDS.join(",")}))`,
    );
  const [{ count: files }, { count: slides }] = await Promise.all([extract, vision]);
  return (files ?? 0) + (slides ?? 0);
}

/** Give items no reader can ever take an explicit status, so backlog counts tell the truth. */
async function markUnreadable(all: Row[]) {
  const noSlide = all.filter((d) => d.kind === "image" && d.vision_status === null && !canVision(d));
  const noText = all.filter((d) => d.kind !== "image" && d.extract_status === null && !canExtract(d) && !canVision(d));
  const ids = (xs: Row[]) => {
    const out: string[][] = [];
    for (let i = 0; i < xs.length; i += 500) out.push(xs.slice(i, i + 500).map((d) => d.id));
    return out;
  };
  for (const chunk of ids(noSlide)) {
    const { error } = await sb.from("ir_documents").update({ vision_status: "skipped:graphic" }).in("id", chunk);
    if (error) throw new Error(error.message);
  }
  for (const chunk of ids(noText)) {
    const { error } = await sb.from("ir_documents").update({ extract_status: "skipped:no-text" }).in("id", chunk);
    if (error) throw new Error(error.message);
  }
  log(`by-ticker: marked ${noSlide.length} decorative graphics and ${noText.length} text-less files as skipped`);
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
await markUnreadable(await rows());

const counts = new Map<string, number>();
for (const t of COVERAGE.map((c) => c.ticker)) counts.set(t, await waitingCount(t));
const queue = [...counts]
  .filter(([, n]) => n > 0)
  .sort((a, b) => a[1] - b[1])
  .map(([t]) => t);
const startIdx = startAfter ? Math.max(0, queue.indexOf(startAfter)) : 0;
log(`by-ticker: ${queue.length} companies with work left; starting at ${queue[startIdx]} (${startIdx + 1}/${queue.length})`);

for (let i = startIdx; i < queue.length; i++) {
  const t = queue[i];
  log(`=== ${t} (${i + 1}/${queue.length}, ${counts.get(t)} waiting) ===`);
  const extract = ["bun", "scripts/ir-extract.ts", `--ticker=${t}`, `--concurrency=${EXTRACT_CONC}`, "--chunk-concurrency=8", "--max=100000", "--resume", "--force"];
  const vision = ["bun", "scripts/ir-vision.ts", `--ticker=${t}`, `--concurrency=${VISION_CONC}`, "--max=100000", "--max-usd=750", "--resume", "--force"];
  let [exCode] = await Promise.all([run(extract), run(vision)]);

  // Second pass over anything that failed, then rebuild.
  await requeueFailures(t);
  const leftNow = await waitingCount(t);
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
  log(`=== ${t} done (${await waitingCount(t)} left) === ${exCode === 0 ? "ok" : "runner exited " + exCode}`);
}
log("by-ticker: all companies finished");
process.exit(0);
