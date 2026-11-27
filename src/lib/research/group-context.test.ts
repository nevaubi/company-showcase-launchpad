import { describe, expect, it } from "vitest";
import type { GroupSummary, Overview } from "@/lib/sectors/groups";
import { industryWorkup } from "./group-context";

const bank: GroupSummary = {
  kind: "industry",
  name: "Banks",
  sector: "Financials",
  slug: "banks",
  n: 123,
  q: "2026Q3",
  mcap: null,
  returns: { cw: { "1M": 0 }, ew: { "1M": -0.02 }, spy: null, etf: null },
  latest: { rev_growth: ["2026Q3", 0.04, 80], ni_growth: ["2026Q2", null, 0] },
};
const overview: Overview = {
  generated: "2026-11-26",
  as_of: "2026-11-25",
  companies: [{ tk: "JPM", sector: "Financials", industry: "Banks" }],
  groups: [bank, { ...bank, kind: "sector", name: "Financials", slug: "financials" }],
  spy_returns: { "1M": 0.01 },
  metrics: { rev_growth: { name: "Revenue growth", unit: "pct" } },
  etf_rrg: {},
};

describe("industry evidence available to the research agent", () => {
  it("uses the stored issuer classification, market close and per-metric contributor count", () => {
    const out = industryWorkup(" jpm ", overview, [
      { ticker: "JPM", sector: "Other", industry: "Software" },
    ]);
    expect(out).toContain("/app/sectors/g/banks");
    expect(out).toContain("through 2026-11-25");
    expect(out).toContain(
      "1M cap-weighted 0.0% | equal-weighted −2.0% | SPY 1.0%, excess -1.00 pp",
    );
    expect(out).toContain("Revenue growth 4.0% | 2026Q3 | 80 contributing companies");
    expect(out).toContain("CET1");
    expect(out).not.toContain("ni_growth");
  });
  it("does not infer a missing group, benchmark return, or ambiguous industry", () => {
    const ov = {
      ...overview,
      spy_returns: {},
      groups: [bank, { ...bank, sector: "Other", slug: "other-banks" }],
    };
    expect(industryWorkup("unknown", ov, [])).toContain("No matching");
    expect(industryWorkup("banks", ov, [])).toContain("Multiple matching");
    expect(industryWorkup("other-banks", ov, [])).not.toContain("excess");
  });
});
