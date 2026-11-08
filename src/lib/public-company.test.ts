import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hydrateDataset } from "@/lib/financials/dataset";
import { buildPublicSnapshot, isPublicTicker } from "./public-company";

const load = (t: string) => hydrateDataset(JSON.parse(readFileSync(`src/test/fixtures/companies/${t}.json`, "utf8")));

describe("public sample companies", () => {
  it("only NVDA, AAPL and BAC are public", () => {
    expect(["NVDA", "aapl", "BAC"].every(isPublicTicker)).toBe(true);
    expect(isPublicTicker("MSFT")).toBe(false);
  });
  it("every shown value links to an SEC filing", () => {
    const s = buildPublicSnapshot(load("NVDA"));
    expect(s.lines.length).toBeGreaterThan(2);
    for (const l of s.lines) for (const v of l.values) expect(v.source?.url.startsWith("https://www.sec.gov/Archives/") || v.derived).toBeTruthy();
  });
});
