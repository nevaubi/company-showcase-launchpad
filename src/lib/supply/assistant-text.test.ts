import { describe, expect, it } from "vitest";
import { focusGraph, type RiskLink } from "./core";
import { supplyNodeLine } from "./assistant-text";
import { currentRows } from "./trusted";

const row = (p: Partial<RiskLink>): RiskLink => ({
  id: Math.random().toString(36).slice(2), ticker: "NVDA", counterparty: "X", counterparty_ticker: null, counterparty_domain: null, relation: "partner",
  detail: "", share_pct: null, quote: "", accn: "0001-26-000001", doc: "d", form: "10-K", filed: "2026-03-02", amount_usd: null, single_source: false, regions: [], ...p,
});

describe("supplyNodeLine", () => {
  const rows = currentRows([
    row({ counterparty: "SB Energy Corp.", amount_usd: 105e9, quote: "We have guaranteed up to $105 billion of SB Energy Corp.'s obligations under the lease." }),
    row({ counterparty: "Kioxia", relation: "supplier", single_source: true, regions: ["Japan", "China"], quote: "We rely on Kioxia, a key supplier in Japan, for flash memory." }),
    row({ counterparty: "Microsoft", counterparty_ticker: "MSFT", relation: "customer", share_pct: 19, quote: "Sales to Microsoft accounted for 19% of total revenue." }),
  ]);
  const g = focusGraph("NVDA", rows, { NVDA: "NVIDIA", MSFT: "Microsoft" });
  const line = (name: string) => supplyNodeLine("NVDA", g.find((n) => n.name.startsWith(name))!, { NVDA: 200e9 });
  it("states what the sentence states, by kind, and links the selected name", () => {
    expect(line("SB Energy")).toContain("stated guarantee $105B, not a flow");
    expect(line("SB Energy")).toContain("open: /app/supply-chain?t=NVDA&sel=partner%3ASB+Energy+Corp.");
    expect(line("Microsoft")).toContain("stated share 19%");
    expect(line("Microsoft")).toContain("≈$38B (share × SEC 12-month revenue)");
  });
  it("tells sole source from a stated dependency and lists only named regions", () => {
    const k = line("Kioxia");
    expect(k).toContain("stated dependency (no sole-source wording)");
    expect(k).not.toContain("SINGLE SOURCE");
    expect(k).toContain("regions named: Japan");
    expect(k).not.toContain("China");
  });
});
