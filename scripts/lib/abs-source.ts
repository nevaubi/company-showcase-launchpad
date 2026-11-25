// SEC files for the ABS-EE importer: fetched politely, kept on disk as served, hashed as they are read.
// Scripts only (Node APIs). The disk copy lets an interrupted run resume without asking SEC again and
// lets a check re-read exactly the bytes that were stored from.
import { createHash } from "node:crypto";
import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { createGunzip } from "node:zlib";
import { fetchSec } from "../../src/lib/sec.server";

export type Served = {
  url: string;
  bytes: number;
  sha256: string;
  fromDisk: boolean;
  retrievedAt: string;
};

export class SecSource {
  private last = 0;
  constructor(
    private readonly dir: string,
    private readonly o: { offline?: boolean; minGapMs?: number; log?: (m: string) => void } = {},
  ) {}

  /** Where a URL is kept: <dir>/<host>/<path>, or the same with `.gz` (large files another tool stored compressed). */
  private place(url: string): { path: string; gz: boolean } | null {
    const u = new URL(url);
    const path = join(this.dir, u.host, decodeURIComponent(u.pathname));
    if (existsSync(path)) return { path, gz: false };
    if (existsSync(`${path}.gz`)) return { path: `${path}.gz`, gz: true };
    return null;
  }

  /** Downloads a URL to disk unless it is there. Never more than two requests a second. */
  private async ensure(url: string): Promise<{ path: string; gz: boolean; fromDisk: boolean }> {
    const have = this.place(url);
    if (have) return { ...have, fromDisk: true };
    if (this.o.offline) throw new Error(`offline and not on disk: ${url}`);
    const wait = this.last + (this.o.minGapMs ?? 500) - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const u = new URL(url);
    const path = join(this.dir, u.host, decodeURIComponent(u.pathname));
    mkdirSync(dirname(path), { recursive: true });
    const res = await fetchSec(url, { timeoutMs: 900_000, tries: 4, maxWaitMs: 30_000 });
    if (!res.body) throw new Error(`no body: ${url}`);
    const part = `${path}.part`;
    const out = createWriteStream(part);
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        hash.update(chunk);
        bytes += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
      }
    } finally {
      await new Promise((r) => out.end(r));
    }
    renameSync(part, path);
    // one line per retrieval, the same record other tools keep beside these files
    appendFileSync(
      join(this.dir, "manifest.jsonl"),
      `${JSON.stringify({ url, path: relative(this.dir, path), bytes, sha256: hash.digest("hex"), retrieved_at: new Date().toISOString(), status: res.status, by: "abs-ee" })}\n`,
    );
    this.o.log?.(`fetched ${url} (${bytes} bytes)`);
    return { path, gz: false, fromDisk: false };
  }

  /** The bytes of a URL as SEC served them, chunk by chunk, with their size and SHA-256 once read to the end. */
  async open(url: string): Promise<{ chunks: AsyncIterable<Uint8Array>; done: () => Served }> {
    const at = await this.ensure(url);
    const hash = createHash("sha256");
    let bytes = 0;
    let ended = false;
    const file = createReadStream(at.path);
    const raw: AsyncIterable<Buffer> = at.gz ? file.pipe(createGunzip()) : file;
    const retrievedAt = statSync(at.path).mtime.toISOString();
    async function* chunks() {
      for await (const c of raw) {
        hash.update(c);
        bytes += c.length;
        yield c as Uint8Array;
      }
      ended = true;
    }
    return {
      chunks: chunks(),
      done: () => {
        if (!ended) throw new Error(`not read to the end: ${url}`);
        return { url, bytes, sha256: hash.digest("hex"), fromDisk: at.fromDisk, retrievedAt };
      },
    };
  }

  /** A small file as text (headers, index pages, JSON). */
  async text(url: string): Promise<Served & { text: string }> {
    const f = await this.open(url);
    const parts: Uint8Array[] = [];
    for await (const c of f.chunks) parts.push(c);
    return { ...f.done(), text: Buffer.concat(parts).toString("utf8") };
  }
}
