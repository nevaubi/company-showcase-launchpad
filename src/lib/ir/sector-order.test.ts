// Section kinds by sector, on the printed titles of real documents (JPM's 3Q26 supplement, Apple's Q4 FY26
// release) and SEC industry descriptions as the coverage list carries them.
import { describe, expect, it } from "vitest";
import aapl from "@/lib/ir/fixtures/statements/aapl.json";
import layout from "@/lib/ir/fixtures/statements/jpm-layout.json";
import { buildPayload, type IrPayload } from "@/lib/ir/payload";
import type { IrFact } from "@/lib/ir/kpis";
import type { TableCaption } from "@/lib/ir/table-captions";
import { assembleStatements, withCaptions } from "@/lib/ir/statements";
import { jumpGroups, missingHeadlines, missingStatements, sectionKind, sectorOf } from "@/lib/ir/sector-order";

describe("sectorOf", () => {
  it("reads the sector from SEC industry text", () => {
    expect(sectorOf("Financials", "National Commercial Banks")).toBe("bank");
    expect(sectorOf(null, "State Commercial Banks")).toBe("bank");
    expect(sectorOf("Financials", "Fire, Marine & Casualty Insurance")).toBe("insurer");
    expect(sectorOf(null, "Real Estate Investment Trusts")).toBe("reit");
    expect(sectorOf("Energy", "Petroleum Refining")).toBe("energy");
    expect(sectorOf(null, "Pharmaceutical Preparations")).toBe("health");
    expect(sectorOf(null, "Semiconductors & Related Devices")).toBe("technology");
    expect(sectorOf(null, "Electronic Computers")).toBe("technology");
    expect(sectorOf(null, "Beverages")).toBe("consumer");
    expect(sectorOf(null, "Aircraft Engines & Engine Parts")).toBe("industrial");
  });
});

describe("sectionKind", () => {
  const k = (title: string, sector = sectorOf(null, "National Commercial Banks")) => sectionKind({ title, cat: "kpi" }, sector);
  it("classifies a bank supplement's printed titles", () => {
    expect(k("Consolidated statements of income")).toBe("income");
    expect(k("Consolidated balance sheets")).toBe("balance");
    expect(k("Condensed average balance sheets and annualized yields")).toBe("average");
    expect(k("Segment & corporate results - managed basis")).toBe("segment");
    expect(k("Consumer & community banking, continued")).toBe("segment");
    expect(k("Credit-related information")).toBe("credit");
    expect(k("Capital and other selected balance sheet items")).toBe("capital");
    expect(k("Non-GAAP financial measures")).toBe("reconciliation");
    expect(k("Consolidated financial highlights")).toBe("highlights");
  });
  it("classifies other sectors' titles", () => {
    expect(k("Revenue for groups of similar products and services", "technology")).toBe("product");
    expect(k("Net sales by reportable segment", "technology")).toBe("segment");
    expect(k("Upstream production and realized prices", "energy")).toBe("production");
    expect(k("Revenue by geography", "consumer")).toBe("geography");
  });
});

describe("sections of real documents", () => {
  it("JPM: every section of tables 3 and 24 carries its kind and filter; the jump list leads with the income statement", () => {
    const p = layout as unknown as IrPayload;
    const secs = assembleStatements(p, { sector: "Financials", industry: "National Commercial Banks" });
    const inc = secs.find((s) => s.id === "2:3")!;
    expect(inc.kind).toBe("income");
    expect(inc.filter).toBe("profit");
    expect(secs.find((s) => s.id === "2:24")!.kind).toBe("credit");
    expect(jumpGroups(secs, "bank")[0].kind).toBe("income");
    // Only two of the supplement's tables are in this fixture: the others are expected and missing.
    expect(missingStatements(secs, "bank")).toEqual(["balance", "average", "segment", "capital"]);
    expect(missingHeadlines(p, secs, "bank")).toContain("CET1 ratio");
    expect(missingHeadlines(p, secs, "bank")).not.toContain("Return on tangible common equity");
  });
  it("AAPL: segment and category splits printed inside the statement of operations count as present", async () => {
    const fx = aapl as unknown as { ticker: string; facts: IrFact[]; captions: Record<string, TableCaption[]> };
    const p0 = buildPayload(fx.ticker, fx.facts);
    const p = await withCaptions(p0, async (d) => fx.captions[p0.docs[d].id]);
    const secs = assembleStatements(p, { industry: "Electronic Computers" });
    expect(missingStatements(secs, "technology")).toEqual([]);
  });
});

describe("bank headline measures under the names banks print them", () => {
  it("reads Bank of America's curly apostrophes and net interest yield, and JPMorgan's net yield", () => {
    // Labels as stored for BAC's and JPM's 3Q26 supplements.
    const labels = [
      "Return on average common shareholders’ equity",
      "Return on average tangible common shareholders’ equity",
      "Net interest yield",
      "NET YIELD ON INTEREST-EARNING ASSETS",
    ];
    const p = { series: labels.map((label, i) => ({ k: `k${i}`, label })) } as unknown as IrPayload;
    const missing = missingHeadlines(p, [{ keys: labels.map((_, i) => `k${i}`), group: "main" }], "bank");
    expect(missing).not.toContain("Return on equity");
    expect(missing).not.toContain("Return on tangible common equity");
    expect(missing).not.toContain("Net interest margin");
    const jpm = missingHeadlines(p, [{ keys: ["k3"], group: "main" }], "bank");
    expect(jpm).not.toContain("Net interest margin");
  });
});
