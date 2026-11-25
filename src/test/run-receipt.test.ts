// What a worker child tells the worker about its run (scripts/lib/run-receipt.ts): written in one
// step, read once, and never a place where a key or a signed address can end up.
import { mkdtempSync, existsSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RECEIPT_MAX_BYTES, receiptText, scrubReceipt, sweepRunReceipts, takeRunReceipt, writeRunReceipt } from "../../scripts/lib/run-receipt";

const folder = () => mkdtempSync(join(tmpdir(), "run-receipt-test-"));

describe("text that may be stored", () => {
  it("keeps the host and path of a URL and drops its query, fragment and user name", () => {
    expect(receiptText("SEC EDGAR responded 504 for https://www.sec.gov/Archives/edgar/data/1974820/000110465926083795/exh_102.xml"))
      .toBe("SEC EDGAR responded 504 for https://www.sec.gov/Archives/edgar/data/1974820/000110465926083795/exh_102.xml");
    expect(receiptText("GET https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=0123456789abcdef failed"))
      .toBe("GET https://api.stlouisfed.org/fred/series/observations failed");
    expect(receiptText("https://user:hunter2@example.gov/file.csv#frag")).toBe("https://example.gov/file.csv");
    // a signed storage address is a capability: nothing after the path survives
    expect(receiptText("upload to https://x.supabase.co/storage/v1/object/upload/sign/datasets/official/objects/ab?token=eyJhbGciOiJIUzI1NiJ9.e30.sig"))
      .toBe("upload to https://x.supabase.co/storage/v1/object/upload/sign/datasets/official/objects/ab");
  });

  it("replaces what looks like a credential wherever it stands", () => {
    expect(receiptText("auth failed for sb_secret_AbC123-xyz and eyJhbGciOiJIUzI1NiJ9.payload")).toBe("auth failed for [credential] and [credential]");
    expect(receiptText("api_key=abcdef123456, token: zzz999; password = hunter2")).toBe("api_key=[removed], token: [removed]; password = [removed]");
    expect(receiptText("Authorization: Bearer abc.def.ghi rejected")).toBe("Authorization: [removed] rejected");
  });

  it("is one bounded line", () => {
    expect(receiptText("first line\n   second\tline  ")).toBe("first line second line");
    expect(receiptText("x".repeat(1000))).toHaveLength(240);
    expect(receiptText(new Error("FRED download deadline exceeded"), 12)).toBe("FRED downloa");
  });

  it("scrubs every string of a receipt and bounds its shape", () => {
    const scrubbed = scrubReceipt({
      failed: [{ id: "fred_x", error: "no reply from https://fred.stlouisfed.org/graph/fredgraph.csv?id=X&cosd=2000-01-01" }],
      items: 3, ok: true, nothing: null, gone: undefined,
      deep: { a: { b: { c: { d: { e: { f: "too deep" } } } } } },
    }) as Record<string, unknown>;
    expect(scrubbed.failed).toEqual([{ id: "fred_x", error: "no reply from https://fred.stlouisfed.org/graph/fredgraph.csv" }]);
    expect(scrubbed).toMatchObject({ items: 3, ok: true, nothing: null });
    expect("gone" in scrubbed).toBe(false);
    expect(JSON.stringify(scrubbed.deep)).toBe('{"a":{"b":{"c":{"d":{"e":null}}}}}');
  });
});

describe("the receipt file", () => {
  it("is written whole, read once and then gone", () => {
    const file = join(folder(), "official-source-refresh-1.json");
    expect(writeRunReceipt(file, { script: "source-refresh", items: 2, failed: [{ id: "a", error: "FRED download deadline exceeded" }] })).toBe(true);
    expect(existsSync(`${file}.part`)).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ script: "source-refresh", items: 2, failed: [{ id: "a", error: "FRED download deadline exceeded" }] });
    expect(takeRunReceipt(file)).toEqual({ script: "source-refresh", items: 2, failed: [{ id: "a", error: "FRED download deadline exceeded" }] });
    expect(existsSync(file)).toBe(false);
    expect(takeRunReceipt(file)).toBeNull();
  });

  it("writes nothing for a run by hand, and never throws", () => {
    expect(writeRunReceipt(undefined, { items: 1 })).toBe(false);
    // the folder is the worker's to make: a child writes into it or not at all
    const missing = join(folder(), "not-made", "receipt.json");
    expect(writeRunReceipt(missing, { items: 1 })).toBe(false);
    expect(existsSync(join(missing, ".."))).toBe(false);
    expect(writeRunReceipt(join(folder(), "big.json"), { text: Array.from({ length: 200 }, () => "y".repeat(499)) })).toBe(false);
  });

  it("refuses what is not a small JSON object, and removes it", () => {
    const dir = folder();
    const cases: [string, string][] = [["list.json", "[1,2]"], ["text.json", "not json"], ["big.json", JSON.stringify({ a: "z".repeat(RECEIPT_MAX_BYTES) })]];
    for (const [name, body] of cases) {
      writeFileSync(join(dir, name), body);
      expect(takeRunReceipt(join(dir, name)), name).toBeNull();
      expect(existsSync(join(dir, name)), name).toBe(false);
    }
  });

  it("does not read through a symbolic link", () => {
    const dir = folder();
    writeFileSync(join(dir, "elsewhere.json"), JSON.stringify({ items: 9 }));
    symlinkSync(join(dir, "elsewhere.json"), join(dir, "link.json"));
    expect(takeRunReceipt(join(dir, "link.json"))).toBeNull();
    expect(existsSync(join(dir, "elsewhere.json"))).toBe(true);
  });

  it("scrubs a receipt again when it is read", () => {
    const file = join(folder(), "r.json");
    writeFileSync(file, JSON.stringify({ error: "failed https://example.gov/a?sig=abc sb_secret_zzz" }));
    expect(takeRunReceipt(file)).toEqual({ error: "failed https://example.gov/a [credential]" });
  });

  it("sweeps receipts a crashed worker never read, and nothing else", () => {
    const dir = folder();
    const old = Date.now() / 1000 - 2 * 86400;
    for (const name of ["old.json", "old.json.part", "notes.txt"]) {
      writeFileSync(join(dir, name), "{}");
      utimesSync(join(dir, name), old, old);
    }
    writeFileSync(join(dir, "fresh.json"), "{}");
    expect(sweepRunReceipts(dir)).toBe(2);
    expect(["old.json", "old.json.part", "notes.txt", "fresh.json"].map((n) => existsSync(join(dir, n)))).toEqual([false, false, true, true]);
    expect(sweepRunReceipts(join(dir, "missing"))).toBe(0);
  });
});
