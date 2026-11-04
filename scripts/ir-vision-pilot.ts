/**
 * Dry-run slide model comparison: re-reads single-image slides that the vision runner already read and
 * compares the numbers the candidate model keeps against the stored vision facts. Writes nothing.
 *   bun scripts/ir-vision-pilot.ts --model=claude-haiku-5-5 [--n=40] [--effort=low]
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { openaiStructured } from "@/lib/openai.server";
import { numberTokens, parseTesseractTsv, renderTokens, VISION_INSTRUCTIONS, VISION_SCHEMA, visionFacts, type VisionOutput } from "@/lib/ir/vision-core";
import { pool } from "@/lib/ir/extract.server";
import { COVERAGE } from "@/lib/coverage";
import { args, sb } from "./lib/supa";

const model = args.model ?? "claude-haiku-5-5";
const n = Number(args.n ?? 40);
const names = new Map(COVERAGE.map((c) => [c.ticker, c.name]));
const sh = (cmd: string, a: string[]) => execFileSync(cmd, a, { maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "ignore"] });

const { data: docs } = await sb
  .from("ir_documents")
  .select("id, ticker, title, kind, ext, path, filed, extract_facts")
  .eq("kind", "image")
  .in("ext", ["jpg", "jpeg"])
  .like("vision_status", "ok (%")
  .order("vision_at", { ascending: false })
  .limit(1500);
const perTicker = new Map<string, number>();
const sample = (docs ?? []).filter((d) => {
  const k = perTicker.get(d.ticker) ?? 0;
  if (k >= 2) return false;
  perTicker.set(d.ticker, k + 1);
  return true;
}).slice(0, n);

const key = (f: { period_end: string; months: number; value: number }) => `${f.period_end}|${f.months}|${Math.round(Number(f.value) * 1000)}`;
let base = 0, cand = 0, both = 0, sameMetric = 0, fails = 0, inTok = 0, outTok = 0, cacheTok = 0;
const started = Date.now();
await pool(sample, 6, async (d) => {
  const dir = `/tmp/irvp/${d.id}`;
  mkdirSync(dir, { recursive: true });
  try {
    const { data: blob } = await sb.storage.from("ir-documents").download(d.path);
    const img = `${dir}/p1.jpg`;
    writeFileSync(img, Buffer.from(await blob!.arrayBuffer()));
    const [w, h] = sh("identify", ["-format", "%w %h\n", img]).toString().split("\n")[0].split(" ").map(Number);
    const words = parseTesseractTsv(sh("tesseract", [img, "stdout", "--psm", "11", "tsv"]).toString(), w, h);
    const tokens = numberTokens(words);
    const context = `Company: ${d.ticker} (${names.get(d.ticker) ?? d.ticker}). Document: ${d.title} (${d.kind}, filed ${d.filed ?? "unknown"}).`;
    const r = await openaiStructured<VisionOutput>({
      model,
      name: "ir_page",
      instructions: VISION_INSTRUCTIONS,
      input: [
        { type: "input_text", text: `${context} Page 1 of 1.\n\nNumbers printed on the page:\n${renderTokens(tokens)}` },
        { type: "input_image", image_url: `data:image/jpeg;base64,${readFileSync(img).toString("base64")}`, detail: "high" },
      ],
      schema: VISION_SCHEMA as unknown as Record<string, unknown>,
      effort: (args.effort ?? "low") as "low",
      maxOutputTokens: 32_000,
    });
    inTok += r.usage.input_tokens; outTok += r.usage.output_tokens; cacheTok += r.usage.cached_tokens;
    const { rows } = visionFacts(r.data, tokens, 1, d.filed, true);
    const { data: stored } = await sb.from("ir_kpi_facts").select("period_end, months, value, metric").eq("document_id", d.id).eq("method", "vision");
    const s = new Map((stored ?? []).map((f) => [key(f as never), f]));
    const c = new Map(rows.map((f) => [key(f), f]));
    base += s.size; cand += c.size;
    let k = 0;
    for (const [kk, f] of c) {
      const o = s.get(kk);
      if (!o) continue;
      both++; k++;
      if (o.metric === f.metric) sameMetric++;
    }
    console.log(`${d.ticker.padEnd(6)} stored ${String(s.size).padStart(3)}  ${model} ${String(c.size).padStart(3)}  overlap ${k}`);
  } catch (e) {
    fails++;
    console.log(`${d.ticker} FAILED ${(e as Error).message.slice(0, 140)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
console.log(JSON.stringify({ model, slides: sample.length, fails, stored: base, candidate: cand, overlap: both,
  recall: +(both / base).toFixed(3), precision: +(both / cand).toFixed(3), sameMetric: +(sameMetric / both).toFixed(3),
  tokens: { inTok, cacheTok, outTok }, seconds: Math.round((Date.now() - started) / 1000) }, null, 1));
process.exit(0);
