/**
 * Dry-run slide model comparison: re-reads single-image slides that the vision runner already read,
 * through the exact production page reader (scripts/lib/vision-page.ts), and compares the numbers the
 * candidate model keeps against the stored vision facts. Writes nothing to the database.
 *   bun scripts/ir-vision-pilot.ts --model=claude-sonnet-5-5 [--n=40] [--effort=high] [--no-followup] [--keep=/tmp/irvp-keep] [--same=/tmp/irvp-keep/report.json]
 * With --keep, slide images and a disagreements report (report.json) are saved for visual review.
 */
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { numberTokens, type VisionFact } from "@/lib/ir/vision-core";
import { pool } from "@/lib/ir/extract.server";
import { COVERAGE } from "@/lib/coverage";
import type { Effort } from "@/lib/openai.server";
import { args, sb } from "./lib/supa";
import { imageSize, modelImage, ocrImage, readPage, visionEffort } from "./lib/vision-page";

const model = args.model ?? "claude-sonnet-5-5";
const effort = (args.effort as Effort | undefined) ?? visionEffort(model);
const n = Number(args.n ?? 40);
const keep = args.keep;
const names = new Map(COVERAGE.map((c) => [c.ticker, c.name]));
if (keep) mkdirSync(keep, { recursive: true });

const { data: docs } = await sb
  .from("ir_documents")
  .select("id, ticker, title, kind, ext, path, filed, extract_facts")
  .eq("kind", "image")
  .in("ext", ["jpg", "jpeg"])
  .like("vision_status", "ok (%")
  .order("vision_at", { ascending: false })
  .limit(1500);
// --same=<report.json> re-runs exactly the slides of an earlier pilot, so two prompts compare like with like.
const same = args.same ? new Set((JSON.parse(readFileSync(args.same, "utf8")) as { id: string }[]).map((d) => d.id)) : null;
const perTicker = new Map<string, number>();
const sample = same
  ? ((await sb.from("ir_documents").select("id, ticker, title, kind, ext, path, filed, extract_facts").in("id", [...same])).data ?? [])
  : (docs ?? [])
  .filter((d) => {
    const k = perTicker.get(d.ticker) ?? 0;
    if (k >= 2) return false;
    perTicker.set(d.ticker, k + 1);
    return true;
  })
  .slice(0, n);

type Stored = { period_end: string; months: number; value: number; metric: string; label: string; unit: string; locator: { box?: number[]; text?: string } | null };
const key = (f: { period_end: string; months: number; value: number }) => `${f.period_end}|${f.months}|${Math.round(Number(f.value) * 1000)}`;
let base = 0, cand = 0, both = 0, sameMetric = 0, fails = 0, inTok = 0, outTok = 0, cacheTok = 0, usd = 0, followUps = 0, missing = 0, missingAfter = 0, tokTotal = 0, secs = 0;
const report: unknown[] = [];
const started = Date.now();
await pool(sample, 8, async (d) => {
  const dir = `/tmp/irvp/${d.id}`;
  mkdirSync(dir, { recursive: true });
  try {
    const { data: blob } = await sb.storage.from("ir-documents").download(d.path);
    const img = `${dir}/p1.jpg`;
    writeFileSync(img, Buffer.from(await blob!.arrayBuffer()));
    const [w, h] = await imageSize(img);
    const tokens = numberTokens(await ocrImage(img, w, h, 1, dir));
    const context = `Company: ${d.ticker} (${names.get(d.ticker) ?? d.ticker}). Document: ${d.title} (${d.kind}, filed ${d.filed ?? "unknown"}).`;
    const t0 = Date.now();
    const r = await readPage({ model, effort, context, page: 1, pageCount: 1, tokens, jpeg: await modelImage(img, w, h, model), ocr: true, filed: d.filed, followUp: args["no-followup"] === undefined });
    secs += (Date.now() - t0) / 1000;
    inTok += r.usage.input_tokens; outTok += r.usage.output_tokens; cacheTok += r.usage.cached_tokens; usd += r.usd;
    if (r.followUp) followUps++;
    missing += r.missing; missingAfter += r.missingAfter; tokTotal += tokens.length;
    if (r.failed) fails++;
    const { data: stored } = await sb.from("ir_kpi_facts").select("period_end, months, value, metric, label, unit, locator").eq("document_id", d.id).eq("method", "vision");
    const s = new Map(((stored ?? []) as Stored[]).map((f) => [key(f), f]));
    const c = new Map(r.rows.map((f) => [key(f), f]));
    base += s.size; cand += c.size;
    let k = 0;
    for (const [kk, f] of c) {
      const o = s.get(kk);
      if (!o) continue;
      both++; k++;
      if (o.metric === f.metric) sameMetric++;
    }
    console.log(`${d.ticker.padEnd(6)} tokens ${String(tokens.length).padStart(3)}  stored ${String(s.size).padStart(3)}  ${model} ${String(c.size).padStart(3)}  overlap ${String(k).padStart(3)}  left-out ${r.missing}→${r.missingAfter}${r.followUp ? " (2nd look)" : ""}  $${r.usd.toFixed(3)}${r.failed ? `  FAILED ${r.failed}` : ""}`);
    if (keep) {
      copyFileSync(img, `${keep}/${d.id}.jpg`);
      const brief = (f: VisionFact) => ({ label: f.label, metric: f.metric, unit: f.unit, value: f.value, period: `${f.months}M ${f.period_end}`, text: f.locator.text, box: f.locator.box });
      report.push({
        id: d.id, ticker: d.ticker, title: d.title, filed: d.filed,
        onlyCandidate: [...c].filter(([kk]) => !s.has(kk)).map(([, f]) => brief(f)),
        onlyStored: [...s].filter(([kk]) => !c.has(kk)).map(([, f]) => ({ label: f.label, metric: f.metric, unit: f.unit, value: f.value, period: `${f.months}M ${f.period_end}`, text: f.locator?.text, box: f.locator?.box })),
        both: k,
      });
    }
  } catch (e) {
    fails++;
    console.log(`${d.ticker} FAILED ${(e as Error).message.slice(0, 140)}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
if (keep) writeFileSync(`${keep}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ model, effort, slides: sample.length, fails, stored: base, candidate: cand, overlap: both,
  recall: +(both / base).toFixed(3), precision: +(both / cand).toFixed(3), sameMetric: +(sameMetric / both).toFixed(3),
  leftOutFirstPass: +(missing / tokTotal).toFixed(3), leftOutFinal: +(missingAfter / tokTotal).toFixed(3), followUps,
  usd: +usd.toFixed(3), usdPerSlide: +(usd / sample.length).toFixed(4), secPerSlide: Math.round(secs / sample.length),
  tokens: { inTok, cacheTok, outTok }, seconds: Math.round((Date.now() - started) / 1000) }, null, 1));
process.exit(0);
