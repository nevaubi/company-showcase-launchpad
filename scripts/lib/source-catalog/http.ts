/**
 * Polite, cached reads of publisher listings for `scripts/source-catalog.ts`.
 *
 * One request at a time, a fixed User-Agent that names us, a pause after every request, and each
 * address read once: the response (any HTTP status) is kept under the cache folder and every later
 * run reads it from there. A network failure is not cached, so a rerun tries again.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const USER_AGENT = "FiledUnder Research research@filedunder.ai";
const PAUSE_MS = 1500;
const TIMEOUT_MS = 60_000;
const MAX_BYTES = 64 * 1024 * 1024;

export type Listing = {
  url: string;
  status: number;
  contentType: string;
  retrievedAt: string;
  sha256: string;
  bytes: number;
  body: string;
};

type Meta = Omit<Listing, "body">;

export function cacheKey(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 24);
}

let queue: Promise<unknown> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCached(dir: string, url: string): Promise<Listing | null> {
  const key = cacheKey(url);
  try {
    const meta = JSON.parse(await readFile(join(dir, `${key}.json`), "utf8")) as Meta;
    const body = await readFile(join(dir, `${key}.body`), "utf8");
    if (meta.url !== url) return null;
    return { ...meta, body };
  } catch {
    return null;
  }
}

async function download(dir: string, url: string): Promise<Listing> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/json,text/csv,*/*;q=0.8" },
      redirect: "follow",
      signal: controller.signal,
    });
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength > MAX_BYTES) throw new Error(`${url}: ${buffer.byteLength} bytes is more than a listing`);
    const meta: Meta = {
      url,
      status: res.status,
      contentType: res.headers.get("content-type") ?? "",
      retrievedAt: new Date().toISOString(),
      sha256: createHash("sha256").update(buffer).digest("hex"),
      bytes: buffer.byteLength,
    };
    await mkdir(dir, { recursive: true });
    const key = cacheKey(url);
    await writeFile(join(dir, `${key}.body`), buffer);
    await writeFile(join(dir, `${key}.json`), `${JSON.stringify(meta, null, 2)}\n`);
    return { ...meta, body: buffer.toString("utf8") };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The listing at `url`, from the cache when it was read before. With `offline` a listing that is
 * not cached is an error instead of a request.
 */
export function readListing(url: string, cacheDir: string, offline = false): Promise<Listing> {
  const run = queue.then(async () => {
    const cached = await readCached(cacheDir, url);
    if (cached) return cached;
    if (offline) throw new Error(`not in the cache (offline run): ${url}`);
    try {
      return await download(cacheDir, url);
    } finally {
      await sleep(PAUSE_MS);
    }
  });
  queue = run.catch(() => undefined);
  return run;
}
