/**
 * Vision pass over stored IR slides, chart images and scanned pages (owner's OpenAI key).
 *   bun scripts/ir-vision.ts [--concurrency=8] [--max=2000] [--ticker=AAPL] [--kind=image|presentation|pdf] [--watch --idle=30] [--resume] [--force]
 *
 * Per document: find the number tokens on each page (PDF text layer, or tesseract OCR for images
 * and scanned pages), skip pages without data, send page image + numbered tokens to the vision
 * model, keep only facts that point at a real token (value re-read from it, box = token box), drop
 * numbers the table pass already stored, save page images and inject them into the document's
 * HTML copy so click-to-source can outline the exact number on the page.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { IR_MODELS, openaiStructured } from "@/lib/openai.server";
import { numberTokens, parseBboxHtml, parseTesseractTsv, renderTokens, VISION_INSTRUCTIONS, VISION_SCHEMA, visionFacts, type PageWords, type VisionFact, type VisionOutput } from "@/lib/ir/vision-core";
import { pool } from "@/lib/ir/extract.server";
import { COVERAGE } from "@/lib/coverage";
import { args, sb } from "./lib/supa";
import { runBatch } from "./lib/runner";

const BUCKET = "ir-documents";
const MIN_TOKENS = 6;
const MAX_PAGES = 80;
const model = args.model ?? IR_MODELS.vision;
const names = new Map(COVERAGE.map((c) => [c.ticker, c.name]));

type Doc = { id: string; ticker: string; label: string; kind: string; ext: string | null; path: string; rendition_path: string | null; title: string; filed: string | null; accn: string | null; bytes: number | null };

const sh = (cmd: string, a: string[], opts: { input?: Buffer } = {}) => execFileSync(cmd, a, { maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "ignore"], input: opts.input });

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
  image: string; // local file
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
      const [w, h] = sh("identify", ["-format", "%w %h\n", src]).toString().split("\n")[0].split(" ").map(Number);
      if (!(w >= 500 && h >= 300)) return mark(d, "skipped: small image", 0);
      let img = src;
      if (ext === "gif" || ext === "png") {
        img = join(dir, "p1.jpg");
        sh("convert", [`${src}[0]`, "-background", "white", "-flatten", "-quality", "85", img]);
      }
      const tsv = sh("tesseract", [img, "stdout", "--psm", "11", "tsv"]).toString();
      jobs.push({ page: 1, words: parseTesseractTsv(tsv, w, h), image: img, w, h });
    } else if (ext === "pdf") {
      const bbox = sh("pdftotext", ["-bbox", "-l", String(MAX_PAGES), src, "-"]).toString("utf8");
      const pages = parseBboxHtml(bbox);
      pageCount = pages.length;
      const wantAll = d.kind === "presentation";
      for (const p of pages) {
        const scanned = p.words.length < 5;
        if (!wantAll && !scanned) continue;
        if (!scanned && numberTokens(p).length < MIN_TOKENS) continue;
        const base = join(dir, `p${p.page}`);
        sh("pdftoppm", ["-jpeg", "-jpegopt", "quality=82", "-r", "110", "-f", String(p.page), "-l", String(p.page), "-singlefile", src, base]);
        const img = `${base}.jpg`;
        const [w, h] = sh("identify", ["-format", "%w %h\n", img]).toString().split("\n")[0].split(" ").map(Number);
        const words = scanned ? parseTesseractTsv(sh("tesseract", [img, "stdout", "--psm", "11", "tsv"]).toString(), w, h, p.page) : p;
        jobs.push({ page: p.page, words, image: img, w, h });
      }
    } else return mark(d, "skipped: format", 0);

    const candidates = jobs.filter((j) => numberTokens(j.words).length >= MIN_TOKENS);
    if (!candidates.length) return mark(d, "no data", 0);

    const context = `Company: ${d.ticker} (${names.get(d.ticker) ?? d.ticker}). Document: ${d.title} (${d.kind}, filed ${d.filed ?? "unknown"}).`;
    const usage = { input_tokens: 0, output_tokens: 0 };
    const results = await pool(candidates, 4, async (j) => {
      const tokens = numberTokens(j.words);
      const b64 = readFileSync(j.image).toString("base64");
      const r = await openaiStructured<VisionOutput>({
        model,
        name: "ir_page",
        instructions: VISION_INSTRUCTIONS,
        input: [
          { type: "input_text", text: `${context} Page ${j.page} of ${pageCount}.\n\nNumbers printed on the page:\n${renderTokens(tokens)}` },
          { type: "input_image", image_url: `data:image/jpeg;base64,${b64}`, detail: "high" },
        ],
        schema: VISION_SCHEMA as unknown as Record<string, unknown>,
        effort: "low",
        maxOutputTokens: 32_000,
      });
      usage.input_tokens += r.usage.input_tokens;
      usage.output_tokens += r.usage.output_tokens;
      return { job: j, ...visionFacts(r.data, tokens, j.page, d.filed), kind: r.data.page_kind };
    });

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
    if (pagesWithFacts.length) await publishPages(d, candidates.filter((j) => pagesWithFacts.includes(j.page)), isImage);

    await sb.from("ir_kpi_facts").delete().eq("document_id", d.id).eq("method", "vision");
    const records = facts.map((f) => ({ document_id: d.id, ticker: d.ticker, ...f, accn: d.accn, doc: null, document_kind: d.kind === "image" ? "presentation" : d.kind, filed: d.filed, method: "vision", model }));
    for (let i = 0; i < records.length; i += 500) {
      const { error: e } = await sb.from("ir_kpi_facts").insert(records.slice(i, i + 500) as never);
      if (e) throw new Error(e.message);
    }
    await mark(d, facts.length ? `ok (${facts.length} facts, ${pagesWithFacts.length} pages${rejected ? `, ${rejected} rejected` : ""})` : "no data", facts.length);
    return { facts: facts.length, note: `${candidates.length}pp${rejected ? ` ${rejected} rej` : ""}`, usage };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function publishPages(d: Doc, pages: PageJob[], isImage: boolean) {
  const figure = (p: PageJob, asset: string) => `<figure data-page-img="${p.page}"><img src="ASSET:${asset}" width="${p.w}" height="${p.h}" alt="Page ${p.page}" loading="lazy"></figure>`;
  if (isImage && !d.ext?.match(/gif|png/)) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title></head><body>${figure(pages[0], d.path)}</body></html>`;
    await upload(`renditions/${d.id}.html`, Buffer.from(html), "text/html; charset=utf-8");
    await sb.from("ir_documents").update({ rendition_path: `renditions/${d.id}.html`, pages: 1 }).eq("id", d.id);
    return;
  }
  const assets = new Map<number, string>();
  await pool(pages, 4, async (p) => {
    const path = `renditions/${d.id}/p${p.page}.jpg`;
    await upload(path, readFileSync(p.image), "image/jpeg");
    assets.set(p.page, path);
  });
  let html: string | null = null;
  if (d.rendition_path) {
    const { data } = await sb.storage.from(BUCKET).download(d.rendition_path);
    html = data ? await data.text() : null;
  }
  if (html) {
    html = html.replace(/<figure data-page-img="\d+">[\s\S]*?<\/figure>/g, "");
    for (const p of pages) {
      const fig = figure(p, assets.get(p.page)!);
      const h2 = new RegExp(`(<h2 id="page-${p.page}">[^<]*</h2>)`);
      html = h2.test(html) ? html.replace(h2, `$1${fig}`) : html.replace(/<\/body>/i, `${fig}</body>`);
    }
  } else {
    html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(d.title)}</title></head><body>${pages
      .sort((a, b) => a.page - b.page)
      .map((p) => `<h2 id="page-${p.page}">Page ${p.page}</h2>${figure(p, assets.get(p.page)!)}`)
      .join("")}</body></html>`;
  }
  const path = d.rendition_path ?? `renditions/${d.id}.html`;
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

await runBatch<Doc>({
  job: "ir-vision-runner",
  max: Number(args.max ?? 2000),
  concurrency: Number(args.concurrency ?? 8),
  idleMinutes: args.watch !== undefined ? Number(args.idle ?? 30) : undefined,
  claim,
  release: (d, status) => sb.from("ir_documents").update({ vision_status: status, vision_at: status ? new Date().toISOString() : null }).eq("id", d.id),
  reset: () => sb.from("ir_documents").update({ vision_status: null }).eq("vision_status", "working"),
  process: processDoc,
});
// Clean any leftovers from interrupted documents.
mkdirSync("/tmp/irv", { recursive: true });
for (const f of readdirSync("/tmp/irv", { withFileTypes: true }).filter((x) => x.isDirectory())) rmSync(join("/tmp/irv", f.name), { recursive: true, force: true });
process.exit(0);
