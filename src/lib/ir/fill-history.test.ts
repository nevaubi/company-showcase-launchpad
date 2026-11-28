// How far back the table fill reads: every table document of the newest 37 months, the plan's primary statement
// documents before that, and documents stored without a filing date in the place the plan gives them.
import { describe, expect, it } from "vitest";
import { planDocuments, type PlanDocRow } from "@/lib/ir/doc-plan";
import { fillCompany, fillDocs, tableDocRows, FILL_OLDER_DOCS } from "@/lib/ir/table-fill-build";
import { readLimits, READ_LIMITS } from "@/lib/ir/rebuild.server";
import { proFormaDocument, resultsExhibit } from "@/lib/ir/reported-scope";

const doc = (id: string, filed: string | null, kind = "press-release", extra: Partial<PlanDocRow> = {}): PlanDocRow => ({
  id,
  kind,
  ext: "htm",
  filed,
  title: `${id} release`,
  period: null,
  source_url: null,
  ...extra,
});

describe("the plan names the older statement documents and where undated ones stand", () => {
  const rows = [
    doc("q3-26", "2026-10-29"),
    doc("q3-26-deck", "2026-10-29", "presentation"),
    doc("q3-21", "2021-10-28"),
    doc("q3-21-other", "2021-10-28", "other"),
    doc("q3-12", "2012-10-25"),
    doc("q3-09", "2009-10-20"),
    doc("undated-q2-20", null, "press-release", { period: "Q2 FY20" }),
    doc("undated-new", null, "press-release", { period: "Q2 FY26" }),
  ];
  const plan = planDocuments(rows);
  it("lists releases filed before the full window as older, not the newest documents or other exhibits", () => {
    expect(plan.older.sort()).toEqual(["q3-12", "q3-21", "undated-q2-20"]);
    expect(plan.load).not.toContain("q3-21-other");
    expect(plan.load).not.toContain("q3-09");
  });
  it("gives each loaded undated document the date it is placed at, never a filing date", () => {
    // Second calendar quarter of the year named, moved by the default 30 days to the filing.
    expect(plan.placed).toEqual({ "undated-q2-20": "2020-07-30", "undated-new": "2026-07-30" });
  });
});

describe("which documents the fill reads", () => {
  const row = (id: string, filed: string | null, kind = "press-release", placed?: string) => ({ id, filed, kind, title: null, ...(placed ? { placed } : {}) });
  it("takes a document filed before the window only when the plan names it, after the window's documents", () => {
    const rows = [row("new", "2026-10-29"), row("mid", "2025-01-30"), row("old-a", "2019-10-30"), row("old-b", "2015-10-27"), row("old-not-named", "2018-10-25")];
    expect(fillDocs([], 60, rows)).toEqual(["new", "mid"]);
    expect(fillDocs([], 60, rows, new Set(["old-a", "old-b"]))).toEqual(["new", "mid", "old-a", "old-b"]);
    // The window's own cap does not eat the older documents' places, and they have their own cap.
    expect(fillDocs([], 1, rows, new Set(["old-a", "old-b"]))).toEqual(["new", "old-a", "old-b"]);
    expect(fillDocs([], 60, rows, new Set(["old-a", "old-b"]), 1)).toEqual(["new", "mid", "old-a"]);
    expect(FILL_OLDER_DOCS).toBeGreaterThanOrEqual(15 * 4 * 2);
  });
  it("orders an undated document by its place and keeps its filing date empty", () => {
    const stored = (id: string, filed: string | null, kind = "press-release") => ({ id, filed, kind, ext: "htm", title: null, bytes: 1000, extract_status: null });
    const got = tableDocRows(
      [stored("a", "2026-10-29"), stored("u-new", null), stored("u-old", null), stored("u-unplaced", null), stored("old", "2016-10-25"), stored("old-unnamed", "2016-07-26")],
      "2026-11-27",
      { older: new Set(["old", "u-old"]), placed: { "u-new": "2026-07-30", "u-old": "2014-07-30" } },
    );
    expect(got.map((d) => d.id)).toEqual(["a", "u-new", "old", "u-old"]);
    expect(got.find((d) => d.id === "u-new")).toMatchObject({ filed: null, placed: "2026-07-30" });
    expect(got.find((d) => d.id === "a")?.placed).toBeUndefined();
    expect(fillDocs([], 60, got, new Set(["old", "u-old"]))).toEqual(["a", "u-new", "old", "u-old"]);
  });
});

describe("a release stored without a filing date that prints its date", () => {
  // Skyworks reported its fourth fiscal quarter of 2026 (ended October 2, 2026) on November 3, 2026.
  const money = (a: string, b: string) => `<td></td><td>${a}</td><td></td><td>${b}</td>`;
  const html = (opening: string) => `<html><body><p>${opening}</p>
<p>UNAUDITED CONSOLIDATED STATEMENTS OF OPERATIONS</p>
<table>
<tr><td></td><td colspan="4">Three Months Ended</td></tr>
<tr><td>(in millions, except per share amounts)</td><td colspan="2">October 2, 2026</td><td colspan="2">October 3, 2025</td></tr>
<tr><td>Net revenue</td>${money("1,045.7", "1,100.2")}</tr>
<tr><td>Cost of goods sold</td>${money("618.3", "652.6")}</tr>
<tr><td>Gross profit</td>${money("427.4", "447.6")}</tr>
<tr><td>Total operating expenses</td>${money("405.1", "336.6")}</tr>
<tr><td>Operating income</td>${money("22.3", "111.0")}</tr>
<tr><td>Net income</td>${money("23.4", "141.4")}</tr>
</table></body></html>`;
  const run = (opening: string) =>
    fillCompany([], async () => html(opening), {
      docs: [{ id: "u", filed: null, kind: "press-release", title: null, placed: "2026-10-30" }],
      reports: ["2026-10-02"],
    });
  it("takes the first date printed within 120 days after the period its statements report", async () => {
    const r = await run("IRVINE, Calif., Nov. 3, 2026 – Skyworks Solutions, Inc. today reported fourth fiscal quarter and year-end results for the period ended October 2, 2026.");
    expect(r.read).toBe(1);
    expect(r.dated.get("u")).toBe("2026-11-03");
    expect(r.facts.length).toBeGreaterThan(0);
    expect(r.facts.every((f) => f.filed === "2026-11-03")).toBe(true);
    expect(r.docs.get("u")?.filed).toBe("2026-11-03");
  });
  it("leaves the date empty when the opening prints none after the period", async () => {
    const r = await run("Skyworks Solutions, Inc. today reported results for the period ended October 2, 2026.");
    expect(r.dated.size).toBe(0);
    expect(r.facts.every((f) => !f.filed)).toBe(true);
  });
});

describe("how much one rebuild downloads", () => {
  it("keeps the worker's bounds unless a catch-up run raises them", () => {
    expect(readLimits({})).toBe(READ_LIMITS);
    const l = readLimits({ IR_FILL_DOCS: "400", IR_FILL_MINUTES: "20" });
    expect(l).toMatchObject({ docs: 400, totalMs: 20 * 60_000, bytes: READ_LIMITS.bytes });
    expect(l.totalBytes).toBeGreaterThan(READ_LIMITS.totalBytes);
    expect(readLimits({ IR_FILL_DOCS: "100000", IR_FILL_MINUTES: "0" })).toMatchObject({ docs: 400, totalMs: READ_LIMITS.totalMs });
  });
});

describe("a quarter printed as this year, a year ago, the quarter before", () => {
  // Entegris, first quarter 2015 release (8-K of April 28, 2015), in thousands, figures as printed.
  const cells = (a: string, b: string, c: string) => [a, b, c].map((x) => `<td></td><td>${x}</td>`).join("");
  const html = `<html><body><p>Entegris, Inc. and Subsidiaries</p><p>Condensed Consolidated Statements of Operations</p><p>(In thousands, except per share data)</p>
<table>
<tr><td></td><td colspan="6">Three months ended</td></tr>
<tr><td></td><td colspan="2">March 28, 2015</td><td colspan="2">March 29, 2014</td><td colspan="2">December 31, 2014</td></tr>
<tr><td>Net sales</td>${cells("263,373", "165,804", "271,633")}</tr>
<tr><td>Cost of sales</td>${cells("146,837", "94,452", "153,713")}</tr>
<tr><td>Gross profit</td>${cells("116,536", "71,352", "117,920")}</tr>
<tr><td>Selling, general and administrative expenses</td>${cells("50,890", "34,787", "58,879")}</tr>
<tr><td>Engineering, research and development expenses</td>${cells("25,800", "15,690", "26,013")}</tr>
<tr><td>Amortization of intangible assets</td>${cells("12,307", "2,336", "12,213")}</tr>
<tr><td>Operating income</td>${cells("27,539", "18,539", "20,815")}</tr>
<tr><td>Income tax expense</td>${cells("4,670", "4,243", "440")}</tr>
<tr><td>Net income</td>${cells("14,872", "14,312", "9,312")}</tr>
</table></body></html>`;
  it("reads all three columns under their own dates", async () => {
    const run = await fillCompany([], async () => html, {
      docs: [{ id: "entg-1q15", filed: "2015-04-28", kind: "press-release", title: null }],
      reports: ["2026-09-26", "2026-06-27", "2026-03-28", "2025-12-31"],
    });
    const sales = (end: string) => run.facts.find((f) => /^net sales$/i.test(f.label) && f.period_end === end && f.months === 3)?.value;
    expect(sales("2015-03-28")).toBe(263_373e3);
    expect(sales("2014-03-29")).toBe(165_804e3);
    expect(sales("2014-12-31")).toBe(271_633e3);
    const net = run.facts.filter((f) => /^net income$/i.test(f.label)).map((f) => [f.period_end, f.value]);
    expect(net).toEqual(expect.arrayContaining([["2015-03-28", 14_872e3], ["2014-03-29", 14_312e3], ["2014-12-31", 9_312e3]]));
  });
  it("still refuses three dates in no order it knows", async () => {
    const odd = html.replace("March 29, 2014", "June 28, 2014");
    const run = await fillCompany([], async () => odd, {
      docs: [{ id: "entg-1q15", filed: "2015-04-28", kind: "press-release", title: null }],
      reports: ["2026-09-26", "2026-06-27", "2026-03-28", "2025-12-31"],
    });
    expect(run.facts).toHaveLength(0);
  });
});

describe("a cell the document hides inside a printed row", () => {
  // Entegris, first quarter 2020 release (8-K of April 21, 2020), in thousands: rows and cell layout as stored.
  // Each line hides a three-column cell after its name; the subtotal rows do not.
  const line = (name: string, a: string, b: string, c: string, money = false) =>
    `<tr><td colspan="5">${name}&#160;</td><td>&#160;</td><td colspan="3" style="display:none"></td>` +
    [a, b, c].map((x) => (money ? `<td>$</td><td>${x}&#160;</td><td>&#160;</td>` : `<td colspan="2">${x}&#160;</td><td>&#160;</td>`)).join("") +
    `</tr>`;
  const subtotal = (name: string, a: string, b: string, c: string) =>
    `<tr><td colspan="3"></td><td colspan="2">${name}&#160;</td><td>&#160;</td>` +
    [a, b, c].map((x) => `<td colspan="2">${x}&#160;</td><td>&#160;</td>`).join("") +
    `</tr>`;
  const html = `<html><body><p>Entegris, Inc. and Subsidiaries</p><p>Condensed Consolidated Statements of Operations</p><p>(In thousands, except per share data)</p>
<table>
<tr><td colspan="3"></td><td colspan="3"></td><td colspan="9">Three months ended</td></tr>
<tr><td colspan="3"></td><td colspan="3"></td><td colspan="3">March 28, 2020</td><td colspan="3">March 30, 2019</td><td colspan="3">December 31, 2019</td></tr>
${line("Net sales", "412,327", "391,047", "426,998", true)}
${line("Cost of sales", "226,849", "213,654", "229,362")}
${subtotal("Gross profit", "185,478", "177,393", "197,636")}
${line("Selling, general and administrative expenses", "58,891", "82,254", "67,171")}
${line("Engineering, research and development expenses", "29,632", "28,991", "30,352")}
${line("Amortization of intangible assets", "16,211", "18,657", "16,028")}
${subtotal("Operating income", "80,744", "47,491", "84,085")}
</table></body></html>`;
  it("takes no column, so every line's figures sit under the dates they were printed under", async () => {
    const run = await fillCompany([], async () => html, {
      docs: [{ id: "entg-1q20", filed: "2020-04-21", kind: "press-release", title: null }],
      reports: ["2026-09-26", "2026-06-27", "2026-03-28", "2025-12-31"],
    });
    const at = (label: RegExp, end: string) => run.facts.find((f) => label.test(f.label) && f.period_end === end && f.months === 3)?.value;
    for (const [end, sales, cost, gross, op] of [
      ["2020-03-28", 412_327e3, 226_849e3, 185_478e3, 80_744e3],
      ["2019-03-30", 391_047e3, 213_654e3, 177_393e3, 47_491e3],
      ["2019-12-31", 426_998e3, 229_362e3, 197_636e3, 84_085e3],
    ] as const) {
      expect(at(/^net sales$/i, end)).toBe(sales);
      expect(at(/^cost of sales$/i, end)).toBe(cost);
      expect(at(/^gross profit$/i, end)).toBe(gross);
      expect(at(/^operating income$/i, end)).toBe(op);
      // The printed statement adds up in every column.
      expect(sales - cost).toBe(gross);
    }
  });
});

describe("exhibits that are not this company's own results", () => {
  // Entegris' 8-K of April 4, 2022, exhibit 99.2: opening text and the table printing CMC Materials' quarter
  // (thousands), as stored.
  const opening =
    "EX-99.2 3 ny20003000x2_ex99-2.htm EXHIBIT 99.2 Exhibit 99.2 UNAUDITED PRO FORMA CONDENSED COMBINED FINANCIAL INFORMATION The following unaudited pro forma condensed combined financial information is based on and derived from the separate historical financial statements of Entegris and CMC";
  const proForma = `<html><body><p>${opening}</p>
<p>The pro forma statement of operations combines the Entegris audited consolidated statement of operations for the year ended December 31, 2021 and the CMC financial results for the twelve months ended December 31, 2021.</p>
<table>
<tr><td>($ in thousands)</td><td>Three Months Ended December 31, 2020</td><td>Three Months Ended December 31, 2021</td></tr>
<tr><td>Revenues</td><td>$287,863</td><td>$317,046</td></tr>
<tr><td>Cost of sales</td><td>164,959</td><td>191,210</td></tr>
<tr><td>Gross profit</td><td>122,904</td><td>125,836</td></tr>
<tr><td>Selling, general and administrative</td><td>55,920</td><td>56,483</td></tr>
<tr><td>Research, development and technical</td><td>12,428</td><td>13,328</td></tr>
<tr><td>Asset impairment charges</td><td>7,347</td><td>9,435</td></tr>
</table></body></html>`;
  const reports = ["2026-09-26", "2026-06-27", "2026-03-28", "2025-12-31"];
  it("knows a pro forma exhibit by how it opens, and a results 8-K by its items", () => {
    expect(proFormaDocument(opening)).toBe(true);
    expect(proFormaDocument("Exhibit 99.1 ENTEGRIS REPORTS RESULTS FOR FIRST QUARTER OF 2020 First-quarter revenue of $412.3 million")).toBe(false);
    expect(resultsExhibit("8-K 2022-04-04 ny20003000x2_ex99-2.htm (Items 7.01,8.01,9.01)")).toBe(false);
    expect(resultsExhibit("8-K 2020-04-21 entgq12020ex991.htm (Items 2.02,9.01)")).toBe(true);
    expect(resultsExhibit("Third quarter 2026 earnings release")).toBeNull();
  });
  it("reads nothing from a pro forma exhibit and leaves out the figures a reader stored from it", async () => {
    const fact = (id: string, label: string, value: number, r: number) =>
      ({ id, document_id: "pf", method: "table", label, value, period_end: "2020-12-31", months: 3, locator: { t: 0, r, c: 1 } }) as never;
    const stored = [fact("f1", "Revenues", 287_863e3, 1), fact("f2", "Cost of sales", 164_959e3, 2)];
    const run = await fillCompany(stored, async () => proForma, {
      docs: [{ id: "pf", filed: "2022-04-04", kind: "supplement", title: "8-K 2022-04-04 ny20003000x2_ex99-2.htm (Items 2.02,9.01)" }],
      reports,
    });
    expect(run.facts).toHaveLength(0);
    expect([...run.proForma]).toEqual(["pf"]);
  });
  it("leaves an exhibit of an 8-K that reported no results unread when no reader took a figure from it", async () => {
    const plain = proForma.replace(opening, "CMC Materials, Inc. Consolidated Statements of Income").replace(/<p>The pro forma[^<]*<\/p>/, "<p>Consolidated Statements of Income</p>");
    const doc = (title: string) => [{ id: "x", filed: "2022-04-04", kind: "supplement", title }];
    const no = await fillCompany([], async () => plain, { docs: doc("8-K 2022-04-04 ex99-1.htm (Items 7.01,8.01,9.01)"), reports });
    expect(no.facts).toHaveLength(0);
    expect(no.notResults).toBe(1);
    const yes = await fillCompany([], async () => plain, { docs: doc("8-K 2022-04-04 ex99-1.htm (Items 2.02,9.01)"), reports });
    expect(yes.facts.length).toBeGreaterThan(0);
  });
  it("never plans such an exhibit as an older quarter's primary statement document", () => {
    const rows = [
      doc("new", "2026-10-29"),
      doc("release", "2022-02-01", "press-release", { title: "8-K 2022-02-01 entgq42021ex991.htm (Items 2.02,9.01)" }),
      doc("proforma", "2022-04-04", "supplement", { title: "8-K 2022-04-04 ny20003000x2_ex99-2.htm (Items 7.01,8.01,9.01)" }),
      doc("q1", "2022-04-26", "press-release", { title: "8-K 2022-04-26 entgq12022ex991.htm (Items 2.02,9.01)" }),
    ];
    const plan = planDocuments(rows);
    expect(plan.older.sort()).toEqual(["q1", "release"]);
    expect(plan.load).not.toContain("proforma");
  });
});

describe("a flow that repeats in the quarter and the year to date", () => {
  // Entegris, third quarter 2026 release (8-K of October 29, 2026), statement of cash flows in millions: rows
  // as printed.
  const r = (name: string, a: string, b: string, c: string, d: string) =>
    `<tr><td colspan="3">${name}</td>${[a, b, c, d].map((x) => `<td colspan="3">${x}</td>`).join("")}</tr>`;
  const html = `<html><body><p>Entegris, Inc. and Subsidiaries</p><p>Condensed Consolidated Statements of Cash Flows</p><p>(In millions)</p>
<table>
<tr><td colspan="3"></td><td colspan="6">Three months ended</td><td colspan="6">Nine months ended</td></tr>
<tr><td colspan="3"></td><td colspan="3">Sep 26, 2026</td><td colspan="3">Sep 27, 2025</td><td colspan="3">Sep 26, 2026</td><td colspan="3">Sep 27, 2025</td></tr>
${r("Net income", "$157.8", "$70.5", "$343.4", "$186.2")}
${r("Acquisition of property, plant and equipment", "(43.2)", "(66.7)", "(124.0)", "(241.2)")}
${r("Proceeds from government incentives", "—", "8.2", "5.4", "8.2")}
${r("Other", "(6.1)", "(1.2)", "(5.3)", "(1.5)")}
${r("Net cash used in investing activities", "(49.3)", "(59.7)", "(123.9)", "(234.5)")}
${r("Proceeds from debt", "—", "25.0", "65.0", "532.0")}
${r("Payments of debt", "(200.0)", "(175.0)", "(515.0)", "(682.0)")}
${r("Net cash used in financing activities", "(216.7)", "(163.9)", "(486.8)", "(204.1)")}
${r("Cash and cash equivalents at end of period", "$356.5", "$399.8", "$356.5", "$399.8")}
</table></body></html>`;
  it("stays a flow; only a line named as a point in time is a balance", async () => {
    const run = await fillCompany([], async () => html, {
      docs: [{ id: "entg-3q26", filed: "2026-10-29", kind: "press-release", title: "8-K 2026-10-29 entgq32026ex991.htm (Items 2.02,9.01)" }],
      reports: ["2026-09-26", "2026-06-27", "2026-03-28", "2025-12-31"],
    });
    const of = (label: RegExp) => run.facts.filter((f) => label.test(f.label)).map((f) => `${f.period_end}/${f.months}=${f.value}`).sort();
    const incentives = of(/^proceeds from government incentives$/i);
    expect(incentives).toContain("2025-09-27/3=8200000");
    expect(incentives).toContain("2025-09-27/9=8200000");
    expect(incentives).toContain("2026-09-26/9=5400000");
    // The nine months' 5.4 is never the quarter's figure, and nothing of the row is a balance.
    expect(incentives.some((x) => x.startsWith("2026-09-26/3=5400000"))).toBe(false);
    expect(incentives.some((x) => /\/0=/.test(x))).toBe(false);
    expect(of(/^cash and cash equivalents at end of period$/i)).toEqual(["2025-09-27/0=399800000", "2026-09-26/0=356500000"]);
  });
});
