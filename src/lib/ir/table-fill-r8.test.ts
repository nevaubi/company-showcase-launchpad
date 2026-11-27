// Table fill, round 8: statements no stored fact reaches. Lowe's Q3 FY26 release (the reader read only the balance
// sheet; income statement with "Amount | % Sales" column groups, comprehensive income, nine-month cash flows) and
// AppLovin's 3Q26 release (no stored fact at all), each cut from the public SEC copy (fixtures/fill/*.json name the
// source), plus small tables for every head layout and safety rule met in the proof.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import lowFx from "@/lib/ir/fixtures/fill/low-q3fy26.json";
import appFx from "@/lib/ir/fixtures/fill/app-3q26.json";
import type { IrFact } from "@/lib/ir/kpis";
import { buildPayload, BUILD_FORMAT } from "@/lib/ir/payload";
import { assembleStatements, withCaptions } from "@/lib/ir/statements";
import { tableCaptions } from "@/lib/ir/table-captions";
import {
  fillDocument,
  headDate,
  leadTitle,
  nearQuarterEnd,
  printedHead,
  printedScaleLine,
  quarterEnds,
  statementTitle,
  tableHeads,
  weeksToMonths,
} from "@/lib/ir/table-fill";
import {
  fillCompany,
  fiscalCalendar,
  qualityOf,
  tableDocRows,
  withFill,
} from "@/lib/ir/table-fill-build";
import { parseGrid } from "@/lib/ir/table-grid";

const html = (name: string) =>
  readFileSync(join(process.cwd(), "src/lib/ir/fixtures/fill", `${name}.htm`), "utf8");
const LOW = { html: html("low-q3fy26"), facts: lowFx.facts as unknown as IrFact[] };
const APP = { html: html("app-3q26"), facts: [] as IrFact[] };
const LOW_DOC = LOW.facts[0].document_id!;
const APP_DOC = "3aa46b5a-8728-4452-9cd2-e1029d0c91e9";
const caps = (h: string) => new Map(tableCaptions(h).map((c) => [c.t, c]));
const inTable = (fs: IrFact[], t: number) => fs.filter((f) => (f.locator as { t: number }).t === t);
const at = (fs: IrFact[], t: number, r: number, end: string, months: number) =>
  fs.find(
    (f) =>
      (f.locator as { t: number }).t === t &&
      (f.locator as { r: number }).r === r &&
      f.period_end === end &&
      f.months === months,
  );

describe("printed heads of periods no fact uses", () => {
  const known = {
    flows: new Map<string, string | null>(),
    ends: new Set<string>(),
    calendar: quarterEnds(["10-31"]),
    filed: "2026-11-18",
  };
  it("accepts a statement's quarter, year-to-date and balance heads on the fiscal calendar", () => {
    expect(
      printedHead("three months ended|october 30, 2026|amount", "", known, true),
    ).toMatchObject({
      end: "2026-10-30",
      months: 3,
      fresh: true,
    });
    expect(printedHead("nine months ended|october 31, 2025", "", known, true)).toMatchObject({
      months: 9,
    });
    expect(
      printedHead("october 30, 2026", "Consolidated Balance Sheets", known, true),
    ).toMatchObject({
      months: 0,
      point: true,
    });
    expect(
      printedHead(
        "as of september 30,|2026",
        "",
        { ...known, calendar: quarterEnds(["09-30"]) },
        true,
      ),
    ).toMatchObject({ end: "2026-09-30", months: 0 });
  });
  it("refuses a date after filing, off the calendar, outside a statement, or a balance with no balance title", () => {
    expect(printedHead("three months ended|january 31, 2027", "", known, true)).toBeNull();
    expect(printedHead("three months ended|november 15, 2026", "", known, true)).toBeNull();
    expect(printedHead("three months ended|october 30, 2026", "", known, false)).toBeNull();
    expect(printedHead("october 30, 2026", "Reconciliation", known, true)).toBeNull();
    expect(
      printedHead(
        "three months ended|october 30, 2026",
        "",
        { ...known, calendar: undefined },
        true,
      ),
    ).toBeNull();
    expect(printedHead("year to date|october 30, 2026", "", known, true)).toBeNull();
    expect(printedHead("three months ended|october 30, 2026|% sales", "", known, true)).toBeNull();
  });
  it("maps weeks to months only for the quarter, half, nine months and year ranges", () => {
    expect([12, 13, 14, 16, 24, 28, 29, 36, 40, 52, 53].map(weeksToMonths)).toEqual([
      3,
      3,
      3,
      null,
      6,
      6,
      null,
      9,
      9,
      12,
      12,
    ]);
    const k = { ...known, calendar: quarterEnds(["08-30"]), filed: "2026-09-24" };
    expect(printedHead("13 weeks ended|august 30, 2026", "", k, true)?.months).toBe(3);
    expect(printedHead("fifty-two weeks ended|august 30, 2026", "", k, true)?.months).toBe(12);
    expect(printedHead("16 weeks ended|august 30, 2026", "", k, true)).toBeNull();
  });
  it("keeps a table's heads apart, in order and recent", () => {
    const heads = (cols: string[], filed = "2026-11-18") =>
      [
        ...tableHeads(
          new Map(cols.map((k, i) => [i + 1, k])),
          "",
          { ...known, filed },
          true,
        ).values(),
      ].map((p) => (p ? `${p.end}/${p.months}` : null));
    // Grid columns of one printed group ("... 2026" and "... 2026|amount") are one column.
    expect(
      heads([
        "three months ended|october 30, 2026",
        "three months ended|october 30, 2026|amount",
        "three months ended|october 31, 2025",
      ]),
    ).toEqual(["2026-10-30/3", "2026-10-30/3", "2025-10-31/3"]);
    // Two different heads of one period: both left out.
    expect(
      heads(["three months ended|october 30, 2026", "quarter ended|october 30, 2026 (restated)"]),
    ).toEqual([null, null]);
    // Dates of one length out of order: left out.
    expect(
      heads([
        "three months ended|october 31, 2025",
        "three months ended|october 30, 2026",
        "three months ended|july 31, 2026",
      ]),
    ).toEqual([null, null, null]);
    // The newest column more than six months before the filing: left out.
    expect(
      heads(["three months ended|october 31, 2025", "three months ended|october 31, 2024"]),
    ).toEqual([null, null]);
  });
  it("reads the fiscal calendar from stored flows and report dates", () => {
    expect(quarterEnds(["10-30"])).toEqual(["01-31", "04-30", "07-31", "10-31"]);
    expect(quarterEnds(["09-26"])).toEqual(["03-26", "06-26", "09-26", "12-26"]);
    expect(nearQuarterEnd("2026-10-30", ["10-31"])).toBe(true);
    expect(nearQuarterEnd("2026-01-03", ["12-30"])).toBe(true);
    expect(nearQuarterEnd("2026-11-15", ["10-31"])).toBe(false);
    const f = (end: string, months: number) => ({ period_end: end, months }) as IrFact;
    // One stray end is not a calendar point; two are.
    expect(
      fiscalCalendar([f("2026-05-15", 3), f("2026-08-02", 3), f("2025-08-02", 9)], ["2026-11-01"]),
    ).toEqual(["02-01", "02-02", "05-01", "05-02", "08-01", "08-02", "11-01", "11-02"]);
  });
  it("names a statement by its printed title, never a reconciliation or segment table", () => {
    expect(statementTitle("Condensed Consolidated Statements of Operations")).toBe(true);
    expect(
      statementTitle("Consolidated Statements of Current Earnings and Accumulated Deficit"),
    ).toBe(true);
    expect(statementTitle("Condensed Consolidated Statement of Financial Position")).toBe(true);
    expect(statementTitle("Reconciliation of Net Income to Adjusted EBITDA")).toBe(false);
    expect(statementTitle("Commercial banking segment", "Selected income statement data")).toBe(
      false,
    );
    expect(statementTitle("", "Consolidated balance sheets")).toBe(true);
    expect(
      leadTitle("7 Walmart Inc. Condensed Consolidated Statements of Income (Unaudited)"),
    ).toBe("Condensed Consolidated Statements of Income");
    expect(printedScaleLine("CONDENSED CONSOLIDATED BALANCE SHEETS (Millions)")).toBe("(Millions)");
    expect(printedScaleLine("(Millions except per share amounts) (Unaudited)")).toBe(
      "(Millions except per share amounts)",
    );
    expect(printedScaleLine("(shares in thousands, dollars in millions)")).toBe("");
    expect(headDate("three months ended|november 2, 2025")).toEqual({
      end: "2025-11-02",
      months: 3,
    });
    expect(headDate("sep 30, 2026 % change from|sep 30, 2025")).toBeNull();
  });
});

describe("Lowe's Q3 FY26 release: statements the reader left untouched", () => {
  const out = fillDocument({
    doc: LOW_DOC,
    html: LOW.html,
    facts: LOW.facts,
    captions: caps(LOW.html),
    filed: "2026-11-18",
    calendar: fiscalCalendar(LOW.facts, ["2026-10-30"]),
  });
  it("lists every statement table the release prints", () => {
    expect(out.statements.map((s) => s.t)).toEqual([0, 1, 2, 3]);
  });
  it("fills the income statement's amount columns and never its percent of sales columns", () => {
    // Net sales 22,756 | 20,813 (three months), 71,790 | 65,701 (nine months), in millions.
    expect(at(out.facts, 0, 4, "2026-10-30", 3)?.value).toBe(22_756e6);
    expect(at(out.facts, 0, 4, "2025-10-31", 3)?.value).toBe(20_813e6);
    expect(at(out.facts, 0, 4, "2026-10-30", 9)?.value).toBe(71_790e6);
    expect(at(out.facts, 0, 5, "2026-10-30", 3)?.value).toBe(15_259e6);
    expect(inTable(out.facts, 0).some((f) => f.value === 100 || f.value === 67.05e6)).toBe(false);
  });
  it("fills the nine-month cash flows as nine months, and leaves opening balances out", () => {
    expect(at(out.facts, 3, 4, "2026-10-30", 9)?.value).toBe(5_699e6);
    expect(inTable(out.facts, 3).filter((f) => f.months === 3)).toEqual([]);
    const cf = out.tables.find((t) => t.t === 3)!;
    expect(cf.filled).toBeGreaterThanOrEqual(27);
    const names = inTable(out.facts, 3).map((f) => f.label);
    expect(names.some((n) => /beginning/i.test(n))).toBe(false);
  });
});

describe("AppLovin 3Q26 release: no stored fact", () => {
  it("reads the statements of a document only its row names, and counts the statements in quality", async () => {
    const run = await fillCompany([], async (id) => (id === APP_DOC ? APP.html : null), {
      docs: [{ id: APP_DOC, filed: "2026-11-04", kind: "press-release", title: null }],
      reports: ["2026-09-30"],
    });
    const fill = run.fills.get(APP_DOC)!;
    expect(fill.statements.map((s) => s.t)).toEqual([0, 1, 2]);
    // The reconciliation to adjusted EBITDA stays out.
    expect(fill.tables.map((t) => t.t)).not.toContain(3);
    // Revenue 2,184,815 | 1,405,045 (quarter), in thousands; cash 3,173,731 at Sep 30, 2026.
    expect(at(run.facts, 1, 3, "2026-09-30", 3)?.value).toBe(2_184_815e3);
    expect(at(run.facts, 1, 3, "2025-09-30", 3)?.value).toBe(1_405_045e3);
    expect(at(run.facts, 1, 3, "2026-09-30", 9)?.value).toBe(5_950_950e3);
    expect(at(run.facts, 0, 4, "2026-09-30", 0)?.value).toBe(3_173_731e3);
    expect(at(run.facts, 0, 4, "2025-12-31", 0)?.value).toBe(2_487_096e3);
    expect(
      run.facts.every((f) => f.filed === "2026-11-04" && f.document_kind === "press-release"),
    ).toBe(true);
    let p = buildPayload("APP", run.facts);
    p = await withCaptions(p, async () => run.captions.get(APP_DOC) ?? null);
    p = withFill(p, run);
    const q = qualityOf(p, run);
    const ids = assembleStatements(p).map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["0:0", "0:1"]));
    expect(q.main.tables).toEqual({
      printed: 3,
      shown: ids.filter((x) => ["0:0", "0:1", "0:2"].includes(x)).length,
    });
    expect(q.main.doc).toEqual({ filed: "2026-11-04", kind: "press-release" });
    // Printed rows of a statement that became no section count as missing.
    expect(q.main.printed).toBe(fill.statements.reduce((n, s) => n + s.rows, 0));
    expect(q.main.after).toBeLessThan(q.main.printed);
    expect(BUILD_FORMAT).toBe(4);
  });
  it("chooses the company's table documents by their rows", () => {
    const row = (
      id: string,
      filed: string,
      kind = "press-release",
      ext = "htm",
      status: string | null = null,
    ) => ({
      id,
      filed,
      kind,
      ext,
      title: null,
      bytes: 1000,
      extract_status: status,
    });
    const got = tableDocRows(
      [
        row("a", "2026-11-04"),
        row("b", "2025-07-01"),
        row("c", "2026-10-01", "presentation"),
        row("d", "2026-10-02", "other", "pdf"),
        row("e", "2026-10-03", "other", "htm", "no tables"),
        row("f", "2026-10-04", "supplement", "HTML"),
        row("g", "2026-10-05"),
      ],
      "2026-11-26",
      { refused: new Set(["g"]) },
    );
    expect(got.map((d) => d.id)).toEqual(["a", "f"]);
  });
});

describe("safety rules met in the proof", () => {
  const fact = (
    r: number,
    c: number,
    end: string,
    label: string,
    value = 10e6,
    text = "10",
    months = 3,
  ): IrFact => ({
    id: `f${r}${c}`,
    document_id: "d",
    category: "kpi",
    metric: "revenue",
    label,
    parent: null,
    is_total: false,
    period_start: null,
    period_end: end,
    months,
    value,
    unit: "usd",
    accn: null,
    doc: null,
    filed: "2026-11-17",
    locator: { t: 0, r, c, text },
  });
  const table = (head: string, rows: [string, string, string][]) =>
    `<table><tr><td></td>${head}</tr>${rows.map(([l, a, b]) => `<tr><td>${l}</td><td>${a}</td><td>${b}</td></tr>`).join("")}</table>`;
  it("gives stored money figures their table's printed scale (NVDA's release stored in units)", () => {
    const h = table(
      "<td>Three months ended Oct 25, 2026</td><td>Three months ended Oct 26, 2025</td>",
      [
        ["Revenue", "115,844", "57,006"],
        ["Research and development", "7,454", "4,705"],
        ["Sales, general and administrative", "1,702", "1,134"],
        ["Total operating expenses", "9,156", "5,839"],
      ],
    );
    const fs = [2, 3, 4].flatMap((r) => [
      fact(
        r,
        1,
        "2026-10-25",
        `L${r}`,
        Number(["", "", "7454", "1702", "9156"][r]),
        ["", "", "7,454", "1,702", "9,156"][r],
      ),
      fact(
        r,
        2,
        "2025-10-26",
        `L${r}`,
        Number(["", "", "4705", "1134", "5839"][r]),
        ["", "", "4,705", "1,134", "5,839"][r],
      ),
    ]);
    const out = fillDocument({
      doc: "d",
      html: h,
      facts: fs,
      captions: new Map([[0, { unit: "(In millions, except per share data)" }]]),
    });
    expect(out.fixes.map((f) => f.value).sort((a, b) => a - b)).toEqual([
      1134e6, 1702e6, 4705e6, 5839e6, 7454e6, 9156e6,
    ]);
    expect(out.fixes.every((f) => (f.locator as { scale?: string }).scale === "printed")).toBe(
      true,
    );
    expect(at(out.facts, 0, 1, "2026-10-25", 3)?.value).toBe(115_844e6);
  });
  it("leaves a scale line naming two scales alone", () => {
    const h = table("<td>3Q26</td><td>2Q26</td>", [
      ["A", "1", "2"],
      ["B", "3", "4"],
      ["C", "5", "6"],
    ]);
    const fs = [1, 2, 3].flatMap((r) => [
      fact(r, 1, "2026-09-30", `L${r}`, r * 1e6, "1"),
      fact(r, 2, "2026-06-30", `L${r}`, r * 1e6, "2"),
    ]);
    const out = fillDocument({
      doc: "d",
      html: h,
      facts: fs,
      captions: new Map([[0, { unit: "(shares in thousands, dollars in millions)" }]]),
    });
    expect(out.fixes.filter((f) => (f.locator as { scale?: string }).scale)).toEqual([]);
  });
  it("moves stored figures to the date their own column head prints (HD's prior-year column stored as this year)", () => {
    const h = table(
      "<td>Nine months ended November 1, 2026</td><td>Nine months ended November 2, 2025</td>",
      [
        ["A", "10", "10"],
        ["B", "10", "10"],
        ["C", "10", "10"],
      ],
    );
    const fs = [1, 2, 3].flatMap((r) => [
      fact(r, 1, "2026-11-01", `L${r}`, 10e6, "10", 9),
      fact(r, 2, "2026-11-01", `L${r}`, 10e6, "10", 9),
    ]);
    const out = fillDocument({
      doc: "d",
      html: h,
      facts: fs,
      captions: new Map([[0, { unit: "(in millions)" }]]),
    });
    expect(out.fixes.map((f) => [f.id, f.period_end])).toEqual([
      ["f12", "2025-11-02"],
      ["f22", "2025-11-02"],
      ["f32", "2025-11-02"],
    ]);
  });
  it("never takes a period from a change column, even with stored figures in it (WFC, DELL)", () => {
    const h = table("<td>Sep 30, 2026</td><td>Sep 30, 2026 % change from Sep 30, 2025</td>", [
      ["A", "40,556", "17"],
      ["B", "140,503", "1"],
      ["C", "9", "3"],
      ["D", "12", "4"],
    ]);
    const fs = [1, 2].flatMap((r) => [
      fact(r, 1, "2026-09-30", `L${r}`, 1, "x", 0),
      fact(r, 2, "2025-09-30", `L${r}`, 1, "x", 0),
    ]);
    const out = fillDocument({
      doc: "d",
      html: h,
      facts: fs,
      captions: new Map([[0, { title: "Consolidated balance sheet", unit: "(in millions)" }]]),
    });
    expect(out.facts.some((f) => f.period_end === "2025-09-30")).toBe(false);
  });
  it("leaves a row under a percent block out when it prints no sign of its own (AMZN growth rows)", () => {
    const h = `<table><tr><td></td><td>3Q26</td><td></td><td>3Q25</td><td></td></tr><tr><td>Y/Y net sales growth:</td></tr><tr><td>North America</td><td>11</td><td>%</td><td>6</td><td>%</td></tr><tr><td>International</td><td>14</td><td></td><td>5</td><td></td></tr><tr><td>Net sales</td><td>1,000</td><td></td><td>900</td><td></td></tr></table>`;
    const fs = [
      fact(4, 1, "2026-09-30", "Net sales", 1000e6, "1,000"),
      fact(4, 3, "2025-09-30", "Net sales", 900e6, "900"),
    ];
    const out = fillDocument({
      doc: "d",
      html: h,
      facts: [
        ...fs,
        {
          ...fs[0],
          id: "x",
          locator: { t: 0, r: 2, c: 1, text: "11" },
          unit: "pct",
          value: 11,
          label: "North America",
        },
        {
          ...fs[1],
          id: "y",
          locator: { t: 0, r: 2, c: 3, text: "6" },
          unit: "pct",
          value: 6,
          label: "North America",
        },
      ],
      captions: new Map([[0, { unit: "(in millions)" }]]),
    });
    expect(out.facts.filter((f) => f.label === "International")).toEqual([]);
    expect(out.tables[0].misses).toContainEqual([3, "unit"]);
  });
  it("never fills a rollforward's builds into a row of stored balances (C allowance)", () => {
    const h = table(
      "<td>Balance Sep 30, 2026</td><td>Builds three months ended Sep 30, 2026</td>",
      [
        ["A", "123", "(11)"],
        ["B", "50", "2"],
        ["C", "60", "3"],
      ],
    );
    const fs = [1, 2, 3].map((r) => fact(r, 1, "2026-09-30", `L${r}`, 1e6, "1", 0));
    const known = [...fs, ...[2, 3].map((r) => fact(r, 2, "2026-09-30", `M${r}`, 1e6, "2", 3))];
    const out = fillDocument({
      doc: "d",
      html: h,
      facts: known,
      captions: new Map([[0, { unit: "(in millions)" }]]),
    });
    expect(out.facts.filter((f) => (f.locator as { r: number }).r === 1)).toEqual([]);
  });
  it("never moves an opening balance dated before its column (BAC rollforward)", () => {
    const h = table("<td>3Q26</td><td>2Q26</td>", [
      ["Beginning balance", "2,327,766", "2,115,782"],
      ["Net flows", "10", "10"],
      ["Market", "10", "10"],
      ["Ending balance", "10", "10"],
    ]);
    const fs = [2, 3, 4].flatMap((r) => [
      fact(r, 1, "2026-09-30", `L${r}`),
      fact(r, 2, "2026-06-30", `L${r}`),
    ]);
    fs.push({
      ...fact(
        1,
        1,
        "2026-06-30",
        "Assets under management, beginning balance",
        2_327_766e6,
        "2,327,766",
        0,
      ),
    });
    const out = fillDocument({
      doc: "d",
      html: h,
      facts: fs,
      captions: new Map([[0, { unit: "(in millions)" }]]),
    });
    expect(out.fixes.filter((f) => f.id === "f11")).toEqual([]);
  });
  it("reads a title printed in its own small table above the statement (WMT)", () => {
    const g = parseGrid(
      `<table><tr><td>Walmart Inc.</td></tr><tr><td>Condensed Consolidated Statements of Income</td></tr></table><table><tr><td>Net sales</td><td>1</td></tr></table>`,
    );
    expect(leadTitle(g[1].lead)).toBe("Condensed Consolidated Statements of Income");
  });
});
