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
    expect(listed.length).toBeGreaterThan(1800);
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

  it("covers the whole research universe apart from a short known list", () => {
    const missing = COVERAGE.map((c) => c.ticker).filter((t) => !logoUrl(t));
    expect(missing.length).toBeLessThanOrEqual(7);
  });
});
