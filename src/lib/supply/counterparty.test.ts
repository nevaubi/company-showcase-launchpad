import { describe, expect, it } from "vitest";
import { byCounterparty, signalConfidence, type CpSignal } from "./counterparty";

const s = (o: Partial<CpSignal>): CpSignal => ({ id: "x", kind: "contract", counterparty: "TSMC", quote: "TSMC agrees", amount_usd: null, pct: null, period: null, speaker: null, source_kind: "exhibit", filed: "2025-01-01", accn: "a", ...o });

describe("counterparty confidence", () => {
  it("signed exhibit naming the party is high", () => expect(signalConfidence(s({}))).toBe("high"));
  it("exhibit with unnamed party is medium", () => expect(signalConfidence(s({ counterparty: "a customer" }))).toBe("medium"));
  it("call statement naming the party is medium", () => expect(signalConfidence(s({ kind: "call", source_kind: "transcript", speaker: "CFO" }))).toBe("medium"));
  it("call without speaker or name in quote is low", () => expect(signalConfidence(s({ kind: "call", source_kind: "transcript", quote: "our foundry partner" }))).toBe("low"));
});

describe("byCounterparty", () => {
  it("merges contracts and calls for one party with date range, skipping unnamed", () => {
    const g = byCounterparty([
      s({ id: "1", filed: "2024-03-01" }),
      s({ id: "2", kind: "call", source_kind: "transcript", speaker: "CEO", filed: "2025-06-01" }),
      s({ id: "3", counterparty: "unnamed customer" }),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0]).toMatchObject({ contracts: 1, calls: 1, first: "2024-03-01", last: "2025-06-01", confidence: "high" });
  });
});

describe("multi-party statements", () => {
  it("splits 'A; B' into separate counterparties", () => {
    const g = byCounterparty([s({ counterparty: "Roche; Lilly", quote: "Roche and Lilly" })]);
    expect(g.map((x) => x.name).sort()).toEqual(["Lilly", "Roche"]);
  });
});

import { quoteLink } from "./counterparty";
describe("quoteLink", () => {
  it("uses start,end fragment for long quotes and encodes hyphens", () => {
    const u = quoteLink("https://x.com/a#old", "one two three four five six seven eight nine ten eleven twelve-thirteen end");
    expect(u).toBe("https://x.com/a#:~:text=one%20two%20three%20four%20five%20six,eight%20nine%20ten%20eleven%20twelve%2Dthirteen%20end");
  });
});
