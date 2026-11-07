import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { CompanyDataset } from "@/lib/financials/types";
import { REPORT_FORMAT, buildReportData, isoWeek, money, pct } from "./facts";
import { normalizeOptions, variantKey } from "./kinds";
import { companyAliases, numbersIn, vetClaim, vetSections } from "./vet";
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
  it("won't borrow a matching number from a fact about something else", () => {
    const f = new Map([["F6", fact("F6", "FY2025 revenue: $416.2B.")], ["F7", fact("F7", "Consensus next-fiscal-year EPS growth: +9.1%.")]]);
    const n = new Map([...f].map(([k, x]) => [k, numbersIn(x.text)]));
    expect(vetClaim({ text: "Services margin expanded 9.1%.", factIds: ["F6"] }, f, n).claim).toBeNull();
  });
  it("drops a sentence with an invented number but keeps the rest", () => {
    const r = vetClaim({ text: "Revenue was $416.2B. Margins should reach 48.0% next year.", factIds: ["F1"] }, facts, nums);
    expect(r.claim?.text).toBe("Revenue was $416.2B.");
    expect(r.removed).toHaveLength(1);
  });
  it("does not let a decline be verified by a gain of the same size", () => {
    const f = new Map([["F3", fact("F3", "Q3 EPS growth vs a year ago: -12.0%.")]]);
    const n = new Map([...f].map(([k, x]) => [k, numbersIn(x.text)]));
    expect(vetClaim({ text: "EPS fell 12.0% from a year ago.", factIds: ["F3"] }, f, n).claim?.text).toBe("EPS fell 12.0% from a year ago.");
    expect(vetClaim({ text: "EPS grew 12.0% from a year ago.", factIds: ["F3"] }, f, n).claim).toBeNull();
  });
  it("matches a net loss in words to a negative reported value, and ignores 'fell to' levels", () => {
    const f = new Map([["F4", fact("F4", "FY2025 net income: -$1.5B.")], ["F5", fact("F5", "Q3 free cash flow: $5.0B.")]]);
    const n = new Map([...f].map(([k, x]) => [k, numbersIn(x.text)]));
    expect(vetClaim({ text: "The company posted a net loss of $1.5B.", factIds: ["F4"] }, f, n).claim).not.toBeNull();
    expect(vetClaim({ text: "Free cash flow fell to $5.0B.", factIds: ["F5"] }, f, n).claim).not.toBeNull();
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
  describe("peer attribution", () => {
    const pf: Fact[] = [
      { id: "P1", area: "peers", text: "MSFT operating margin (four quarters through 2026-03-31): 47.1%.", ref: { kind: "derived", formula: "Operating income ÷ revenue", parts: [], label: "MSFT op margin", tk: "MSFT" } },
      { id: "S1", area: "peers", text: "AMZN operating margin (four quarters through 2026-03-31): 13.1%.", ref: { kind: "derived", formula: "Operating income ÷ revenue", parts: [], label: "AMZN op margin", tk: "AMZN" } },
    ];
    const run = (text: string) => vetSections([{ id: "a", paragraphs: [{ text, factIds: ["P1", "S1"] }], bullets: [] }], [{ id: "a", title: "A" }], pf, new Set(), new Set(), { ticker: "AMZN", peers: [{ ticker: "MSFT", name: "Microsoft Corp" }] });
    it("drops a peer's figure presented without naming the peer", () => {
      expect(run("Operating margin reached 47.1%.").sections).toEqual([]);
    });
    it("keeps it when the peer is named in the sentence or the one before", () => {
      expect(run("Microsoft's operating margin was 47.1%, against 13.1% here.").sections[0].paragraphs[0].text).toContain("47.1%");
      expect(run("The comparison is with MSFT. Its operating margin was 47.1%.").sections[0].paragraphs[0].text).toContain("47.1%");
    });
    it("never needs a name for the subject's own figures", () => {
      expect(run("Operating margin was 13.1%.").sections[0].paragraphs).toHaveLength(1);
    });
    it("builds distinctive aliases", () => {
      expect(companyAliases("MSFT", "Microsoft Corp")).toEqual(expect.arrayContaining(["MSFT", "Microsoft"]));
      expect(companyAliases("BAC", "Bank of America Corp")).not.toContain("Bank");
    });
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
  const d = hydrateDataset(JSON.parse(readFileSync("src/test/fixtures/companies/AAPL.json", "utf8")) as CompanyDataset);
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
    if (f.ref.kind !== "derived") return;
    expect(f.ref.market).toEqual([{ label: "Share price", value: 200, asOf: "2026-11-05" }]);
    expect(f.ref.parts.some((p) => p.label === "Shares outstanding")).toBe(true);
  });
  it("lists every input behind EV/Sales, not just revenue", () => {
    const f = built.facts.find((x) => x.text.startsWith("Enterprise value to trailing revenue"))!;
    if (f.ref.kind !== "derived") throw new Error("expected derived");
    const labels = f.ref.parts.map((p) => p.label);
    expect(labels).toContain("Shares outstanding");
    expect(labels).toContain("Cash");
    expect(labels.some((l) => /debt/i.test(l))).toBe(true);
    expect(f.ref.parts.some((p) => p.concept === "Revenues" || /Revenue/.test(p.concept))).toBe(true);
    expect(f.ref.market?.[0].value).toBe(200);
  });
  it("versions by filing, week and report format", () => {
    expect(built.dataVersion.split("|")).toContain(isoWeek("2026-11-06"));
    expect(built.dataVersion.split("|")).toContain(REPORT_FORMAT);
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
    expect(pct(0.0641, true)).toBe("+6.4%");
  });
});

describe("report presentation", () => {
  it("compresses citation runs", async () => {
    const { compressRefs } = await import("./present");
    expect(compressRefs([1, 2, 3, 4, 7, 9, 10])).toBe("1–4,7,9,10");
    expect(compressRefs([5, 3, 4, 3])).toBe("3–5");
  });
  it("shows ISO dates in prose as readable dates", async () => {
    const { readableDates } = await import("./present");
    expect(readableDates("expected on 2026-11-17.")).toBe("expected on Nov 17, 2026.");
  });
  it("labels price-based figures with the dated share price", async () => {
    const { refCaption } = await import("./present");
    expect(refCaption({ kind: "derived", formula: "Share price × shares outstanding", parts: [], label: "Market cap", market: [{ label: "Share price", value: 186.03, asOf: "2026-11-06" }] }))
      .toBe("Calculated · Share price × shares outstanding · uses share price $186.03 as of 2026-11-06 (market data)");
  });
});
