/**
 * Read one page image with a vision model — shared by the slide runner (ir-vision.ts) and the pilot,
 * so a pilot measures exactly what production does.
 *
 * Claude (claude-* ids, owner's Anthropic key): adaptive thinking at high effort, image before
 * text, every listed number token must be either stored or skipped with a reason; tokens the first
 * answer leaves out get one follow-up turn in the same conversation. OpenAI / gateway models get
 * a single call. Values are always re-read from the token in visionFacts(), never from the model.
 */
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join } from "node:path";
import { claudeContent, claudeStructured, estimateUsd, openaiStructured, OpenAIError, type ClaudeMessage, type Effort, type Usage } from "@/lib/openai.server";
import { followUpPrompt, mergeVision, parseTesseractTsv, renderTokens, unaccounted, VISION_INSTRUCTIONS, VISION_SCHEMA, visionFacts, type PageToken, type PageWords, type VisionFact, type VisionOutput } from "@/lib/ir/vision-core";
import { VISION_QUALITY_PROMPT } from "@/lib/ir/vision-quality";

const SCHEMA = VISION_SCHEMA as unknown as Record<string, unknown>;
const isClaude = (model: string) => model.startsWith("claude-");

/** One tesseract thread each: many single-threaded OCR runs in parallel beat a few that fight over cores. */
export const OCR_ENV = { ...process.env, OMP_THREAD_LIMIT: "1" };
/** Keep OCR words down to confidence 30; below 55 they're flagged "?" and only usable when the model reads the same digits. */
const OCR_CONF = { minConf: 30, weakBelow: 55 };
const execFileP = promisify(execFile);
/**
 * Run a local tool without blocking: OCR and rendering of many documents then use all cores while
 * model calls are in flight (a synchronous exec stalls every worker in the process).
 */
export async function run(cmd: string, a: string[]): Promise<Buffer> {
  const { stdout } = await execFileP(cmd, a, { maxBuffer: 256 * 1024 * 1024, env: OCR_ENV, encoding: "buffer" });
  return stdout;
}
export const imageSize = async (img: string) => (await run("identify", ["-format", "%w %h\n", img])).toString().split("\n")[0].split(" ").map(Number) as [number, number];

/** OCR an image; small images are upscaled 2× first (tesseract reads small print far better). Boxes are page fractions either way. */
export async function ocrImage(img: string, w: number, h: number, page: number, dir: string): Promise<PageWords> {
  let src = img;
  let [ow, oh] = [w, h];
  if (Math.max(w, h) < 1400) {
    src = join(dir, `ocr-${page}.png`);
    await run("convert", [img, "-resize", "200%", "-colorspace", "Gray", src]);
    [ow, oh] = [w * 2, h * 2];
  }
  return parseTesseractTsv((await run("tesseract", [src, "stdout", "--psm", "11", "tsv"])).toString(), ow, oh, page, OCR_CONF);
}

export const visionEffort = (model: string): Effort => (process.env["IR_VISION_EFFORT"] as Effort | undefined) || (isClaude(model) ? "high" : "low");

/** Claude's high-resolution image budget (Claude 4.7 and later): long edge and 28×28-px patches. */
const MAX_EDGE = 2576;
const MAX_PATCHES = 4784;
const fits = (w: number, h: number) => Math.ceil(w / 28) * 28 <= MAX_EDGE && Math.ceil(h / 28) * 28 <= MAX_EDGE && Math.ceil(w / 28) * Math.ceil(h / 28) <= MAX_PATCHES;

/** Largest aspect-preserving size Claude reads without downscaling (reference resized_size()). */
export function claudeFit(w: number, h: number): [number, number] {
  if (fits(w, h)) return [w, h];
  if (h > w) {
    const [a, b] = claudeFit(h, w);
    return [b, a];
  }
  const ar = w / h;
  let lo = 1;
  let hi = w;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid, Math.max(Math.round(mid / ar), 1))) lo = mid;
    else hi = mid;
  }
  return [lo, Math.max(Math.round(lo / ar), 1)];
}

/** DPI that renders a PDF page (size in points) at the largest size Claude reads natively. */
export function renderDpi(widthPt: number, heightPt: number, min = 110, max = 300) {
  const [w] = claudeFit(widthPt * 100, heightPt * 100);
  return Math.max(min, Math.min(max, Math.floor((w / widthPt) * 72)));
}

/** Image bytes to send: oversized images are shrunk to Claude's budget here instead of server-side. */
export async function modelImage(path: string, w: number, h: number, model: string): Promise<Buffer> {
  if (!isClaude(model)) return readFile(path);
  const [tw, th] = claudeFit(w, h);
  if (tw === w && th === h) return readFile(path);
  return run("convert", [path, "-resize", `${tw}x${th}!`, "-quality", "90", "jpg:-"]);
}

/** The bytes' real format: some IR "jpg" files are PNG or GIF inside, and Claude rejects a wrong media type. */
export function mediaType(b: Buffer) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "image/jpeg";
}

export interface PageRead {
  rows: VisionFact[];
  rejected: number;
  kind: VisionOutput["page_kind"];
  usage: Usage;
  usd: number;
  /** tokens neither stored nor skipped after the first answer / after the follow-up */
  missing: number;
  missingAfter: number;
  skipped: number;
  followUp: boolean;
  /** the model's answer was unusable (cut off, refused, bad JSON) — page counted as empty */
  failed?: string;
}

const add = (a: Usage, b: Usage): Usage => ({
  input_tokens: a.input_tokens + b.input_tokens,
  output_tokens: a.output_tokens + b.output_tokens,
  cached_tokens: a.cached_tokens + b.cached_tokens,
  cache_write_tokens: (a.cache_write_tokens ?? 0) + (b.cache_write_tokens ?? 0),
});
const ZERO: Usage = { input_tokens: 0, output_tokens: 0, cached_tokens: 0, cache_write_tokens: 0 };

export async function readPage(o: {
  model: string;
  context: string;
  page: number;
  pageCount: number;
  tokens: PageToken[];
  jpeg: Buffer;
  ocr: boolean;
  filed: string | null;
  effort?: Effort;
  followUp?: boolean;
  maxOutputTokens?: number;
  quality?: boolean;
}): Promise<PageRead> {
  const effort = o.effort ?? visionEffort(o.model);
  const text = `${o.context} Page ${o.page} of ${o.pageCount}.\n\nNumber tokens printed on the page (${o.tokens.length}):\n${renderTokens(o.tokens)}`;
  const image = `data:${mediaType(o.jpeg)};base64,${o.jpeg.toString("base64")}`;
  let usage = ZERO;
  let usd = 0;
  const bill = (u: Usage | undefined) => {
    if (!u) return;
    usage = add(usage, u);
    usd += estimateUsd(o.model, u) ?? 0;
  };
  const empty = (failed: string): PageRead => ({ rows: [], rejected: 0, kind: "other", usage, usd, missing: o.tokens.length, missingAfter: o.tokens.length, skipped: 0, followUp: false, failed });

  if (!isClaude(o.model)) {
    try {
      const call = (prompt: string) => openaiStructured<VisionOutput>({
        model: o.model,
        name: "ir_page",
        instructions: o.quality ? `${VISION_INSTRUCTIONS}\n\n${VISION_QUALITY_PROMPT}` : VISION_INSTRUCTIONS,
        input: [
          { type: "input_text", text: prompt },
          { type: "input_image", image_url: image, detail: "high" },
        ],
        schema: SCHEMA,
        effort,
        maxOutputTokens: o.maxOutputTokens ?? 32_000,
      });
      const r = await call(text);
      bill(r.usage);
      let out = r.data;
      const missing = unaccounted(out, o.tokens);
      // Explicit opt-in for comparison loops; existing single-call runs stay unchanged.
      const followUp = o.followUp === true && missing.length >= 2;
      if (followUp) {
        try {
          const second = await call(`${text}\n\n${followUpPrompt(missing)}`);
          bill(second.usage);
          out = mergeVision(out, second.data);
        } catch (e) {
          if (!(e instanceof OpenAIError && e.kind === "rejected")) throw e;
          bill(e.usage);
        }
      }
      return { ...visionFacts(out, o.tokens, o.page, o.filed, o.ocr), kind: out.page_kind, usage, usd, missing: missing.length, missingAfter: unaccounted(out, o.tokens).length, skipped: out.skipped?.length ?? 0, followUp };
    } catch (e) {
      if (e instanceof OpenAIError && e.kind === "rejected") {
        bill(e.usage);
        return empty(e.message);
      }
      throw e;
    }
  }

  const messages: ClaudeMessage[] = [{ role: "user", content: claudeContent([{ type: "input_text", text }, { type: "input_image", image_url: image }]) }];
  const call = () => claudeStructured<VisionOutput>({ model: o.model, instructions: VISION_INSTRUCTIONS, messages, schema: SCHEMA, effort, maxOutputTokens: 64_000 });
  let first: Awaited<ReturnType<typeof call>>;
  try {
    first = await call();
  } catch (e) {
    if (e instanceof OpenAIError && e.kind === "rejected") {
      bill(e.usage);
      // One retry: the docs advise treating a cut-off answer as failed and asking again.
      try {
        first = await call();
      } catch (e2) {
        if (e2 instanceof OpenAIError && e2.kind === "rejected") {
          bill(e2.usage);
          return empty(e2.message);
        }
        throw e2;
      }
    } else throw e;
  }
  bill(first.usage);
  let out = first.data;
  const missing = unaccounted(out, o.tokens);
  let followUp = false;
  if (o.followUp !== false && missing.length >= 2) {
    followUp = true;
    messages.push({ role: "assistant", content: first.content }, { role: "user", content: [{ type: "text", text: followUpPrompt(missing) }] });
    try {
      const second = await call();
      bill(second.usage);
      out = mergeVision(out, second.data);
    } catch (e) {
      // The first answer stands if the follow-up is unusable.
      if (!(e instanceof OpenAIError && e.kind === "rejected")) throw e;
      bill(e.usage);
    }
  }
  const missingAfter = unaccounted(out, o.tokens).length;
  return { ...visionFacts(out, o.tokens, o.page, o.filed, o.ocr), kind: out.page_kind, usage, usd, missing: missing.length, missingAfter, skipped: out.skipped?.length ?? 0, followUp };
}
