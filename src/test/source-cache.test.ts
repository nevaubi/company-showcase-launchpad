import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { trimSourceCache } from "../../scripts/lib/source-cache";

describe("disposable source cache", () => {
  it("keeps the retrieval ledger and never follows links outside the cache", () => {
    const dir = mkdtempSync(join(tmpdir(), "source-cache-"));
    try {
      const cache = join(dir, "cache");
      mkdirSync(cache);
      writeFileSync(join(dir, "original.csv"), "permanent original");
      writeFileSync(join(cache, "manifest.jsonl"), "retrieval evidence");
      writeFileSync(join(cache, "copy.xml"), "disposable SEC copy");
      symlinkSync(join(dir, "original.csv"), join(cache, "outside.csv"));
      expect(trimSourceCache(cache, 0)).toEqual({ bytes: 0, removed: 1 });
      expect(existsSync(join(dir, "original.csv"))).toBe(true);
      expect(existsSync(join(cache, "manifest.jsonl"))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
