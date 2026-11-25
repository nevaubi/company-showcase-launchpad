import { describe, expect, it } from "vitest";
import { COLLECTIONS } from "@/lib/sources/catalog";
import { COVERAGE } from "@/lib/coverage";
import { isAppPath } from "@/lib/research/site-map";
import { relatedPages } from "./related";

describe("related pages", () => {
  it("links only to pages the app has", () => {
    const sectors = new Set(COVERAGE.map((c) => c.sector));
    const tickers = new Set(COVERAGE.map((c) => c.ticker));
    for (const c of COLLECTIONS)
      for (const p of relatedPages(c.id)) {
        expect(isAppPath(p.href), p.href).toBe(true);
        const s = p.href.match(/^\/app\/sectors\/(.+)$/);
        if (s) expect(sectors.has(decodeURIComponent(s[1]))).toBe(true);
        const t = p.href.match(/^\/app\/companies\/([^/]+)\//);
        if (t) expect(tickers.has(t[1])).toBe(true);
      }
  });

  it("gives every publisher collection a way into the app, and the internal one none", () => {
    for (const c of COLLECTIONS) expect(relatedPages(c.id).length > 0).toBe(!c.internal);
  });
});
