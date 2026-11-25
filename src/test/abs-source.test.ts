import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { SecSource } from "../../scripts/lib/abs-source";

const sha = (t: string) => createHash("sha256").update(t).digest("hex");
const dirs: string[] = [];
function source(served: Record<string, string[]>, o: { offline?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "abs-source-"));
  dirs.push(dir);
  const asked: string[] = [];
  const src = new SecSource(dir, {
    ...o,
    minGapMs: 0,
    fetch: async (url) => {
      asked.push(url);
      const next = served[url]?.shift();
      if (next === undefined) throw new Error(`nothing to serve for ${url}`);
      return {
        status: 200,
        body: (async function* () {
          // in two pieces, as a network read arrives
          yield new TextEncoder().encode(next.slice(0, 3));
          yield new TextEncoder().encode(next.slice(3));
        })(),
      };
    },
  });
  return { src, dir, asked };
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FILE = "https://www.sec.gov/Archives/edgar/data/1/000000000026000001/exh_102.xml";
const LIST = "https://data.sec.gov/submissions/CIK0000000001.json";

describe("abs SEC source", () => {
  it("asks SEC once for a filing's file and reads the copy on disk after that, with the same hash", async () => {
    const t = source({ [FILE]: ["<assetData/>"] });
    const a = await t.src.text(FILE);
    const b = await t.src.text(FILE);
    expect(t.asked).toEqual([FILE]);
    expect(a).toMatchObject({
      text: "<assetData/>",
      bytes: 12,
      sha256: sha("<assetData/>"),
      fromDisk: false,
    });
    expect(b).toMatchObject({
      text: "<assetData/>",
      bytes: 12,
      sha256: sha("<assetData/>"),
      fromDisk: true,
    });
    const manifest = readFileSync(join(t.dir, "manifest.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(manifest).toHaveLength(1);
    expect(manifest[0]).toMatchObject({
      url: FILE,
      bytes: 12,
      sha256: sha("<assetData/>"),
      status: 200,
    });
  });

  it("asks again for a listing, because a listing changes, and keeps a line for each retrieval", async () => {
    const t = source({ [LIST]: ['{"n":1}', '{"n":2}'] });
    expect((await t.src.text(LIST, { fresh: true })).text).toBe('{"n":1}');
    expect((await t.src.text(LIST, { fresh: true })).text).toBe('{"n":2}');
    expect(t.asked).toEqual([LIST, LIST]);
    // without `fresh` the newest copy on disk is what is read
    expect((await t.src.text(LIST)).text).toBe('{"n":2}');
    expect(t.asked).toHaveLength(2);
    expect(readFileSync(join(t.dir, "manifest.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("never asks SEC when offline: the copy on disk, or an error that names the file", async () => {
    const t = source({ [LIST]: ['{"n":1}'] });
    await t.src.text(LIST, { fresh: true });
    const off = new SecSource(t.dir, {
      offline: true,
      fetch: async () => Promise.reject(new Error("asked")),
    });
    expect((await off.text(LIST, { fresh: true })).text).toBe('{"n":1}');
    await expect(off.text(FILE)).rejects.toThrow(/offline and not on disk: .*exh_102\.xml/);
  });

  it("reads a copy another tool stored compressed, and hashes the bytes SEC served, not the gzip", async () => {
    const t = source({});
    const body = "<assetData>" + "<assets/>".repeat(1000) + "</assetData>";
    const at = join(t.dir, "www.sec.gov/Archives/edgar/data/1/000000000026000001");
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, "exh_102.xml.gz"), gzipSync(body));
    const f = await t.src.open(FILE);
    let n = 0;
    for await (const c of f.chunks) n += c.length;
    expect(t.asked).toEqual([]);
    expect(f.done()).toMatchObject({ bytes: body.length, sha256: sha(body), fromDisk: true });
    expect(n).toBe(body.length);
  });

  it("does not report a size or hash for a file that was not read to the end", async () => {
    const t = source({ [FILE]: ["<assetData/>"] });
    const f = await t.src.open(FILE);
    const read = f.chunks[Symbol.asyncIterator]();
    expect((await read.next()).done).toBe(false);
    expect(() => f.done()).toThrow(/not read to the end/);
    expect((await read.next()).done).toBe(true);
    expect(f.done()).toMatchObject({ bytes: 12, sha256: sha("<assetData/>") });
  });
});
