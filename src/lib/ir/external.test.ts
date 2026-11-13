import { describe, expect, it } from "vitest";
import { buildExternalPayload, mapUnit, type ExtDef, type ExtValue } from "./external";

const def = (kpi_id: string, extra: Partial<ExtDef> = {}): ExtDef => ({ kpi_id, name: kpi_id, category: "Segments", unit: "USD", parent_id: null, sums_to_parent: false, sort: 1, ...extra });
const val = (kpi_id: string, period_kind: ExtValue["period_kind"], period_end: string, value: number, extra: Partial<ExtValue> = {}): ExtValue => ({
  kpi_id, period_kind, period_end, fiscal_label: null, value, source_id: "d1", anchor: { quote: `${kpi_id} ${value}` }, derived: null, ...extra,
});
const docs = [{ id: "d1", url: "https://www.sec.gov/Archives/edgar/data/320193/000032019324000067/ex991.htm", title: "8-K", doc_type: "release", published: "2024-05-02" }];

describe("partner IR corpus payload", () => {
  it("keeps the printed quote and SEC accession for every printed value", () => {
    const p = buildExternalPayload("AAPL", [def("rev")], [val("rev", "Q", "2024-03-30", 90)], docs);
    const c = p.series[0].q["2024-03-30"];
    expect(c.x).toBe("rev 90");
    expect(p.docs[c.d!]).toMatchObject({ id: "x:d1", accn: "0000320193-24-000067", doc: "ex991.htm" });
  });

  it("carries the cited page and line into the source reference of a stored PDF", async () => {
    const { refOf } = await import("./display");
    const pdf = [{ id: "870cd58e44407ea9", url: "https://ir.example.test/1q05-earnings-supplement.pdf", title: "Q1 2005 Financial supplement", doc_type: "supplement", published: null }];
    const line = "Investment Banking Fees $ 993 $ 1,073 $ 879 $ 893 $ 692 ( 7) % 4 3 %";
    const p = buildExternalPayload("JPM", [def("ib_fees")], [val("ib_fees", "Q", "2004-03-31", 692_000_000, { source_id: pdf[0].id, anchor: { quote: line, page: 9 } })], pdf);
    const c = p.series[0].q["2004-03-31"];
    expect([c.x, c.p, c.sh]).toEqual([line, 9, undefined]);
    expect(refOf(p, c, "Investment banking fees")).toMatchObject({ irDoc: "x:870cd58e44407ea9", accn: "", search: "692", quote: line, page: 9 });
    // a worksheet anchor names the sheet instead of a page
    const w = buildExternalPayload("JPM", [def("ib_fees")], [val("ib_fees", "Q", "2004-03-31", 692_000_000, { source_id: pdf[0].id, anchor: { quote: "Investment banking fees 692", page: null, sheet: "Income Statement" } })], pdf);
    expect(refOf(w, w.series[0].q["2004-03-31"], "x")).toMatchObject({ sheet: "Income Statement", quote: "Investment banking fees 692" });
    expect(refOf(w, w.series[0].q["2004-03-31"], "x")).not.toHaveProperty("page");
  });

  it("derived quarters list their inputs as FY minus 9M", () => {
    const p = buildExternalPayload("AAPL", [def("capex")], [
      val("capex", "A", "2024-09-28", 100),
      val("capex", "Y", "2024-06-29", 70),
      val("capex", "Q", "2024-09-28", 30, { derived: { formula: "FY - 9M", inputs: [{ kind: "A", period_end: "2024-09-28" }, { kind: "Y", period_end: "2024-06-29" }] } }),
    ], docs);
    const f = p.series[0].q["2024-09-28"].f!;
    expect(f.formula).toBe("FY - 9M");
    expect(f.parts.map((x) => [x.v, x.sign])).toEqual([[100, 1], [70, -1]]);
  });

  it("checks parts that sum to their parent within 0.5%", () => {
    const p = buildExternalPayload("X", [def("tot"), def("a", { parent_id: "tot", sums_to_parent: true }), def("b", { parent_id: "tot", sums_to_parent: true })], [
      val("tot", "Q", "2024-03-31", 100), val("a", "Q", "2024-03-31", 60), val("b", "Q", "2024-03-31", 40),
      val("tot", "Q", "2024-06-30", 100), val("a", "Q", "2024-06-30", 60), val("b", "Q", "2024-06-30", 30),
    ], docs);
    expect(p.checks.map((c) => c.ok)).toEqual([true, false]);
  });

  it("finds the printed number inside a quoted table line", async () => {
    const { printedToken } = await import("./display");
    expect(printedToken("Americas $ 52,648 $ 50,430", 52_648_000_000)).toBe("52,648");
  });

  it("maps partner units to this site's units", () => {
    expect([mapUnit("USD"), mapUnit("%"), mapUnit("USD_per_share"), mapUnit("count")]).toEqual(["usd", "pct", "usdPerShare", "count"]);
  });
});
