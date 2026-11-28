// Statement sections against the printed tables, on real rows of JPM's 3Q26 supplement and releases and
// HON's 3Q26 release: a section holds exactly the rows its table prints, in printed order, with its own
// printing's figures; other documents' lines stay out of it; the page order follows the main document.
import { describe, expect, it } from "vitest";
import jpm from "@/lib/ir/fixtures/statements/jpm-3q26.json";
import hon from "@/lib/ir/fixtures/statements/hon.json";
import { applyLabelMap, rawKey, type IrFact, type LabelMapEntry } from "@/lib/ir/kpis";
import { buildPayload, type IrPayload, type PayloadCell, type PayloadSeries } from "@/lib/ir/payload";
import type { TableCaption } from "@/lib/ir/table-captions";
import { assembleStatements, lineLabel, printedDecimals, printedFigure, printedSuffix, rowCells, rowLabel, sameRows, tableTitle, withCaptions, shownScale, type Statement, type StatementRow } from "@/lib/ir/statements";

interface Fixture {
  ticker: string;
  facts: (IrFact & { dropped?: boolean })[];
  captions: Record<string, TableCaption[]>;
}

/**
 * JPM as production builds it: the stored label map dropped the facts marked `dropped` (their raw keys carry
 * `drop: true`), the rest were read through the map already. The build applies the map to the dropped ones.
 */
async function jpmPayload(): Promise<IrPayload> {
  const fx = jpm as unknown as Fixture;
  const map: Record<string, LabelMapEntry> = {};
  const dropped = fx.facts.filter((f) => f.dropped);
  for (const f of dropped)
    map[rawKey(f)] = { category: f.category, metric: f.metric, label: f.label, parent: null, is_total: false, drop: true };
  const facts = [...fx.facts.filter((f) => !f.dropped), ...applyLabelMap(dropped, map)];
  const p = buildPayload(fx.ticker, facts);
  return withCaptions(p, async (d) => fx.captions[p.docs[d].id]);
}

async function honPayload(): Promise<IrPayload> {
  const fx = hon as unknown as Fixture;
  const p = buildPayload(fx.ticker, fx.facts);
  return withCaptions(p, async (d) => fx.captions[p.docs[d].id]);
}

const lineRows = (sec: Statement) =>
  sec.rows.filter((r): r is Extract<StatementRow, { kind: "line" }> => r.kind === "line");

/** "label: figure" as the section prints the row for one quarter. */
function printed(p: IrPayload, sec: Statement, end: string) {
  const by = new Map(p.series.map((s) => [s.k, s]));
  return lineRows(sec).map((r) => {
    const s = by.get(r.k)!;
    const c = rowCells(r.ks, by, "q", r.at).cells[end];
    const f = c ? printedFigure(c.v, s.unit === "usd" ? sec.div : 1, printedDecimals(s), printedSuffix(s)) : "-";
    return `${r.total ? "*" : ""}${rowLabel(r, by)}: ${f}`;
  });
}

describe("label map", () => {
  it("a drop never removes a figure printed in a table cell; slide and sentence figures are still dropped", () => {
    const base = {
      document_id: "d",
      document_kind: "supplement",
      category: "product",
      metric: "revenue",
      breakdown: "Revenue by type",
      parent: "Noninterest revenue",
      label: "Investment banking fees",
      is_total: false,
      period_start: "2026-07-01",
      period_end: "2026-09-30",
      months: 3,
      value: 2960e6,
      unit: "usd",
      method: "table",
    } as unknown as IrFact;
    const cell = { ...base, locator: { t: 3, r: 9, c: 2, text: "2,960" } } as IrFact;
    const slide = { ...base, method: "vision", locator: { page: 1, box: [0, 0, 1, 1], text: "$3.0B" } } as IrFact;
    const map = { [rawKey(cell)]: { category: "product", metric: "revenue", label: "x", parent: null, is_total: false, drop: true } };
    expect(applyLabelMap([cell, slide], map)).toEqual([cell]);
  });
});

describe("JPM 3Q26 supplement, table by table against the SEC copy", () => {
  it("income statement: the rows table 3 prints, in printed order, with the printed 3Q26 figures", async () => {
    const p = await jpmPayload();
    const sec = assembleStatements(p).find((s) => s.title === "Consolidated statements of income")!;
    expect(sec.group).toBe("main");
    // Printed rows 9 to 49 of the SEC copy that the reader stored (interest income and expense, provision,
    // taxes, net income and per-share rows were not read into ir_kpi_facts).
    expect(printed(p, sec, "2026-09-30")).toEqual([
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
      "Occupancy expense: 1,525",
      "Technology, communications and equipment expense: 3,335",
      "Professional and outside services: 3,897",
      "Marketing: 1,917",
      "Other expense: 1,849",
      "*TOTAL NONINTEREST EXPENSE: 27,295",
      "Return on common equity: 17%",
      "Return on tangible common equity: 20%",
      "Return on assets: 1.21%",
      "Overhead ratio: 54%",
    ]);
    // Every row is a printed row of table 3, in the table's order.
    const at = lineRows(sec).map((r) => r.at);
    expect(at.every((x) => x?.[1] === 3)).toBe(true);
    expect(at.map((x) => x![2])).toEqual([9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 22, 23, 28, 29, 30, 31, 32, 33, 34, 45, 46, 47, 49]);
  });

  it("segment results: only table 8's rows; the release's managed-basis revenue and return rows stay out", async () => {
    const p = await jpmPayload();
    const secs = assembleStatements(p);
    const sec = secs.find((s) => s.title === "Segment & corporate results - managed basis")!;
    const rows = lineRows(sec);
    const printedRows = [10, 11, 12, 13, 14, 17, 18, 19, 20, 21, 24, 25, 26, 27, 28, 31, 32, 33, 34, 35, 38, 39, 40, 41, 42];
    expect(rows.map((r) => r.at![2])).toEqual(printedRows);
    expect(printed(p, sec, "2026-09-30")).toEqual([
      "Consumer & Community Banking: 21,171",
      "Commercial & Investment Bank: 22,734",
      "Asset & Wealth Management: 6,909",
      "Corporate: 93",
      "*TOTAL NET REVENUE: 50,907",
      "Consumer & Community Banking: 11,580",
      "Commercial & Investment Bank: 10,771",
      "Asset & Wealth Management: 4,358",
      "Corporate: 586",
      "*TOTAL NONINTEREST EXPENSE: 27,295",
      "Consumer & Community Banking: 9,591",
      "Commercial & Investment Bank: 11,963",
      "Asset & Wealth Management: 2,551",
      "Corporate: (493)",
      "*Pre-provision profit: 23,612",
      "Consumer & Community Banking: 2,026",
      "Commercial & Investment Bank: 663",
      "Asset & Wealth Management: 84",
      "Corporate: (30)",
      "*Provision for credit losses: 2,743",
      "Consumer & Community Banking: 5,670",
      "Commercial & Investment Bank: 8,247",
      "Asset & Wealth Management: 1,843",
      "Corporate: (455)",
      "*Total net income: 15,305",
    ]);
    // The release's copy of the table prints lines the supplement's does not: listed apart, collapsed.
    const apart = secs.find((s) => s.id === `${sec.id}~old`)!;
    expect(apart.group).toBe("more");
    const by = new Map(p.series.map((s) => [s.k, s]));
    expect(lineRows(apart).map((r) => lineLabel(by.get(r.k)!))).toEqual(
      expect.arrayContaining(["Return on common equity", "Return on tangible common equity"]),
    );
  });

  it("page order: the supplement's tables in its order, then the releases' own tables marked, then the rest", async () => {
    const p = await jpmPayload();
    const secs = assembleStatements(p);
    const groups = secs.map((s) => s.group);
    expect(groups.indexOf("other")).toBeGreaterThan(groups.lastIndexOf("main"));
    expect(groups.indexOf("more")).toBeGreaterThan(groups.lastIndexOf("other"));
    const main = secs.filter((s) => s.group === "main");
    expect(main.map((s) => s.title)).toEqual([
      "Consolidated financial highlights, continued",
      "Consolidated statements of income",
      "Segment & corporate results - managed basis",
    ]);
    expect(main.every((s) => p.docs[s.doc].kind === "supplement")).toBe(true);
    for (const s of secs.filter((x) => x.group === "other"))
      expect(s.source ?? "supplement").toMatch(/earnings release|supplement|presentation/);
    // Nothing is lost: every line a table places is in some section.
    const placed = new Set(secs.flatMap((s) => lineRows(s).flatMap((r) => r.ks)));
    const tableLines = p.series.filter((s) => Object.values(s.q).some((c) => Array.isArray(c.l)));
    expect(tableLines.filter((s) => !placed.has(s.k))).toEqual([]);
  });
});

describe("a section shows its own table's printing", () => {
  it("HON segment data prints sales of 4,926 for 3Q25 where the summary the line shows prints 4,929", async () => {
    const p = await honPayload();
    const sec = assembleStatements(p).find((s) => s.title === "Segment data")!;
    const by = new Map(p.series.map((s) => [s.k, s]));
    const row = lineRows(sec).find((r) => lineLabel(by.get(r.k)!) === "Sales")!;
    const c = rowCells(row.ks, by, "q", row.at).cells["2025-09-30"];
    expect(c.v).toBe(4926e6);
    expect(c.x).toBe("4,926");
    expect(c.l).toEqual([7, 7, 4]);
    expect(c.own).toBe(true);
    // The summary table still shows its own 4,929.
    const summary = assembleStatements(p).find((s) => s.title === "Table 1: Summary of financial results")!;
    const top = lineRows(summary).find((r) => lineLabel(by.get(r.k)!) === "Sales")!;
    expect(rowCells(top.ks, by, "q", top.at).cells["2025-09-30"].v).toBe(4929e6);
  });

  it("small fragments are listed compactly under their own titles, never as sections of one or two rows", async () => {
    const p = await honPayload();
    const secs = assembleStatements(p);
    for (const s of secs.filter((x) => x.group !== "more" && x.id !== "small"))
      expect(lineRows(s).length).toBeGreaterThan(2);
    const small = secs.find((s) => s.id === "small")!;
    expect(small.titleFrom).toBe("merged");
    expect(small.rows.filter((r) => r.kind === "head").length).toBeGreaterThan(0);
  });
});

describe("printed scale", () => {
  const line = (k: string, x: string, v: number): PayloadSeries => ({
    k,
    cat: "product",
    met: "revenue",
    label: "Noninterest revenue",
    parent: null,
    total: false,
    unit: "usd",
    q: { "2025-09-30": { v, x, d: 0, l: [1, 2, 1] } },
    y: {},
  });
  it("a line printed in billions never joins, or fills, a row printed in millions", () => {
    const millions: PayloadSeries = {
      ...line("m", "23,136", 23136e6),
      q: { "2026-09-30": { v: 23136e6, x: "23,136", d: 1, l: [3, 19, 1] } },
    };
    const billions = line("b", "23.1", 23.1e9);
    const by = new Map([millions, billions].map((s) => [s.k, s]));
    expect(sameRows(["m", "b"], by, new Map())).toEqual([["m"], ["b"]]);
    expect(Object.keys(rowCells(["m", "b"], by, "q").cells)).toEqual(["2026-09-30"]);
  });
  it("a company that changed the scale it prints at keeps its history, in the finer figures only", () => {
    // Entegris' net sales: "$1,005.7" and "$883.2" in millions (2026 releases), "263,373" and "271,633" in
    // thousands (2016 releases).
    const sales: PayloadSeries = {
      ...line("s", "$1,005.7", 1005.7e6),
      label: "Net sales",
      q: {
        "2026-09-26": { v: 1005.7e6, x: "$1,005.7", d: 0, l: [2, 3, 1] },
        "2026-06-27": { v: 883.2e6, x: "$883.2", d: 0, l: [2, 3, 3] },
        "2015-03-28": { v: 263_373e3, x: "263,373", d: 1, l: [5, 3, 7] },
        "2014-12-31": { v: 271_633e3, x: "271,633", d: 2, l: [4, 3, 7] },
      },
    };
    const by = new Map([[sales.k, sales]]);
    const cells = rowCells(["s"], by, "q", [0, 2, 3]).cells;
    expect(Object.keys(cells).sort()).toEqual(["2014-12-31", "2015-03-28", "2026-06-27", "2026-09-26"]);
    expect(cells["2015-03-28"]).toMatchObject({ v: 263_373e3, x: "263,373" });
    // A thousands figure for a period between the row's own never joins them (two tables of the same years).
    const mixed: PayloadSeries = { ...sales, q: { ...sales.q, "2026-08-01": { v: 300_000e3, x: "300,000", d: 3, l: [9, 3, 1] } } };
    expect(Object.keys(rowCells(["s"], new Map([[mixed.k, mixed]]), "q", [0, 2, 3]).cells)).not.toContain("2026-08-01");
  });
});

describe("table titles", () => {
  it("a release's highlight sentence above a table is not its title", () => {
    expect(tableTitle("CONSOLIDATED STATEMENTS OF INCOME")).toBe(true);
    expect(tableTitle("Credit-related information, continued")).toBe(true);
    expect(tableTitle("Positive operating leverage of 5.3% yoy")).toBe(false);
    expect(tableTitle("• Wealth fees increased $16 million, primarily from growth in AUM.")).toBe(false);
  });
});

describe("the scale a row is shown at", () => {
  // Entegris' net sales, as printed: millions with one decimal in 2026, thousands in 2015 and 2016.
  const s: PayloadSeries = {
    k: "s",
    cat: "statement",
    met: "revenue",
    label: "Net sales",
    parent: null,
    total: false,
    unit: "usd",
    q: {},
    y: {},
  };
  const cell = (v: number, x: string): PayloadCell => ({ v, x, d: 0, l: [2, 3, 1] });
  const history: Record<string, PayloadCell> = {
    "2014-12-31": cell(271_633e3, "271,633"),
    "2015-03-28": cell(263_373e3, "263,373"),
    "2015-06-27": cell(280_709e3, "280,709"),
    "2015-09-26": cell(270_253e3, "270,253"),
    "2015-12-31": cell(266_786e3, "$266,786"),
    "2025-12-31": cell(823.9e6, "$823.9"),
    "2026-03-28": cell(811.9e6, "$811.9"),
    "2026-06-27": cell(883.2e6, "$883.2"),
    "2026-09-26": cell(1005.7e6, "$1,005.7"),
  };
  it("is that of its newest figures: millions with one decimal, though most of its history printed thousands", () => {
    expect(shownScale(history, s)).toEqual({ div: 1e6, dec: 1 });
  });
  it("is unchanged for a row printed at one scale throughout", () => {
    const thousands = Object.fromEntries(Object.entries(history).slice(0, 5));
    expect(shownScale(thousands, s)).toEqual({ div: 1e3, dec: 0 });
  });
});

describe("one printed row across releases that restate a comparative", () => {
  // Microsoft's product revenue (millions): the income statement's row 6 of table 4 in two releases, stored
  // under two table names by the readers. Fiscal 2017 quarters were restated for the new revenue standard.
  const mk = (k: string, bd: string, q: Record<string, [number, string]>): PayloadSeries => ({
    k,
    cat: "product",
    met: "revenue",
    label: "Product",
    parent: null,
    total: false,
    unit: "usd",
    bd,
    q: Object.fromEntries(Object.entries(q).map(([e, [v, x]]) => [e, { v: v * 1e6, x, d: 0, l: [4, 6, 2] }])),
    y: {},
  });
  const newer = mk("type", "Revenue by type", {
    "2016-12-31": [18273, "$18,273"],
    "2017-06-30": [16057, "$16,057"],
    "2017-12-31": [17926, "$17,926"],
    "2018-06-30": [17159, "$17,159"],
    "2020-12-31": [19460, "$19,460"],
    "2021-09-30": [16631, "$16,631"],
    "2021-12-31": [20779, "$20,779"],
    "2022-09-30": [15741, "$15,741"],
    "2025-09-30": [15922, "$15,922"],
    "2026-09-30": [14631, "$14,631"],
  });
  const older = mk("ps", "Revenue by product and service", {
    "2016-12-31": [16537, "$16,537"],
    "2017-06-30": [13769, "$13,769"],
    "2017-12-31": [17926, "$17,926"],
    "2018-06-30": [17159, "$17,159"],
    "2020-12-31": [19460, "$19,460"],
    "2021-09-30": [16631, "$16,631"],
    "2021-12-31": [20779, "$20,779"],
    "2022-09-30": [15741, "$15,741"],
    "2025-09-30": [15922, "$15,922"],
    "2025-12-31": [16451, "$16,451"],
    "2026-03-31": [15089, "$15,089"],
    "2026-06-30": [17234, "$17,234"],
  });
  const by = new Map([newer, older].map((x) => [x.k, x]));
  // The newest release (document 1) and the one before (document 0) print it at table 4, row 6.
  const places = new Map([
    ["type", new Set(["1:4:6"])],
    ["ps", new Set(["0:4:6"])],
  ]);
  it("is one row: seven of nine common quarters agree, two were restated", () => {
    expect(sameRows(["type", "ps"], by, places)).toEqual([["type", "ps"]]);
    const cells = rowCells(["type", "ps"], by, "q").cells;
    // The newest copy's figure stands where both print; the other copy fills the quarters only it prints.
    expect(cells["2016-12-31"].v).toBe(18273e6);
    expect(cells["2026-03-31"].v).toBe(15089e6);
    expect(Object.keys(cells)).toHaveLength(13);
  });
  it("stays two rows when most common figures differ (another basis), or on another row of the table", () => {
    const recast = mk("ps", "Revenue by product and service", Object.fromEntries(Object.entries(older.q).map(([e, c]) => [e, [Math.round((c.v / 1e6) * 1.2), "x"]])) as never);
    expect(sameRows(["type", "ps"], new Map([newer, recast].map((x) => [x.k, x])), places)).toEqual([["type"], ["ps"]]);
    const elsewhere = new Map([
      ["type", new Set(["1:4:6"])],
      ["ps", new Set(["0:4:9"])],
    ]);
    expect(sameRows(["type", "ps"], by, elsewhere)).toEqual([["type"], ["ps"]]);
  });
});
