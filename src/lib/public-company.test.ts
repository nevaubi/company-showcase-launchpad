import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hydrateDataset } from "@/lib/financials/dataset";
import { buildPublicSnapshot, isPublicTicker, PUBLIC_TICKERS } from "./public-company";

const load = (t: string) =>
  hydrateDataset(JSON.parse(readFileSync(`src/test/fixtures/companies/${t}.json`, "utf8")));

describe("public sample companies", () => {
  it("every covered company is public, unknown tickers are not", () => {
    expect(["NVDA", "aapl", "BAC", "MSFT"].every(isPublicTicker)).toBe(true);
    expect(PUBLIC_TICKERS.length).toBeGreaterThan(1500);
    expect(isPublicTicker("ZZZZQ")).toBe(false);
  });
  it("takes a missing description from the coverage details and the industry from the coverage list", () => {
    const d = load("NVDA");
    const bare = {
      ...d,
      profile: { ...d.profile, description: undefined, sector: "Materials", industry: "Chemicals" },
    } as unknown as typeof d;
    const s = buildPublicSnapshot(bare, 5, { description: "Designs graphics and AI processors." });
    expect(s.description).toBe("Designs graphics and AI processors.");
    // a stale profile said Materials / Chemicals; the page follows the coverage list
    expect([s.sector, s.industry]).toEqual(["Information Technology", "Semiconductors"]);
    expect(buildPublicSnapshot(bare).description).toBeNull();
    // a description the profile carries wins
    expect(buildPublicSnapshot(d, 5, { description: "other" }).description).toBe(
      (d.profile as { description?: string }).description ?? "other",
    );
  });
  it("every shown value links to an SEC filing", () => {
    const s = buildPublicSnapshot(load("NVDA"));
    expect(s.lines.length).toBeGreaterThan(2);
    for (const l of s.lines)
      for (const v of l.values)
        expect(v.source?.url.startsWith("https://www.sec.gov/Archives/") || v.derived).toBeTruthy();
  });
});
