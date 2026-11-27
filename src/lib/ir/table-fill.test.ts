// Table fill on real printed tables: JPM's 3Q26 supplement (income statement, balance sheet, average
// balances and yields, capital, EPS page), CFG's 3Q26 supplement (ratio rows, superscript footnotes, dash
// rows) and Apple's Q4 FY26 release (statements of operations, balance sheet and cash flows), each cut
// from the public SEC copy with the stored facts that point into it (fixtures/fill/*.json name the source).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import jpmFx from "@/lib/ir/fixtures/fill/jpm-3q26.json";
import cfgFx from "@/lib/ir/fixtures/fill/cfg-3q26.json";
import aaplFx from "@/lib/ir/fixtures/fill/aapl-q4fy26.json";
import type { IrFact } from "@/lib/ir/kpis";
import { buildPayload } from "@/lib/ir/payload";
import { assembleStatements, rowCells, withCaptions } from "@/lib/ir/statements";
import { tableCaptions } from "@/lib/ir/table-captions";
import {
  cellValue,
  dashMeansZero,
  fillDocument,
  printedHead,
  FILL_METHOD,
} from "@/lib/ir/table-fill";
import { fillCompany, fillDocs, kindHint, qualityOf, withFill } from "@/lib/ir/table-fill-build";
import { parseGrid } from "@/lib/ir/table-grid";
import { parseTables } from "@/lib/ir/tables";

const html = (name: string) =>
  readFileSync(join(process.cwd(), "src/lib/ir/fixtures/fill", `${name}.htm`), "utf8");
const DOCS = {
  jpm: { html: html("jpm-3q26"), facts: jpmFx.facts as unknown as IrFact[] },
  cfg: { html: html("cfg-3q26"), facts: cfgFx.facts as unknown as IrFact[] },
  aapl: { html: html("aapl-q4fy26"), facts: aaplFx.facts as unknown as IrFact[] },
};
const fill = (k: keyof typeof DOCS) => {
  const { html: h, facts } = DOCS[k];
  return fillDocument({
    doc: facts[0].document_id!,
    html: h,
    facts,
    captions: new Map(tableCaptions(h).map((c) => [c.t, c])),
  });
};
const row = (fs: IrFact[], t: number, r: number) =>
  fs.filter((f) => (f.locator as { t: number }).t === t && (f.locator as { r: number }).r === r);
const at = (fs: IrFact[], end: string, months: number) =>
  fs.find((f) => f.period_end === end && f.months === months);

describe("parseGrid", () => {
  it("indexes every table, row and cell as parseTables does", () => {
    for (const { html: h } of Object.values(DOCS)) {
      const a = parseTables(h);
      const b = parseGrid(h);
      expect(b.length).toBe(a.length);
      a.forEach((t, i) =>
        t.rows.forEach((r, j) => expect(b[i].rows[j].cells.map((c) => c.text)).toEqual(r)),
      );
    }
  });
  it("reads colspans, indentation, bold and rules from the markup", () => {
    const t = parseGrid(DOCS.jpm.html)[1];
    // "Noninterest revenue" is printed bold and indented under a rule; "Card income" is a plain part.
    const nir = t.rows[19].cells[0];
    const card = t.rows[17].cells[0];
    expect(nir.text).toBe("Noninterest revenue");
    expect(nir.bold && nir.indent > card.indent).toBe(true);
    expect(t.rows[19].cells.some((c) => c.ruleTop)).toBe(true);
    expect(t.rows[9].cells[0].span).toBe(3);
  });
});

describe("JPM 3Q26 supplement", () => {
  const out = fill("jpm");
  it("fills every printed row of the income statement the reader skipped", () => {
    const t = 1;
    const r = out.tables.find((x) => x.t === t)!;
    expect([r.printed, r.covered, r.filled]).toEqual([32, 23, 9]);
    const ii = row(out.facts, t, 20);
    expect(ii[0].label).toBe("Interest income");
    expect(at(ii, "2026-09-30", 3)?.value).toBe(53_056e6);
    expect(at(ii, "2025-12-31", 3)?.value).toBe(48_808e6);
    // The nine-month column keeps its length: never read as a quarter.
    expect(at(ii, "2026-09-30", 9)?.value).toBe(152_871e6);
    expect(ii.filter((f) => f.months === 3)).toHaveLength(5);
    expect(at(row(out.facts, t, 37), "2026-09-30", 3)?.value).toBe(15_305e6);
    const eps = row(out.facts, t, 41);
    expect([eps[0].label, eps[0].unit, at(eps, "2026-09-30", 3)?.value]).toEqual([
      "Basic earnings per share",
      "usdPerShare",
      5.58,
    ]);
    const tax = row(out.facts, t, 48);
    expect([tax[0].unit, at(tax, "2026-09-30", 3)?.value]).toEqual(["pct", 24]);
    expect(
      out.facts.every((f) => f.method === FILL_METHOD && f.id!.startsWith(`${FILL_METHOD}:`)),
    ).toBe(true);
  });
  it("never writes a position a stored fact holds", () => {
    const held = new Set(
      DOCS.jpm.facts.map((f) => {
        const l = f.locator as { t: number; r: number; c: number };
        return `${l.t}:${l.r}:${l.c}`;
      }),
    );
    for (const f of out.facts) {
      const l = f.locator as { t: number; r: number; c: number };
      expect(held.has(`${l.t}:${l.r}:${l.c}`)).toBe(false);
    }
    expect(out.conflicts).toEqual([]);
  });
  it("joins a name wrapped over printed rows and reads parentheses as negatives (balance sheet)", () => {
    const t = 2;
    const fed = row(out.facts, t, 14);
    expect(fed[0].label).toBe(
      "Federal funds sold and securities purchased under resale agreements",
    );
    expect(fed.every((f) => f.months === 0)).toBe(true);
    expect(at(row(out.facts, t, 49), "2026-09-30", 0)?.value).toBe(-19_820e6);
    expect(out.tables.find((x) => x.t === t)!.wraps).toContain(13);
  });
  it("reads the average balances in dollars and the yields block as percentages", () => {
    const t = 3;
    expect(out.tables.find((x) => x.t === t)!.filled).toBe(40);
    const bal = row(out.facts, t, 10);
    expect([bal[0].unit, at(bal, "2026-09-30", 3)?.value]).toEqual(["usd", 339_312e6]);
    // Only the block's first row prints "%"; the rows under it carry the convention.
    for (const r of [43, 44, 53, 60]) expect(row(out.facts, t, r)[0].unit).toBe("pct");
    expect(at(row(out.facts, t, 48), "2026-09-30", 3)?.value).toBe(6.59);
  });
  it("fills a page no fact sits in from column heads the document settles (EPS page)", () => {
    const t = 6;
    const r = out.tables.find((x) => x.t === t)!;
    expect([r.printed, r.covered, r.filled]).toEqual([19, 0, 19]);
    expect(at(row(out.facts, t, 11), "2026-09-30", 3)?.value).toBe(15_305e6);
    // Three printed rows make one name; share counts printed in millions are counts.
    const shares = row(out.facts, t, 40);
    expect(shares[0].label).toBe(
      "Shares issued from treasury stock related to employee stock-based compensation awards and employee stock purchase plans",
    );
    expect([shares[0].unit, at(shares, "2026-09-30", 3)?.value]).toEqual(["count", 0.5e6]);
    // A name printed under both blocks is named with each block heading.
    expect(row(out.facts, t, 16)[0].label).toBe(
      "Basic earnings per share — Net income applicable to common stockholders",
    );
    expect(row(out.facts, t, 22)[0].label).toBe(
      "Diluted earnings per share — Net income applicable to common stockholders",
    );
  });
  it("reads a quarter column of balances beside flows by the rows around it (highlights)", () => {
    const t = 0;
    expect(row(out.facts, t, 31)[0].months).toBe(0);
    expect(row(out.facts, t, 26).map((f) => f.unit)).toContain("count");
    // Market capitalization repeats the quarter in the year-to-date column: a balance, read once.
    const cap = row(out.facts, t, 30);
    expect(cap.every((f) => f.months === 0)).toBe(true);
    expect(cap).toHaveLength(5);
  });
});

describe("CFG 3Q26 supplement", () => {
  const out = fill("cfg");
  it("reads ratio rows as percentages and drops superscript footnote marks from names", () => {
    const roe = row(out.facts, 0, 27);
    expect(roe[0].label).toBe("Return on average tangible common equity");
    expect([roe[0].unit, at(roe, "2026-09-30", 3)?.value]).toEqual(["pct", 15.08]);
    expect(row(out.facts, 0, 25)[0].label).toBe("Net interest margin, FTE");
  });
  it("keeps names that differ inside parentheses apart", () => {
    const a = row(out.facts, 0, 45)[0];
    const b = row(out.facts, 0, 46)[0];
    expect(a.label).toBe("Loan-to-deposit ratio (period-end balances)");
    expect(b.label).toBe("Loan-to-deposit ratio (average balances)");
    expect(a.parent).not.toBe(b.parent);
  });
  it("leaves rows of dashes out when the document gives dashes no meaning", () => {
    expect(dashMeansZero(DOCS.cfg.html)).toBe(false);
    const t = out.tables.find((x) => x.t === 1)!;
    expect(t.misses.map(([r]) => r)).toEqual([10, 12]);
    expect(row(out.facts, 1, 10)).toEqual([]);
  });
});

describe("Apple Q4 FY26 release", () => {
  const out = fill("aapl");
  it("fills the statements of operations below the cost block", () => {
    const gm = row(out.facts, 0, 11);
    expect([gm[0].label, gm[0].unit, at(gm, "2026-09-26", 3)?.value]).toEqual([
      "Gross margin",
      "usd",
      54_820e6,
    ]);
    expect(at(row(out.facts, 0, 22), "2026-09-26", 12)?.value).toBe(132_175e6);
    // "Shares ... reflected in thousands": counts at the scale line's share scale.
    const sh = row(out.facts, 0, 28);
    expect([sh[0].unit, at(sh, "2026-09-26", 3)?.value]).toEqual(["count", 14_570_195e3]);
    expect(row(out.facts, 0, 25)[0].unit).toBe("usdPerShare");
  });
  it("fills the balance sheet and the cash flow statement from their printed heads", () => {
    const bs = out.tables.find((x) => x.t === 1)!;
    expect([bs.printed, bs.filled]).toEqual([28, 28]);
    expect(at(row(out.facts, 1, 18), "2026-09-26", 0)?.label).toBe("Total assets");
    const cf = out.tables.find((x) => x.t === 2)!;
    expect(cf.filled).toBe(27);
    const ops = row(out.facts, 2, 18);
    expect(ops.every((f) => f.months === 12)).toBe(true);
    // The opening balance of a twelve-month column belongs to the year's start, never to its end: left out
    // (verb-09: it showed under the fourth quarter).
    expect(row(out.facts, 2, 3)).toEqual([]);
    expect(cf.misses).toContainEqual([3, "period"]);
  });
});

describe("rules on small tables", () => {
  const known = {
    flows: new Map([
      ["2026-09-30/3", "2026-07-01"],
      ["2026-09-30/9", "2026-01-01"],
    ]),
    ends: new Set(["2026-09-30", "2025-12-31"]),
  };
  it("takes a period from a printed head only when it names a period the facts use", () => {
    expect(printedHead("three months ended|september 30, 2026", "", known)).toMatchObject({
      end: "2026-09-30",
      months: 3,
    });
    expect(printedHead("nine months ended|september 30, 2026", "", known)).toMatchObject({
      months: 9,
    });
    expect(printedHead("september 30, 2026", "", known)).toMatchObject({ months: 0, point: true });
    expect(printedHead("december 31, 2025", "Three months ended", known)).toBeNull();
    expect(printedHead("six months ended|june 30, 2026", "", known)).toBeNull();
    expect(printedHead("september 30, 2026|change", "", known)).toBeNull();
    expect(printedHead("2026", "", known)).toBeNull();
  });
  it("reads a negative whose closing parenthesis sits in the next cell", () => {
    const g = parseGrid(
      "<table><tr><td>Operating margin</td><td>(32.5</td><td>%)</td><td>12.0</td><td>%</td></tr></table>",
    );
    expect(cellValue(g[0].rows[0], 1)).toBe(-32.5);
    expect(cellValue(g[0].rows[0], 3)).toBe(12);
  });
  const tiny = (cols: string, cells: string) =>
    `<table><tr><td></td>${cols}</tr><tr><td>Revenue</td>${cells}</tr><tr><td>Cost</td>${cells}</tr><tr><td>Other income</td>${cells}</tr></table>`;
  const fact = (r: number, c: number, end: string, label: string): IrFact => ({
    id: `f${r}${c}`,
    document_id: "d",
    category: "kpi",
    metric: "revenue",
    label,
    parent: null,
    is_total: false,
    period_start: null,
    period_end: end,
    months: 3,
    value: 10e6,
    unit: "usd",
    accn: null,
    doc: null,
    filed: "2026-10-20",
    locator: { t: 0, r, c, text: "10" },
  });
  it("reads neither of two printed columns of one period (as reported and restated)", () => {
    const h = tiny("<td>3Q26</td><td>3Q26 restated</td>", "<td>10</td><td>11</td>");
    const out = fillDocument({
      doc: "d",
      html: h,
      facts: [
        fact(1, 1, "2026-09-30", "Revenue"),
        fact(1, 2, "2026-09-30", "Revenue"),
        fact(2, 1, "2026-09-30", "Cost"),
        fact(2, 2, "2026-09-30", "Cost"),
      ],
      captions: new Map([[0, { unit: "(in millions)" }]]),
    });
    expect(out.facts).toEqual([]);
    expect(out.tables[0].misses).toEqual([[3, "period"]]);
  });
  it("moves a stored figure the reader put under another column's period", () => {
    const h = `<table><tr><td></td><td>3Q26</td><td>2Q26</td></tr>${["A", "B", "C", "D"].map((x) => `<tr><td>${x}</td><td>10</td><td>10</td></tr>`).join("")}</table>`;
    const fs = [1, 2, 3, 4].flatMap((r) => [
      fact(r, 1, "2026-09-30", `L${r}`),
      fact(r, 2, "2026-06-30", `L${r}`),
    ]);
    fs[6] = { ...fs[6], period_end: "2026-06-30" }; // row 4, first column
    fs[7] = { ...fs[7], period_end: "2026-09-30" };
    const out = fillDocument({
      doc: "d",
      html: h,
      facts: fs,
      captions: new Map([[0, { unit: "(in millions)" }]]),
    });
    expect(out.fixes.map((f) => [f.id, f.period_end])).toEqual([
      ["f41", "2026-09-30"],
      ["f42", "2026-06-30"],
    ]);
  });
  it("knows a dash convention only from the document", () => {
    expect(dashMeansZero("<p>— Represents zero or less than $0.5 million.</p>")).toBe(true);
    expect(dashMeansZero("<p>NM - Not meaningful</p>")).toBe(false);
  });
  it("hints a supplement stored under another kind", () => {
    expect(kindHint("other", "Quarterly Financial Data Supplement")).toBe("supplement");
    expect(kindHint("other", null, "<p>Citigroup Inc. FINANCIAL SUPPLEMENT</p>")).toBe(
      "supplement",
    );
    expect(kindHint("press-release", "Financial supplement")).toBeUndefined();
  });
});

describe("build with table fill", () => {
  it("lays the JPM income statement out complete, with the printed layout and the quality summary", async () => {
    const { html: h, facts } = DOCS.jpm;
    const run = await fillCompany(facts, async () => h, { company: "JPMorgan" });
    expect(fillDocs(facts)).toHaveLength(1);
    let p = buildPayload("JPM", run.facts);
    p = await withCaptions(p, async (d) => run.captions.get(p.docs[d].id));
    p = withFill(p, run);
    const q = qualityOf(p, run);
    const income = assembleStatements(p).find((s) => /statements of income/i.test(s.title))!;
    const lines = income.rows.filter((r) => r.kind === "line");
    expect(lines).toHaveLength(32);
    const byKey = new Map(p.series.map((s) => [s.k, s]));
    const net = lines.find((r) => r.kind === "line" && r.at?.[2] === 37)!;
    if (net.kind !== "line") throw new Error("no row");
    const cells = rowCells(net.ks, byKey, "q", net.at).cells["2026-09-30"];
    expect([cells.v, cells.x, cells.how]).toEqual([15_305e6, "15,305", "printed"]);
    const cap = p.tables?.[income.id];
    // NET INCOME: bold under a rule, filled from the document, indented deeper than the tax line above it.
    const ni = cap?.rows?.find(([r]) => r === 37);
    const tax = cap?.rows?.find(([r]) => r === 36);
    expect([ni?.[2], ni?.[3], tax?.[2], tax?.[3]]).toEqual([
      7,
      "NET INCOME",
      4,
      "Income tax expense",
    ]);
    expect(ni![1]).toBeGreaterThan(tax![1]);
    // Main counts are over the supplement's statement tables (income statement, balance sheet and the like).
    expect(q.v).toBe(2);
    expect(q.main.tables.printed).toBeGreaterThanOrEqual(2);
    expect(q.main.tables.shown).toBe(q.main.tables.printed);
    expect(q.main.printed).toBe(157);
    expect(q.main.after).toBeGreaterThanOrEqual(155);
    expect(q.fill).toMatchObject({ docs: 1, read: 1, failed: 0, conflicts: 0 });
    expect(q.latest).toBe("2026-09-30");
  });
  it("leaves the stored facts as they are when a document cannot be read", async () => {
    const run = await fillCompany(DOCS.jpm.facts, async () => null);
    expect([run.read, run.failed, run.facts.length]).toEqual([0, 1, DOCS.jpm.facts.length]);
  });
});
