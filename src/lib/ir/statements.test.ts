import { describe, expect, it } from "vitest";
import jpm from "@/lib/ir/fixtures/statements/jpm.json";
import aapl from "@/lib/ir/fixtures/statements/aapl.json";
import hon from "@/lib/ir/fixtures/statements/hon.json";
import { buildPayload, type IrPayload, type PayloadSeries } from "@/lib/ir/payload";
import type { IrFact } from "@/lib/ir/kpis";
import type { TableCaption } from "@/lib/ir/table-captions";
import { assembleStatements, currentCut, lineLabel, printedDecimals, printedDiv, printedFigure, printedSuffix, rowCells, statementAnchors, visibleRows, withCaptions, type Statement, type StatementRow } from "@/lib/ir/statements";

interface Fixture {
  ticker: string;
  facts: IrFact[];
  captions: Record<string, TableCaption[]>;
}

async function payloadOf(fx: Fixture): Promise<IrPayload> {
  const p = buildPayload(fx.ticker, fx.facts);
  return withCaptions(p, async (d) => fx.captions[p.docs[d].id]);
}

const lines = (sec: Statement) => sec.rows.filter((r): r is Extract<StatementRow, { kind: "line" }> => r.kind === "line");

/** The section's lines as "label: figure in the newest quarter", printed the way the section prints them. */
function printedRows(p: IrPayload, sec: Statement, end: string) {
  const by = new Map(p.series.map((s) => [s.k, s]));
  return lines(sec).map((r) => {
    const s = by.get(r.k)!;
    const c = rowCells(r.ks, by, "q").cells[end];
    return `${r.total ? "*" : ""}${lineLabel(s)}: ${c ? printedFigure(c.v, s.unit === "usd" ? sec.div : 1, printedDecimals(s), printedSuffix(s)) : "-"}`;
  });
}

describe("statement sections from real rows", () => {
  it("JPM: the income statement and segment results as the 3Q26 supplement prints them, named by their printed titles", async () => {
    const p = await payloadOf(jpm as unknown as Fixture);
    const secs = assembleStatements(p);
    expect(secs.map((s) => s.title).slice(0, 2)).toEqual(["Consolidated statements of income", "Segment & corporate results - managed basis"]);
    expect(secs[0].titleFrom).toBe("printed");
    expect(secs[0].unitLine).toBe("In millions, except per share and ratio data");
    expect(secs[0].div).toBe(1e6);
    // Rows in printed order (table 3 of the supplement, rows 9 to 34), totals marked, values as printed for 3Q26.
    expect(printedRows(p, secs[0], "2026-09-30").slice(0, 13)).toEqual([
      "Investment banking fees: 2,960",
      "Principal transactions: 6,516",
      "Lending- and deposit-related fees: 2,579",
      "Asset management fees: 5,897",
      "Commissions and other fees: 2,584",
      "Investment securities gains/(losses): (658)",
      "Mortgage fees and related income: 274",
      "Card income: 1,428",
      "Other income: 1,556",
      "*Noninterest revenue: 23,136",
      "Net interest income: 27,036",
      "*TOTAL NET REVENUE: 50,172",
      "Compensation expense: 14,772",
    ]);
    // Children indented under their totals; the document's headings and spacer bands kept.
    const ib = lines(secs[0]).find((r) => r.k.includes("investment banking"))!;
    expect(ib.depth).toBe(2);
    expect(secs[0].rows.some((r) => r.kind === "head" && r.text === "Noninterest expense")).toBe(true);
    expect(secs[0].rows.some((r) => r.kind === "gap")).toBe(true);
  });

  it("JPM: the 3Q25 supplement's copy of each table is stitched on, so a line carries both documents' quarters", async () => {
    const p = await payloadOf(jpm as unknown as Fixture);
    const secs = assembleStatements(p);
    expect(secs[0].docs).toBe(2);
    expect(secs[0].first).toBe("2024-09-30");
    const by = new Map(p.series.map((s) => [s.k, s]));
    const seg = secs[1];
    // "Noninterest expense by segment" was filed under two stored identities (cost in 2026, segment in 2025):
    // one printed row with nine quarters, and the segment table keeps its printed total.
    const ccb = lines(seg).filter((r) => lineLabel(by.get(r.k)!) === "Consumer & Community Banking");
    expect(ccb).toHaveLength(5);
    const nie = ccb.find((r) => r.ks.some((k) => k.includes("noninterest expense")))!;
    expect(Object.keys(rowCells(nie.ks, by, "q").cells).sort()).toEqual(["2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"]);
    expect(rowCells(nie.ks, by, "q").cells["2024-09-30"].v).toBe(9586000000);
    expect(rowCells(nie.ks, by, "q").cells["2026-09-30"].v).toBe(11580000000);
    expect(printedRows(p, seg, "2026-09-30")).toContain("*TOTAL NONINTEREST EXPENSE: 27,295");
  });

  it("AAPL: one table prints the statement and both breakdowns; a total printed three times is three rows", async () => {
    const p = await payloadOf(aapl as unknown as Fixture);
    const secs = assembleStatements(p);
    expect(secs).toHaveLength(1);
    expect(secs[0].title).toBe("Condensed consolidated statements of operations");
    const rows = printedRows(p, secs[0], "2026-09-26");
    expect(rows.filter((r) => r === "*Total net sales: 114,477")).toHaveLength(3);
    expect(rows.indexOf("Americas: 48,680")).toBeGreaterThan(rows.indexOf("*Total operating expenses: 19,189"));
    expect(rows.at(-1)).toBe("*Total net sales: 114,477");
    expect(secs[0].rows.some((r) => r.kind === "head" && r.text === "Operating expenses")).toBe(true);
  });

  it("HON: the release's tables in their printed order and names", async () => {
    const p = await payloadOf(hon as unknown as Fixture);
    const titles = assembleStatements(p).map((s) => s.title);
    expect(titles.slice(0, 5)).toEqual(["Table 1: Summary of financial results", "Table 2: Summary of segment financial results", "Consolidated statement of operations", "Segment data", "Reconciliation of segment profit to income before taxes"]);
    const ops = assembleStatements(p)[2];
    expect(printedRows(p, ops, "2026-09-30")).toEqual([
      "Product sales: 3,628",
      "Service sales: 1,366",
      "*Net sales: 4,994",
      "Cost of products sold: 2,127",
      "Cost of services sold: 849",
      "*Total Cost of products and services sold: 2,976",
      "Research and development expenses: 239",
      "Selling, general and administrative expenses: 1,039",
      "Other (income) expense: (389)",
      "*Total costs, expenses and other: 4,008",
    ]);
  });

  it("captions only for anchor tables, and a payload without captions names sections by the stored table name", async () => {
    const fx = jpm as unknown as Fixture;
    const bare = buildPayload(fx.ticker, fx.facts);
    expect(statementAnchors(bare).map((a) => `${a.d}:${a.t}`)).toEqual(["0:3", "0:8"]);
    const secs = assembleStatements(bare);
    expect(secs[0].titleFrom).toBe("breakdown");
    expect(secs[0].unitLine).toBe("Dollars in millions");
    const withCaps = await payloadOf(fx);
    expect(Object.keys(withCaps.tables ?? {})).toEqual(["0:3", "0:8"]);
  });

  it("current series hides lines last printed more than fifteen months before the newest period", async () => {
    const p = await payloadOf(jpm as unknown as Fixture);
    const by = new Map(p.series.map((s) => [s.k, s]));
    const sec = assembleStatements(p)[0];
    const cut = currentCut(p);
    expect(cut).toBe("2025-07-02");
    const all = visibleRows(sec, by, {});
    const cur = visibleRows(sec, by, { cut });
    expect(all.hidden).toBe(0);
    expect(cur.rows.filter((r) => r.kind === "line").length).toBeLessThanOrEqual(all.rows.filter((r) => r.kind === "line").length);
    // A search keeps the matching line and the totals above it, and no heading without a line under it.
    const hit = visibleRows(sec, by, { match: (s) => /card income/i.test(s.label) });
    const shown = hit.rows.filter((r) => r.kind === "line").map((r) => lineLabel(by.get((r as { k: string }).k)!));
    expect(shown).toEqual(["Card income", "Noninterest revenue", "TOTAL NET REVENUE"]);
    expect(hit.rows[0].kind).not.toBe("gap");
  });
});

describe("printed figures", () => {
  const s = (unit: string, xs: string[]): PayloadSeries => ({ k: "x", cat: "kpi", met: "other", label: "x", parent: null, total: false, unit, q: Object.fromEntries(xs.map((x, i) => [`2026-0${i + 1}-30`, { v: 1, x }])), y: {} });
  it("formats in the printed scale, decimals and mark, negatives in parentheses", () => {
    expect(printedFigure(-658e6, 1e6, 0, "")).toBe("(658)");
    expect(printedFigure(50172e6, 1e6, 0, "")).toBe("50,172");
    expect(printedFigure(1.7, 1, 2, "%")).toBe("1.70%");
    expect(printedFigure(-0.4, 1, 1, "%")).toBe("(0.4)%");
    expect(printedFigure(0, 1e6, 0, "")).toBe("0");
  });
  it("reads the scale from value and printed text, decimals and marks from the printed cells", () => {
    expect(printedDiv({ v: 2960e6, x: "2,960" })).toBe(1e6);
    expect(printedDiv({ v: -658e6, x: "(658)" })).toBe(1e6);
    expect(printedDiv({ v: 4994e6, x: "$4,994" })).toBe(1e6);
    expect(printedDiv({ v: 5, x: "n/m" })).toBeNull();
    expect(printedDecimals(s("pct", ["1.21", "1.70", "1.41"]))).toBe(2);
    expect(printedSuffix(s("pct", ["21.3%", "17.6%"]))).toBe("%");
    expect(printedSuffix(s("ratio", ["1.2x", "1.4x"]))).toBe("×");
    expect(printedSuffix(s("count", ["120", "130"]))).toBe("");
  });
});
