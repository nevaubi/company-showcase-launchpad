import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COVERAGE } from "@/lib/coverage";
import { LOGO_FILES } from "@/lib/logos.generated";
import { logoManifest, render } from "../../../scripts/logo-manifest";
import { logoUrl } from "./company-logo";

const files = readdirSync("public/logos");

describe("bundled company logos", () => {
  it("the generated manifest matches public/logos (rerun bun scripts/logo-manifest.ts after adding a logo)", () => {
    expect(readFileSync("src/lib/logos.generated.ts", "utf8")).toBe(render(logoManifest(files)));
  });

  it("resolves every listed ticker to a file that exists", () => {
    const onDisk = new Set(files);
    const listed = Object.entries(LOGO_FILES).flatMap(([ext, list]) => list.split(" ").map((t) => ({ t, ext })));
    expect(listed.length).toBeGreaterThanOrEqual(COVERAGE.length);
    for (const { t, ext } of listed) {
      expect(logoUrl(t)).toBe(`/logos/${t}.${ext}`);
      expect(onDisk.has(`${t}.${ext}`)).toBe(true);
    }
  });

  it("is case-insensitive and returns nothing for a company without a bundled mark", () => {
    expect(logoUrl("aapl")).toBe("/logos/AAPL.svg");
    expect(logoUrl("LIN")).toBe("/logos/LIN.png");
    expect(logoUrl("BRK-B")).toMatch(/^\/logos\/BRK-B\.(svg|png|jpg)$/);
    expect(logoUrl("NOT-A-TICKER")).toBeUndefined();
  });

  it("has a mark for every covered company", () => {
    const missing = COVERAGE.map((c) => c.ticker).filter((t) => !logoUrl(t));
    expect(missing).toEqual([]);
  });

  it("records where every bundled mark came from", () => {
    const sources = JSON.parse(readFileSync("public/logos/sources.json", "utf8")) as Record<string, { file: string; source: string; url: string }>;
    const marks = files.filter((f) => f !== "sources.json");
    expect(Object.keys(sources).length).toBe(marks.length);
    for (const f of marks) {
      const entry = sources[f.slice(0, f.lastIndexOf("."))];
      expect(entry?.file, f).toBe(f);
      expect(entry.source.length, f).toBeGreaterThan(0);
    }
    // the seven marks added in round 3 come from each company's own site, never a logo directory
    for (const t of ["ADAM", "BRVE", "CSQR", "IOND", "MSGK", "STDN", "USLM"]) expect(sources[t].url, t).toMatch(/^https:\/\//);
  });
});
