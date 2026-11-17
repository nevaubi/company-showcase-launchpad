import { describe, expect, it } from "vitest";
import { crossCheck, dropTableDuplicates, proseBlocks, proseFacts, proseTokens, quoteOf, renderProse, type ProseOutput, type ProseRow } from "./prose-core";

const RELEASE = `<html><body>
<p>ISSAQUAH, Wash., Sept. 24, 2026 -- Costco Wholesale Corporation today announced its results for the fourth quarter (16 weeks) ended August 31, 2026.</p>
<p>Net sales for the quarter increased 11.2 percent, to $93.9 billion, from $84.4 billion last year.</p>
<p>Costco currently operates 939 warehouses, including 647 in the United States and Puerto Rico, 115 in Canada.</p>
<table><tr><td>Net sales</td><td>93,900</td><td>84,400</td></tr><tr><td>Membership fees</td><td>1,724</td><td>1,512</td></tr><tr><td>Total revenue</td><td>95,624</td><td>85,912</td></tr></table>
<table><tr><td>&#8226;</td><td>Paid members reached 81.0 million at quarter-end.</td></tr></table>
<p>The company employs more than 300,000 people and serves approximately 70 million members.</p>
<p>Operating cash flow of $1.7 billion. Adjusted operating cash flow in the September quarter of $1.7 billion.</p>
<p>The company will hold a conference call at 2:00 p.m. (PT). Call 1-800-555-1234.</p>
<p>Forward-Looking Statements</p>
<p>We expect 30 new warehouses in 2027.</p>
</body></html>`;

describe("reading figures in running text", () => {
  const blocks = proseBlocks(RELEASE);
  const tokens = proseTokens(blocks);
  const texts = tokens.map((t) => t.text);

  it("keeps sentences, drops data tables, keeps text in layout tables and stops at the safe-harbor section", () => {
    const all = blocks.map((b) => b.text).join(" | ");
    expect(all).toContain("Paid members reached 81.0 million");
    expect(all).not.toContain("95,624");
    expect(all).not.toContain("30 new warehouses");
  });
  it("marks figures with their scale words but not dates, years, times or phone numbers", () => {
    expect(texts).toEqual(expect.arrayContaining(["11.2 percent", "$93.9 billion", "$84.4 billion", "939", "647", "115", "81.0 million", "16"]));
    expect(texts).not.toContain("2026");
    expect(texts).not.toContain("24");
    expect(texts).not.toContain("2:00");
    expect(texts.some((t) => t.includes("555"))).toBe(false);
    const b = tokens.find((t) => t.text === "$93.9 billion")!;
    expect(b.v * b.scale!).toBeCloseTo(93.9e9);
  });
  it("renders each number behind its id", () => {
    const n = tokens.find((t) => t.text === "939")!.n;
    expect(renderProse(blocks, tokens)).toContain(`operates ⟦n${n}⟧939 warehouses`);
  });

  const id = (t: string) => tokens.find((x) => x.text === t)!.n;
  const out: ProseOutput = {
    periods: [
      { p: 0, period_start: "", period_end: "2026-08-31", months: 0 },
      { p: 1, period_start: "2026-05-11", period_end: "2026-08-31", months: 3 },
    ],
    rows: [
      { label: "Warehouses", parent: "", breakdown: "Warehouses by country", category: "geography", metric: "stores", unit: "count", scale: 1, is_total: true, values: [{ n: id("939"), p: 0, read: "939" }] },
      { label: "United States and Puerto Rico — warehouses", parent: "Warehouses", breakdown: "Warehouses by country", category: "geography", metric: "stores", unit: "count", scale: 1, is_total: false, values: [{ n: id("647"), p: 0, read: "647" }] },
      { label: "Paid members", parent: "", breakdown: "Membership", category: "kpi", metric: "users", unit: "count", scale: 1, is_total: false, values: [{ n: id("81.0 million"), p: 0, read: "81.0 million" }] },
      // misread digits, a percentage filed as money, an invented id
      { label: "Canada — warehouses", parent: "Warehouses", breakdown: "Warehouses by country", category: "geography", metric: "stores", unit: "count", scale: 1, is_total: false, values: [{ n: id("115"), p: 0, read: "116" }] },
      { label: "Net sales growth", parent: "", breakdown: "", category: "kpi", metric: "revenue", unit: "usd", scale: 1, is_total: false, values: [{ n: id("11.2 percent"), p: 1, read: "11.2 percent" }] },
      { label: "Ghost", parent: "", breakdown: "", category: "kpi", metric: "other", unit: "count", scale: 1, is_total: false, values: [{ n: 999, p: 0, read: "5" }] },
    ],
  };
  const { rows, rejected } = proseFacts(out, blocks, tokens, "2026-09-24");

  it("re-reads every value from its token and applies the printed scale word", () => {
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Warehouses", 939],
      ["United States and Puerto Rico — warehouses", 647],
      ["Paid members", 81e6],
    ]);
    expect(rejected).toBe(3);
  });
  it("cites the sentence that states the figure, verbatim", () => {
    expect(rows[1].locator.q).toBe("Costco currently operates 939 warehouses, including 647 in the United States and Puerto Rico, 115 in Canada.");
    expect(rows[2].locator.q).toBe("Paid members reached 81.0 million at quarter-end.");
  });
  it("leaves figures the document also prints in a table to the table reader, within the printed rounding", () => {
    const rounded = { period_end: "2026-08-31", months: 3, value: 2.2e9, unit: "usd", tol: 0.05e9 };
    const count = { period_end: "2026-08-31", months: 0, value: 939, unit: "count", tol: 0.5 };
    expect(dropTableDuplicates([rounded, count], [{ period_end: "2026-08-31", months: 3, value: 2.151e9, unit: "usd" }])).toEqual([count]);
    // $2.2 billion is not $2.1 billion; 939 warehouses is not 938
    expect(dropTableDuplicates([rounded, count], [{ period_end: "2026-08-31", months: 3, value: 2.149e9, unit: "usd" }, { period_end: "2026-08-31", months: 3, value: 938, unit: "count" }])).toEqual([rounded, count]);
  });
  it("skips vague figures, keeps one figure per line and period, and keeps the period out of the line name", () => {
    const more: ProseRow = { label: "Employees", parent: "", breakdown: "", category: "kpi", metric: "headcount", unit: "count", scale: 1, is_total: false, values: [{ n: id("300,000"), p: 0, read: "300,000" }] };
    const cash = tokens.filter((t) => t.text === "$1.7 billion").map((t) => t.n);
    const flows = cash.map((n): ProseRow => ({ label: "Operating cash flow (September quarter)", parent: "", breakdown: "", category: "kpi", metric: "other", unit: "usd", scale: 1, is_total: false, values: [{ n, p: 1, read: "1.7" }] }));
    const got = proseFacts({ periods: out.periods, rows: [more, ...flows] }, blocks, tokens, "2026-09-24");
    expect(got.rows.map((r) => [r.label, r.value])).toEqual([["Operating cash flow", 1.7e9]]);
  });
  it("treats a dollar figure stated at quarter-end as a balance and drops labels that call a figure a forecast", () => {
    const b = proseBlocks("<p>Liquidity of $6.9 billion at quarter-end, including $3.1 billion in undrawn revolver capacity. Payments on debt of $1.2 billion. Operating margin was 34.6%, up from 28.2% last year.</p>");
    const t = proseTokens(b);
    const n = (x: string) => t.find((k) => k.text === x)!.n;
    const row = (label: string, x: string, unit: ProseRow["unit"] = "usd"): ProseRow => ({ label, parent: "", breakdown: "", category: "balance", metric: "other", unit, scale: 1, is_total: false, values: [{ n: n(x), p: 1, read: x }] });
    const got = proseFacts({ periods: out.periods, rows: [row("September quarter - Liquidity", "$6.9 billion"), row("Payments on debt", "$1.2 billion"), row("Q4 operating margin forecast", "28.2%", "pct")] }, b, t, "2026-09-24");
    expect(got.rows.map((r) => [r.label, r.months])).toEqual([["Liquidity", 0], ["Payments on debt", 3]]);
  });
  it("trims a very long sentence to the stretch around the figure", () => {
    const long = `${"word ".repeat(80)}the bank ended with 4,321 branches ${"more ".repeat(80)}.`;
    const q = quoteOf(long, { at: long.indexOf("4,321"), text: "4,321" });
    expect(q.length).toBeLessThanOrEqual(240);
    expect(q).toContain("4,321 branches");
  });
});

describe("crossCheck (two readers, same numbered text)", () => {
  const fact = (n: number, period_end: string, value: number, months = 3): import("./prose-core").ProseFact => ({
    category: "segment", metric: "revenue", breakdown: null, parent: null, is_total: false, label: `line ${n}`, period_label: "Q",
    period_start: null, period_end, months, value, unit: "usd", locator: { q: "s", text: String(value), n, b: 0 }, tol: 0,
  });
  it("keeps figures both readers date the same, drops figures they date differently", () => {
    const x = crossCheck([fact(1, "2025-11-23", 5), fact(2, "2025-11-23", 7)], [fact(1, "2025-11-23", 5), fact(2, "2025-08-31", 7)]);
    expect(x.rows.map((f) => f.locator.n)).toEqual([1]);
    expect(x.agreed).toBe(1);
    expect(x.conflicts).toBe(1);
    expect(x.both.size).toBe(1);
  });
  it("drops a figure the readers give different lengths, keeps what only one found", () => {
    const x = crossCheck([fact(1, "2025-12-31", 5, 3), fact(3, "2025-12-31", 9)], [fact(1, "2025-12-31", 5, 12), fact(4, "2025-12-31", 11)]);
    expect(x.rows.map((f) => f.locator.n).sort()).toEqual([3, 4]);
    expect(x.added).toBe(1);
    expect(x.conflicts).toBe(1);
  });
  it("treats a few days apart (52/53-week guess) as the same period", () => {
    expect(crossCheck([fact(1, "2025-11-30", 5)], [fact(1, "2025-11-26", 5)]).agreed).toBe(1);
  });
});

