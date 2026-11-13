/**
 * Vision pass over stored IR slides, chart images and scanned pages.
 *   bun scripts/ir-vision.ts [--concurrency=8] [--max=2000] [--ticker=AAPL] [--kind=image|presentation|pdf] [--model=claude-sonnet-5-5]
 *                            [--verify=<second model>] [--max-usd=500] [--watch --idle=30] [--resume] [--force] [--dry]
 *
 * Per document: find the number tokens on each page (PDF text layer, or tesseract OCR for images
 * and scanned pages), skip pages without data, send page image + numbered tokens to the vision
 * model (scripts/lib/vision-page.ts), keep only facts that point at a real token (value re-read
 * from it, box = token box), drop numbers the table pass already stored, save page images and
 * inject them into the document's HTML copy so click-to-source can outline the exact number.
 * --max-usd pauses the job once this run's estimated spend passes the cap (Claude models).
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IR_MODELS, type Usage } from "@/lib/openai.server";
import { numberTokens, parseBboxHtml, type PageWords, type VisionFact } from "@/lib/ir/vision-core";
import { pool } from "@/lib/ir/extract.server";
import { COVERAGE } from "@/lib/coverage";
import { args, log, sb } from "./lib/supa";
import { runBatch } from "./lib/runner";
import { imageSize, modelImage, ocrImage as ocr, readPage, renderDpi, run, visionEffort } from "./lib/vision-page";

const BUCKET = "ir-documents";
const MIN_TOKENS = 6;
const MAX_PAGES = 80;
/** long edge of the page images stored for the viewer */
const PUBLISH_EDGE = 1600;
const model = args.model ?? IR_MODELS.vision;
/** optional second reader: a figure is kept only when both models read the same token, period and value */
const verifier = args.verify as string | undefined;
const names = new Map(COVERAGE.map((c) => [c.ticker, c.name]));
type Doc = { id: string; ticker: string; label: string; kind: string; ext: string | null; path: string; rendition_path: string | null; title: string; filed: string | null; accn: string | null; bytes: number | null };

const sh = run;
const size = imageSize;

function filterFor(kind?: string) {
  if (kind === "image") return "and(kind.eq.image,bytes.gt.40000)";
  if (kind === "presentation") return "and(kind.eq.presentation,ext.eq.pdf)";
  if (kind === "pdf") return "ext.eq.pdf";
  return "and(kind.eq.image,bytes.gt.40000),and(kind.eq.presentation,ext.eq.pdf),and(ext.eq.pdf,kind.in.(press-release,supplement,other,data))";
}

async function claim(): Promise<Doc | null> {
  let q = sb
    .from("ir_documents")
    .select("id, ticker, kind, ext, path, rendition_path, title, filed, accn, bytes")
    .is("vision_status", null)
    .not("path", "is", null)
    .or(filterFor(args.kind))
    .order("filed", { ascending: false, nullsFirst: false })
    .limit(16);
  if (args.ticker) q = q.in("ticker", args.ticker.split(","));
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  for (const d of data ?? []) {
    const { data: got } = await sb.from("ir_documents").update({ vision_status: "working" }).eq("id", d.id).is("vision_status", null).select("id");
    if (got?.length) return { ...(d as Omit<Doc, "label">), label: `${d.filed ?? ""} ${d.kind} ${d.title}` };
  }
  return null;
}

interface PageJob {
  page: number;
  words: PageWords;
  /** words came from OCR rather than the PDF text layer */
  ocr: boolean;
  image: string; // local file sent to the model
  w: number;
  h: number;
}

async function processDoc(d: Doc) {
  const dir = `/tmp/irv/${d.id}`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  try {
    const { data: blob, error } = await sb.storage.from(BUCKET).download(d.path);
    if (error || !blob) throw new Error(error?.message ?? "download failed");
    const ext = (d.ext ?? "").toLowerCase();
    const src = join(dir, `src.${ext || "bin"}`);
    writeFileSync(src, Buffer.from(await blob.arrayBuffer()));

    const jobs: PageJob[] = [];
    const isImage = d.kind === "image" || /^(jpe?g|png|gif)$/.test(ext);
    let pageCount = 1;
    if (isImage) {
      const [w, h] = await size(src);
      if (!(w >= 500 && h >= 300)) return mark(d, "skipped: small image", 0);
      let img = src;
      if (ext !== "jpg" && ext !== "jpeg") {
        img = join(dir, "p1.jpg");
        await sh("convert", [`${src}[0]`, "-background", "white", "-flatten", "-quality", "90", img]);
      }
      jobs.push({ page: 1, words: await ocr(img, w, h, 1, dir), image: img, w, h, ocr: true });
    } else if (ext === "pdf") {
      const bbox = (await sh("pdftotext", ["-bbox", "-l", String(MAX_PAGES), src, "-"])).toString("utf8");
      const pages = parseBboxHtml(bbox);
      pageCount = pages.length;
      const wantAll = d.kind === "presentation";
      for (const p of pages) {
        const scanned = p.words.length < 5;
        if (!wantAll && !scanned) continue;
        if (!scanned && numberTokens(p).length < MIN_TOKENS) continue;
        // Render at the largest size the model reads natively (≈2,400 px wide for a slide).
        const base = join(dir, `p${p.page}`);
        await sh("pdftoppm", ["-jpeg", "-jpegopt", "quality=88", "-r", String(renderDpi(p.width, p.height)), "-f", String(p.page), "-l", String(p.page), "-singlefile", src, base]);
        const img = `${base}.jpg`;
        const [w, h] = await size(img);
        const words = scanned ? await ocr(img, w, h, p.page, dir) : p;
        jobs.push({ page: p.page, words, image: img, w, h, ocr: scanned });
      }
    } else return mark(d, "skipped: format", 0);

    const candidates = jobs.filter((j) => numberTokens(j.words).length >= MIN_TOKENS);
    if (args.dry !== undefined) {
      // Inspect page selection and tokens without calling the model; the document stays queued.
      await sb.from("ir_documents").update({ vision_status: null }).eq("id", d.id);
      const sample = candidates[0] ? numberTokens(candidates[0].words).slice(0, 12).map((t) => t.text).join(" ") : "";
      return { facts: 0, note: `dry: ${candidates.length}/${pageCount} pages, ${candidates.reduce((n, j) => n + numberTokens(j.words).length, 0)} tokens [${sample}]` };
    }
    if (!candidates.length) return mark(d, "no data", 0);

    const context = `Company: ${d.ticker} (${names.get(d.ticker) ?? d.ticker}). Document: ${d.title} (${d.kind}, filed ${d.filed ?? "unknown"}).`;
    const usage: Usage & { usd: number } = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, usd: 0 };
    let followUps = 0;
    let failedPages = 0;
    let disagreed = 0;
    const results = await pool(candidates, 4, async (j) => {
      const tokens = numberTokens(j.words);
      const read = async (m: string) => readPage({ model: m, context, page: j.page, pageCount, tokens, jpeg: await modelImage(j.image, j.w, j.h, m), ocr: j.ocr, filed: d.filed });
      const [r, v] = await Promise.all([read(model), verifier ? read(verifier) : null]);
      if (v) {
        const key = (f: VisionFact) => `${f.locator.text}|${f.period_end}|${f.months}|${f.value}`;
        const ok = new Set(v.rows.map(key));
        const kept = r.rows.filter((f) => ok.has(key(f)));
        disagreed += r.rows.length - kept.length;
        r.rows = kept;
      }
      usage.input_tokens += r.usage.input_tokens;
      usage.output_tokens += r.usage.output_tokens;
      usage.cached_tokens += r.usage.cached_tokens;
      usage.usd += r.usd;
      if (r.followUp) followUps++;
      if (r.failed) failedPages++;
      return { job: j, ...r };
    });
    if (failedPages === candidates.length) {
      // Nothing usable came back for any page: leave a visible error rather than a silent "no data".
      throw new Error(`model answer unusable on every page (${results[0]?.failed ?? "unknown"})`);
    }

    // Numbers the table pass already stored from this document stay with their table cell.
    const { data: existing } = await sb.from("ir_kpi_facts").select("period_end, months, value").eq("document_id", d.id).eq("method", "table");
    const have = new Set((existing ?? []).map((f) => `${f.period_end}|${f.months}|${Math.round(Number(f.value))}`));
    const facts: VisionFact[] = [];
    let rejected = 0;
    for (const r of results) {
      rejected += r.rejected;
      for (const f of r.rows) if (!have.has(`${f.period_end}|${f.months}|${Math.round(f.value)}`)) facts.push(f);
    }
    const pagesWithFacts = [...new Set(facts.map((f) => f.locator.page))];

    // Page images + HTML copy with figures, so the viewer can outline each number.
    if (pagesWithFacts.length) await publishPages(d, candidates.filter((j) => pagesWithFacts.includes(j.page)), isImage, dir);

    await sb.from("ir_kpi_facts").delete().eq("document_id", d.id).eq("method", "vision");
    const records = facts.map((f) => ({ document_id: d.id, ticker: d.ticker, ...f, accn: d.accn, doc: null, document_kind: d.kind === "image" ? "presentation" : d.kind, filed: d.filed, method: "vision", model: verifier ? `${model}+${verifier}` : model }));
    for (let i = 0; i < records.length; i += 500) {
      const { error: e } = await sb.from("ir_kpi_facts").insert(records.slice(i, i + 500) as never);
      if (e) throw new Error(e.message);
    }
    const extra = [rejected ? `${rejected} rejected` : "", failedPages ? `${failedPages} pages unreadable` : "", disagreed ? `${disagreed} unconfirmed` : ""].filter(Boolean).join(", ");
    await mark(d, facts.length ? `ok (${facts.length} facts, ${pagesWithFacts.length} pages${extra ? `, ${extra}` : ""})` : extra ? `no data (${extra})` : "no data", facts.length);
    const note = [`${candidates.length}pp`, rejected ? `${rejected} rej` : "", followUps ? `${followUps} 2nd look` : "", failedPages ? `${failedPages} failed` : "", usage.usd ? `$${usage.usd.toFixed(3)}` : ""].filter(Boolean).join(" ");
    return { facts: facts.length, note, usage };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function publishPages(d: Doc, pages: PageJob[], isImage: boolean, dir: string) {
  const figure = (p: PageJob, asset: string, w: number, h: number) => `<figure data-page-img="${p.page}"><img src="ASSET:${asset}" width="${w}" height="${h}" alt="Page ${p.page}" loading="lazy"></figure>`;
  if (isImage && !d.ext?.match(/gif|png|webp/i)) {
    const p = pages[0];
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title></head><body>${figure(p, d.path, p.w, p.h)}</body></html>`;
    await upload(`renditions/${d.id}.html`, Buffer.from(html), "text/html; charset=utf-8");
    await sb.from("ir_documents").update({ rendition_path: `renditions/${d.id}.html`, pages: 1 }).eq("id", d.id);
    return;
  }
  // Stored page images are capped at PUBLISH_EDGE so the viewer stays light; highlight boxes are page fractions.
  const assets = new Map<number, { path: string; w: number; h: number }>();
  await pool(pages, 4, async (p) => {
    const path = `renditions/${d.id}/p${p.page}.jpg`;
    const pub = join(dir, `pub-${p.page}.jpg`);
    await sh("convert", [p.image, "-resize", `${PUBLISH_EDGE}x${PUBLISH_EDGE}>`, "-quality", "82", pub]);
    const [w, h] = await size(pub);
    await upload(path, readFileSync(pub), "image/jpeg");
    assets.set(p.page, { path, w, h });
  });
  const fig = (p: PageJob) => {
    const a = assets.get(p.page)!;
    return figure(p, a.path, a.w, a.h);
  };
  let html: string | null = null;
  if (d.rendition_path) {
    const { data } = await sb.storage.from(BUCKET).download(d.rendition_path);
    html = data ? await data.text() : null;
  }
  if (html) {
    html = html.replace(/<figure data-page-img="\d+">[\s\S]*?<\/figure>/g, "");
    for (const p of pages) {
      const h2 = new RegExp(`(<h2 id="page-${p.page}">[^<]*</h2>)`);
      html = h2.test(html) ? html.replace(h2, `$1${fig(p)}`) : html.replace(/<\/body>/i, `${fig(p)}</body>`);
    }
  } else {
    html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title></head><body>${pages
      .sort((a, b) => a.page - b.page)
      .map((p) => `<h2 id="page-${p.page}">Page ${p.page}</h2>${fig(p)}`)
      .join("")}</body></html>`;
  }
  const path = d.rendition_path || `renditions/${d.id}.html`;
  await upload(path, Buffer.from(html), "text/html; charset=utf-8");
  if (!d.rendition_path) await sb.from("ir_documents").update({ rendition_path: path }).eq("id", d.id);
}

async function upload(path: string, body: Buffer, contentType: string) {
  const { error } = await sb.storage.from(BUCKET).upload(path, body, { contentType, upsert: true });
  if (error) throw new Error(`upload ${path}: ${error.message}`);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

async function mark(d: Doc, status: string, facts: number) {
  await sb.from("ir_documents").update({ vision_status: status, vision_at: new Date().toISOString() }).eq("id", d.id);
  return { facts, note: status.startsWith("ok") ? undefined : status };
}

log(`ir-vision: model ${model}, effort ${visionEffort(model)}${args["max-usd"] ? `, spend cap $${args["max-usd"]}` : ""}`);
await runBatch<Doc>({
  job: "ir-vision-runner",
  max: Number(args.max ?? 2000),
  concurrency: Number(args.concurrency ?? 8),
  idleMinutes: args.watch !== undefined ? Number(args.idle ?? 30) : undefined,
  maxUsd: args["max-usd"] ? Number(args["max-usd"]) : undefined,
  claim,
  release: (d, status) => sb.from("ir_documents").update({ vision_status: status, vision_at: status ? new Date().toISOString() : null }).eq("id", d.id),
  reset: () => sb.from("ir_documents").update({ vision_status: null }).eq("vision_status", "working"),
  process: processDoc,
});
// Clean any leftovers from interrupted documents.
mkdirSync("/tmp/irv", { recursive: true });
for (const f of readdirSync("/tmp/irv", { withFileTypes: true }).filter((x) => x.isDirectory())) rmSync(join("/tmp/irv", f.name), { recursive: true, force: true });
process.exit(0);
