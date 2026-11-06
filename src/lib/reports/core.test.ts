import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { CompanyDataset } from "@/lib/financials/types";
import { buildReportData, isoWeek, money, pct } from "./facts";
import { normalizeOptions, variantKey } from "./kinds";
import { numbersIn, vetClaim, vetSections } from "./vet";
import type { Fact } from "./types";

const fact = (id: string, text: string): Fact => ({ id, area: "annual", text, ref: { kind: "market", label: "x", asOf: "2026-01-01" } });

describe("number extraction", () => {
  it("reads money, percentages and multiples and skips years, quarters and small counts", () => {
    const n = numbersIn("In FY2025 revenue reached $416.2B, up 6.4% in Q4 2025; P/E is 31.5x across 3 segments on 2025-09-27.");
    expect(n.map((x) => [x.kind, x.value])).toEqual([["money", 416.2e9], ["pct", 0.064], ["mult", 31.5]]);
  });
  it("understands written scales and negatives", () => {
    expect(numbersIn("a loss of -$1.5 billion")[0].value).toBeCloseTo(-1.5e9);
  });
});

describe("claim vetting", () => {
  const facts = new Map([["F1", fact("F1", "FY2025 revenue: $416.2B.")], ["F2", fact("F2", "FY2025 revenue growth vs FY2024: +6.4%.")]]);
  const nums = new Map([...facts].map(([k, f]) => [k, numbersIn(f.text)]));

  it("keeps sentences whose numbers match the cited facts", () => {
    const r = vetClaim({ text: "Revenue was $416.2B. Growth was 6.4%.", factIds: ["F1", "F2"] }, facts, nums);
    expect(r.claim?.text).toBe("Revenue was $416.2B. Growth was 6.4%.");
    expect(r.verified).toBe(2);
  });
  it("adds the right citation when the model cited the wrong fact", () => {
    const r = vetClaim({ text: "Growth was +6.4%.", factIds: ["F1"] }, facts, nums);
    expect(r.claim?.factIds.sort()).toEqual(["F1", "F2"]);
  });
  it("drops a sentence with an invented number but keeps the rest", () => {
    const r = vetClaim({ text: "Revenue was $416.2B. Margins should reach 48.0% next year.", factIds: ["F1"] }, facts, nums);
    expect(r.claim?.text).toBe("Revenue was $416.2B.");
    expect(r.removed).toHaveLength(1);
  });
  it("drops a claim with numbers but no valid citation", () => {
    const r = vetClaim({ text: "Revenue was $999.0B.", factIds: ["F9"] }, facts, nums);
    expect(r.claim).toBeNull();
  });
  it("removes empty sections without tables", () => {
    const { sections, qa } = vetSections([{ id: "a", paragraphs: [{ text: "Up to $5.5T.", factIds: [] }], bullets: [] }], [{ id: "a", title: "A" }, { id: "b", title: "B", tables: ["t"] }], [...facts.values()], new Set(["t"]));
    expect(sections.map((s) => s.id)).toEqual(["b"]);
    expect(qa.removed.length).toBe(1);
  });
});

describe("options", () => {
  it("defaults map to the shared base variant and customizations get a stable key", () => {
    expect(variantKey(normalizeOptions("primer", {}))).toBe("base");
    const a = variantKey(normalizeOptions("primer", { length: "deep", focus: "AI capex" }));
    expect(a).toMatch(/^v/);
    expect(variantKey(normalizeOptions("primer", { length: "deep", focus: "  AI   capex " }))).toBe(a);
  });
  it("drops unknown sections and values", () => {
    const o = normalizeOptions("preview", { sections: ["street", "nope"], length: "huge" as never });
    expect(o.sections).toEqual(["street"]);
    expect(o.length).toBe("standard");
  });
});

describe("fact pack", () => {
  const d = hydrateDataset(JSON.parse(readFileSync("public/data/companies/AAPL.json", "utf8")) as CompanyDataset);
  const built = buildReportData({ today: "2026-11-06", data: d, price: { price: 200, asOf: "2026-11-05" }, estimates: null, promises: null, reactions: null, coverage: null });

  it("gives every fact a source and builds the summary tables", () => {
    expect(built.facts.length).toBeGreaterThan(60);
    for (const f of built.facts) expect(f.ref).toBeTruthy();
    const fin = built.tables.find((t) => t.id === "financials")!;
    expect(fin.columns).toHaveLength(5);
    expect(fin.rows[0].cells.every((c) => c?.ref)).toBe(true);
  });
  it("states annual revenue exactly as the SEC value", () => {
    const rev = d.statements.annual.income.rows.find((r) => r.key === "revenue")!;
    const last = rev.cells[d.statements.annual.income.periods.length - 1]!;
    expect(built.facts.some((f) => f.text.includes(money(last.v)) && f.ref.kind === "sec")).toBe(true);
  });
  it("derives market cap from price and SEC shares", () => {
    const f = built.facts.find((x) => x.text.startsWith("Market capitalization"))!;
    expect(f.ref.kind).toBe("derived");
  });
  it("versions by filing and week", () => {
    expect(built.dataVersion.endsWith(isoWeek("2026-11-06"))).toBe(true);
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
    expect(pct(0.0641, true)).toBe("+6.4%");
  });
});
