import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IrPayload, PayloadCell, PayloadSeries } from "./payload";
import { agrees, crossCheckSec, stdLineOf, type CheckStatements } from "./sec-check";
import { keyLines } from "./highlights";
import { periodGrids } from "./periods";
import { tidyPayload } from "./tidy";

// Real rows: IR standard-line values copied from production with the checksum-verified transfer
// (ticker|line|period_end|months|values[|…]|md5-6); fixtures/README.txt describes the files.
function realValues(file: string, t: string, line: string, e: string, m: number): number[] {
  for (const ln of readFileSync(path.resolve(__dirname, "fixtures", file), "utf8").split("\n")) {
    if (!ln) continue;
    const body = ln.slice(0, ln.lastIndexOf("|"));
    expect(createHash("md5").update(body).digest("hex").slice(0, 6)).toBe(ln.slice(ln.lastIndexOf("|") + 1));
    const p = body.split("|");
    if (p[0] === t && p[1] === line && p[2] === e && Number(p[3]) === m) return p.length >= 7 ? [Number(p[4])] : p[4].split(",").map(Number);
  }
  throw new Error(`no row ${t} ${line} ${e}`);
}

const cell = (v: number, extra: Partial<PayloadCell> = {}): PayloadCell => ({ v, d: 0, e: "x", ...extra });
const series = (k: string, label: string, q: Record<string, PayloadCell>, extra: Partial<PayloadSeries> = {}): PayloadSeries => ({ k, cat: "income", met: "revenue", label, parent: null, total: true, unit: "usd", q, y: {}, ...extra });
const payload = (s: PayloadSeries[]): IrPayload => ({
  v: 2, ticker: "TST", builtAt: "", quarters: [...new Set(s.flatMap((x) => Object.keys(x.q)))].sort(), years: [], docs: [], groups: s.map((x) => ({ id: x.k, cat: x.cat, met: x.met, unit: x.unit, label: x.label, root: x.k, rows: [{ k: x.k, depth: 0 }] })), checks: [], series: s,
  stats: { series: s.length, groups: s.length, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } },
});
const statements = (key: string, q: Record<string, number>, y: Record<string, number> = {}): CheckStatements => ({
  quarterly: { periods: Object.keys(q).map((end) => ({ end })), rows: [{ key, cells: Object.values(q).map((v) => ({ v, src: { accn: "TEST-ACCN", concept: "us-gaap:X" } })) }] },
  annual: { periods: Object.keys(y).map((end) => ({ end })), rows: [{ key, cells: Object.values(y).map((v) => ({ v })) }] },
});

describe("which IR lines stand for a standard statement line", () => {
  it("takes consolidated names and leaves segments, other bases and annualized figures out", () => {
    expect(stdLineOf(series("a", "Total net revenue", {}))).toBe("revenue");
    expect(stdLineOf(series("a", "Net sales", {}))).toBe("revenue");
    expect(stdLineOf(series("a", "Operating income (loss)", {}))).toBe("operatingIncome");
    expect(stdLineOf(series("a", "Net income attributable to PNC", {}))).toBe("netIncome");
    expect(stdLineOf(series("a", "Net income attributable to noncontrolling interests", {}))).toBeNull();
    expect(stdLineOf(series("a", "Diluted", {}, { unit: "usdPerShare" }))).toBe("epsDiluted");
    expect(stdLineOf(series("a", "Net interest income", {}, { parent: "p", total: false }))).toBe("netInterestIncome");
    // Real production lines that a name test alone would take (see the accuracy report):
    expect(stdLineOf(series("a", "Total", {}, { bd: "Operating Income by Reportable Segments" }))).toBeNull(); // NVDA
    expect(stdLineOf(series("a", "Net interest income (annualized) (GAAP)", {}, { parent: "p", total: false }))).toBeNull(); // CFG
    expect(stdLineOf(series("a", "Operating income", {}, { bd: "Experiences operating income by business" }))).toBeNull(); // DIS
    expect(stdLineOf(series("a", "Adjusted operating income", {}))).toBeNull();
    expect(stdLineOf(series("a", "Diluted earnings per share (EPS)", {}, { unit: "usdPerShare", bd: "Per Common Share" }))).toBe("epsDiluted"); // PNC
    expect(stdLineOf(series("a", "Net interest income", {}, { total: false, bd: "Retail Banking segment results" }))).toBeNull(); // PNC segment
    expect(stdLineOf(series("a", "Revenue", {}, { parent: "p", total: false }))).toBeNull();
  });
});

describe("agreement tolerances", () => {
  it("accepts equal figures and figures equal at their printed precision only", () => {
    expect(agrees(7_685_000_000, 7_685_000_000, "usd")).toBe(true);
    expect(agrees(7_700_000_000, 7_685_000_000, "usd")).toBe(true); // AMD "7.7 billion" in a sentence
    expect(agrees(7_658_000_000, 7_685_000_000, "usd")).toBe(true); // 0.35%: within the 0.5% total tolerance
    expect(agrees(7_640_000_000, 7_685_000_000, "usd")).toBe(false);
    expect(agrees(4.63, 4.63, "usdPerShare")).toBe(true);
    expect(agrees(4.6, 4.63, "usdPerShare")).toBe(true); // within 1%
    expect(agrees(4.58, 4.63, "usdPerShare")).toBe(false);
  });
});

describe("cross-check against the SEC statements", () => {
  it("counts agreeing figures and changes nothing (AMD revenue, real values)", () => {
    const [ir] = realValues("std-lines-b01.txt", "AMD", "rev", "2025-06-28", 3);
    const p = payload([series("rev", "Revenue", { "2025-06-28": cell(ir) })]);
    const { payload: out, check } = crossCheckSec(p, statements("revenue", { "2025-06-28": 7_685_000_000 }));
    expect(check).toMatchObject({ checked: 1, agree: 1, held: 0, flagged: 0 });
    expect(out.series[0].q["2025-06-28"].v).toBe(ir);
    expect(out.series[0].q["2025-06-28"].flags).toBeUndefined();
  });

  it("holds a figure the filing contradicts by 1,000× (PNC net interest income Q4 2025, real values)", () => {
    const [bad] = realValues("std-lines-b06.txt", "PNC", "nii", "2025-12-31", 3);
    const ok = realValues("std-lines-b06.txt", "PNC", "nii", "2025-09-30", 3)[0];
    const p = payload([series("nii", "Net interest income", { "2025-09-30": cell(ok), "2025-12-31": cell(bad) }, { parent: "rev", total: false, met: "revenue" })]);
    const { payload: out, check } = crossCheckSec(p, statements("netInterestIncome", { "2025-09-30": 3_648_000_000, "2025-12-31": 3_731_000_000 }));
    expect(check).toMatchObject({ checked: 2, agree: 1, held: 1 });
    expect(out.series[0].q["2025-12-31"]).toBeUndefined();
    expect(out.series[0].held?.q?.["2025-12-31"]).toMatchObject({ v: bad, w: "suspect" });
    expect(out.series[0].held?.q?.["2025-12-31"].why).toMatch(/1,000× .*unit contradicted/);
    expect(out.stats.held).toBe(1);
  });

  it("holds a sign the filing contradicts (UNFI net loss, real values)", () => {
    const [ir] = realValues("std-lines-b10.txt", "UNFI", "ni", "2025-08-02", 3);
    const p = payload([series("ni", "Net income (loss)", { "2025-08-02": cell(ir) })]);
    const { check } = crossCheckSec(p, statements("netIncome", { "2025-08-02": -87_000_000 }));
    expect(check?.items[0]).toMatchObject({ status: "held" });
    expect(check?.items[0].why).toMatch(/sign contradicted/);
  });

  it("holds an annualized figure in a quarter column", () => {
    const p = payload([series("nii", "Net interest income", { "2024-03-31": cell(5_796_000_000) }, { parent: "x", total: false })]);
    const { check } = crossCheckSec(p, statements("netInterestIncome", { "2024-03-31": 1_442_000_000 }));
    expect(check?.items[0].status).toBe("held");
    expect(check?.items[0].why).toMatch(/four times/);
  });

  it("flags, never holds, a figure that differs for no stated reason, with both numbers", () => {
    const p = payload([series("opi", "Operating income", { "2024-07-28": cell(20_217_000_000) })]);
    const { payload: out, check } = crossCheckSec(p, statements("operatingIncome", { "2024-07-28": 18_642_000_000 }));
    expect(check).toMatchObject({ checked: 1, flagged: 1, held: 0 });
    const c = out.series[0].q["2024-07-28"];
    expect(c.v).toBe(20_217_000_000);
    expect(c.flags?.[0]).toMatchObject({ k: "sec", v: 18_642_000_000 });
    expect(c.flags?.[0].why).toBe("The 10-Q (TEST-ACCN) gives $18.64B; this figure is $20.22B (+8.4%).");
  });

  it("adds no noncontrolling-interest note without evidence for it (review M5; PNC Q2 2026, real values)", () => {
    const [ir] = realValues("std-lines-b06.txt", "PNC", "ni", "2026-06-30", 3);
    const p = payload([series("ni", "Net income", { "2026-06-30": cell(ir) }, { bd: "Consolidated Financial Highlights" })]);
    const { check } = crossCheckSec(p, statements("netIncome", { "2026-06-30": 2_040_000_000 }));
    expect(check?.items[0]).toMatchObject({ status: "flagged", ir: 2_055_000_000 });
    expect(check?.items[0].why).not.toMatch(/noncontrolling interests/);
  });

  it("leaves periods the filing doesn't carry unchecked, and checks nothing without statements", () => {
    const p = payload([series("rev", "Revenue", { "2026-09-30": cell(1e9) })]);
    expect(crossCheckSec(p, statements("revenue", { "2026-06-30": 9e8 })).check).toMatchObject({ checked: 0 });
    expect(crossCheckSec(p, null)).toEqual({ payload: p, check: null });
  });

  it("restated: says when another printing of the figure agrees with the filing", () => {
    // The release shows the newer printing; the 10-Q matches the value first printed (alt).
    const c = cell(25_300_000_000, { alt: { v: 24_995_000_000, kind: "restated", d: 1 } });
    const p = payload([series("nii", "Net interest income", { "2025-12-31": c }, { parent: "x", total: false })]);
    const { check } = crossCheckSec(p, statements("netInterestIncome", { "2025-12-31": 24_995_000_000 }));
    expect(check?.items[0].status).toBe("flagged");
    expect(check?.items[0].why).toMatch(/An earlier document prints \$25.00B, which agrees/);
  });

  it("compares only lines the size of the consolidated figure (a segment's NII is not checked)", () => {
    const vals = realValues("std-lines-b06.txt", "PNC", "nii", "2025-09-30", 3); // bank 3,648 and segments 1,888 / 3,050 / 3,016
    const p = payload(vals.map((v, i) => series(`n${i}`, "Net interest income", { "2025-09-30": cell(v) }, { parent: `t${i}`, total: false })));
    const { check } = crossCheckSec(p, statements("netInterestIncome", { "2025-09-30": 3_648_000_000 }));
    expect(check).toMatchObject({ checked: 1, agree: 1 });
  });

  it("holds a calculated value that uses a held figure and drops tie-out checks on it", () => {
    const p = payload([
      series("rev", "Revenue", {
        "2025-03-31": cell(1e9), "2025-06-30": cell(1.1e12), "2025-09-30": cell(1.2e9),
        "2025-12-31": cell(1.3e9, { f: { formula: "Full year − Q1 − Q2 − Q3", parts: [{ label: "FY", v: 4.6e9, sign: 1, e: "2025-12-31", m: 12 }, { label: "Q2", v: 1.1e12, sign: -1, e: "2025-06-30", m: 3 }] } }),
      }),
    ]);
    p.checks = [{ k: "rev", e: "2025-06-30", kind: "q", total: 1.1e12, sum: 1.1e12, ok: true, n: 2 }];
    const { payload: out } = crossCheckSec(p, statements("revenue", { "2025-06-30": 1.1e9 }));
    expect(out.series[0].held?.q?.["2025-06-30"]).toBeDefined();
    expect(out.series[0].held?.q?.["2025-12-31"]?.why).toMatch(/calculated from a figure/);
    expect(out.checks).toHaveLength(0);
  });

  it("shows again what the unit guard held when the filing confirms it, and holds the slips instead (ACN revenue, real values)", () => {
    // ACN's stored revenue mixes dollar figures (4 quarters) and figures read in thousands (5 quarters):
    // the guard's vote held the correct dollar quarters. The 10-Q settles it.
    const ends = ["2024-02-29", "2024-08-31", "2024-11-30", "2025-02-28", "2025-05-31", "2025-08-31", "2025-11-30", "2026-02-28", "2026-05-31"];
    const sec = [15_799_514_000, 16_405_819_000, 17_689_545_000, 16_659_301_000, 17_727_871_000, 17_596_260_000, 18_742_125_000, 18_044_066_000, 18_718_144_000];
    const q = Object.fromEntries(ends.map((e, i) => [e, { v: realValues("std-lines-b09.txt", "ACN", "rev", e, 3)[0], d: i, e, m: 3 }]));
    const tidied = tidyPayload(payload([series("rev", "Revenue", q, { cat: "segment", bd: "Revenue" })]));
    const heldBefore = Object.keys(tidied.series[0].held?.q ?? {});
    expect(heldBefore.length).toBeGreaterThan(0);
    const { payload: out, check } = crossCheckSec(tidied, statements("revenue", Object.fromEntries(ends.map((e, i) => [e, sec[i]]))));
    const shown = out.series[0].q;
    // every dollar quarter is shown, every thousands quarter is held, none corrected
    for (const [i, e] of ends.entries()) {
      if (q[e].v === sec[i]) expect(shown[e]?.v).toBe(sec[i]);
      else expect(out.series[0].held?.q?.[e]?.v).toBe(q[e].v);
    }
    expect(check?.released).toBe(heldBefore.filter((e) => q[e].v === sec[ends.indexOf(e)]).length);
  });
});

// Real companies and periods found by an independent review run: IR rows through the tidy, checked
// against EDGAR companyfacts put through buildStatements. Sign first, real sources, other measures.
describe("review fixes: sign first, real sources, other measures", () => {
  const st = (key: string, q: Record<string, number>, accn = "0001065696-26-000056", y: Record<string, number> = {}, derived?: string): CheckStatements => ({
    quarterly: { periods: Object.keys(q).map((end) => ({ end })), rows: [{ key, cells: Object.values(q).map((v) => ({ v, ...(derived ? { derived } : { src: { accn, concept: "us-gaap:X" } }) })) }] },
    annual: { periods: Object.keys(y).map((end) => ({ end })), rows: [{ key, cells: Object.values(y).map((v) => ({ v, src: { accn, concept: "us-gaap:X" } })) }] },
  });

  it("C1 VSAT Q1 FY26: a wrongly signed larger line no longer shields the next one (+47.7M against a −56.4M loss)", () => {
    const p = payload([
      series("a", "Net income (loss) attributable to Viasat, Inc.", { "2025-06-30": cell(56_434_000) }, { bd: "Net income attributable to parent" }),
      series("b", "Net income (loss)", { "2025-06-30": cell(47_724_000) }, { bd: "Net income" }),
    ]);
    const { payload: out, check } = crossCheckSec(p, st("netIncome", { "2025-06-30": -56_434_000 }, "0001193125-25-170000"));
    const b = check!.items.find((x) => x.k === "b")!;
    expect(check!.items.find((x) => x.k === "a")!.status).toBe("held");
    expect(b.status).toBe("flagged");
    expect(b.why).toMatch(/a loss; this figure, \$47\.7M, has the opposite sign/);
    expect(out.series.find((s) => s.k === "b")!.q["2025-06-30"].flags?.some((f) => f.k === "sec")).toBe(true);
    expect(check!.agree).toBe(0);
  });

  it("C1 LKQ Q3 2026: +18M and +19M net income and 0.06 EPS against the 10-Q's −27M and −0.10 are all marked", () => {
    const p = payload([
      series("h", "Net (loss) income", { "2026-09-30": cell(27_000_000) }, { bd: "Net income" }),
      series("r1", "Net (loss) income attributable to LKQ stockholders", { "2026-09-30": cell(18_000_000) }, { bd: "Net income reconciliation" }),
      series("r2", "Net (loss) income", { "2026-09-30": cell(19_000_000) }, { bd: "Net income reconciliation" }),
    ]);
    const { check } = crossCheckSec(p, st("netIncome", { "2026-09-30": -27_000_000 }));
    expect(check!.items.map((x) => [x.k, x.status])).toEqual([["h", "held"], ["r1", "flagged"], ["r2", "flagged"]]);
    const eps = payload([series("e", "Diluted (loss) earnings per share: Reported", { "2026-09-30": cell(0.06) }, { unit: "usdPerShare", bd: "EPS" })]);
    expect(crossCheckSec(eps, st("epsDiluted", { "2026-09-30": -0.1 })).check!.items[0].status).toBe("flagged");
  });

  it("C2 HPQ Q4 FY25 EPS: the comparison figure is named as the 10-K year less nine months, and one cent is not a disagreement", () => {
    const p = payload([series("e", "GAAP diluted net earnings per share", { "2025-10-31": cell(0.84) }, { unit: "usdPerShare", bd: "Earnings per share" })]);
    const { check } = crossCheckSec(p, st("epsDiluted", { "2025-10-31": 0.83 }, "", { "2025-10-31": 2.65 }, "FY − Q1 − Q2 − Q3"));
    expect(check!.items[0].status).toBe("agree");
    expect(check!.items[0].why).toMatch(/10-K year less the first nine months/);
    // LULU Q4: 6.14 against a derived 6.09 is within 1%
    const l = payload([series("e", "Diluted earnings per share", { "2026-02-01": cell(6.14) }, { unit: "usdPerShare" })]);
    expect(crossCheckSec(l, st("epsDiluted", { "2026-02-01": 6.09 }, "", { "2026-02-01": 14.6 }, "FY − Q1 − Q2 − Q3")).check!.items[0].status).toBe("agree");
  });

  it("C2 LKQ Q1 2025 revenue: a comparative from a 2026 filing (recast) is not called a 10-Q disagreement", () => {
    const p = payload([series("r", "Total Revenue", { "2025-03-31": cell(3_463_000_000) }, { bd: "Revenue by product" })]);
    const { payload: out, check } = crossCheckSec(p, st("revenue", { "2025-03-31": 3_327_000_000 }, "0001065696-26-000020"));
    expect(check!.items[0].status).toBe("later");
    expect(check!.items[0].why).toMatch(/filed in 2026 \(after this period's own filing\); that filing may have recast/);
    expect(check!.flagged).toBe(0);
    expect(out.series[0].q["2025-03-31"].flags).toBeUndefined();
    // the same figure from the period's own 10-Q (filed 2025) is a plain disagreement, named by accession
    const own = crossCheckSec(p, st("revenue", { "2025-03-31": 3_327_000_000 }, "0001065696-25-000028")).check!.items[0];
    expect(own.status).toBe("flagged");
    expect(own.why).toMatch(/^The 10-Q \(0001065696-25-000028\) gives \$3\.33B/);
  });

  it("H3 Realty Income FFO/AFFO, LKQ guidance and trailing-twelve-month lines are never compared with GAAP lines", () => {
    expect(stdLineOf(series("a", "FFO per diluted share", {}, { unit: "usdPerShare" }))).toBeNull();
    expect(stdLineOf(series("a", "Diluted", {}, { unit: "usdPerShare", bd: "AFFO" }))).toBeNull();
    expect(stdLineOf(series("a", "Net income", {}, { bd: "Forecasted FY 2025 Net Income" }))).toBeNull();
    expect(stdLineOf(series("a", "Total Net Revenues (Last twelve months)", {}))).toBeNull();
    expect(stdLineOf(series("a", "Net income", {}, { bd: "GAAP net income" }))).toBe("netIncome");
  });

  it("H4 tolerances: opposite signs never agree; EPS within one cent or 1%; totals within 0.5%", () => {
    expect(agrees(300_000, -150_000, "usd")).toBe(false);
    expect(agrees(2, 2.45, "usdPerShare")).toBe(false);
    expect(agrees(0.84, 0.83, "usdPerShare")).toBe(true);
    expect(agrees(4.7e9, 4.692e9, "usd")).toBe(true);
    expect(agrees(346_000_000, 350_000_000, "usd")).toBe(false);
    expect(agrees(3_463_000_000, 3_465_000_000, "usd")).toBe(true);
  });

  it("M2 UNFI 'Loss per diluted share' 0.35 carries its sign in the label and agrees with −0.35", () => {
    const p = payload([series("e", "Loss per diluted share (EPS)", { "2024-11-02": cell(0.35) }, { unit: "usdPerShare" })]);
    expect(crossCheckSec(p, st("epsDiluted", { "2024-11-02": -0.35 }, "0001020859-24-000050")).check!.items[0].status).toBe("agree");
  });
});

describe("review fixes: a segment total is not the consolidated line", () => {
  it("LKQ Q2 2026 'Total Revenue' 1,466M (43% of the 10-Q's 3,408M): skipped in a table that splits the company, flagged in one that does not", () => {
    const st: CheckStatements = { quarterly: { periods: [{ end: "2026-06-30" }], rows: [{ key: "revenue", cells: [{ v: 3_408_000_000, src: { accn: "0001065696-26-000044" } }] }] } };
    const part = payload([series("t", "Total Revenue", { "2026-06-30": cell(1_466_000_000) }, { bd: "Revenue by geography" })]);
    expect(crossCheckSec(part, st).check!.checked).toBe(0);
    // a table named "Total Revenue" does not say it is a part: the figure is compared and carries both numbers
    const whole = payload([series("t", "Total Revenue", { "2026-06-30": cell(1_466_000_000) }, { bd: "Total Revenue" })]);
    const r = crossCheckSec(whole, st);
    expect(r.check!.items[0]).toMatchObject({ status: "flagged", sec: 3_408_000_000 });
    expect(r.payload.series[0].q["2026-06-30"].flags?.[0]).toMatchObject({ k: "sec", v: 3_408_000_000 });
  });
});

// The reviewer's KEY rows (p3-ir C1-C3: SQL 2026-11-24, values, documents and dates as stored) and the
// statements the app's buildStatements makes from KEY's EDGAR companyfacts (fetched 2026-11-24;
// accessions as there); only the cells the check reads are copied.
describe("p3-ir review: no wrong KEY figure passes unmarked", () => {
  // [value, accession] or [value, null] for a quarter the statements derive (10-K year less nine months)
  const keySt = (key: string, q: Record<string, [number, string | null]>): CheckStatements => ({
    quarterly: { periods: Object.keys(q).map((end) => ({ end })), rows: [{ key, cells: Object.values(q).map(([v, accn]) => (accn ? { v, src: { accn, concept: "us-gaap:X" } } : { v, derived: "FY total − 9M YTD" })) }] },
    annual: { periods: [], rows: [] },
  });

  it("C1 provision Q4 2025 39M (a deck chart's Q4 2024 bar) against the 10-K's 108M is held, not skipped for being under half", () => {
    // deck 255026d2 stored the chart's five bars under 2025-12-31; the shown vintage is 39M
    const c = cell(39_000_000, { alt: { v: 107_000_000, kind: "conflict", d: 1 } });
    const p = payload([series("pv", "Provision for credit losses", { "2025-12-31": c }, { cat: "cost", met: "cost", total: false, bd: "Credit quality" })]);
    const st = keySt("provisionCreditLosses", { "2024-12-31": [39_000_000, null], "2025-03-31": [118_000_000, "0001628280-26-030507"], "2025-06-30": [138_000_000, "0001628280-26-052671"], "2025-09-30": [107_000_000, "0000091576-26-000023"], "2025-12-31": [108_000_000, null] });
    const { payload: out, check } = crossCheckSec(p, st);
    expect(check!.items[0]).toMatchObject({ status: "held", ir: 39_000_000, sec: 108_000_000 });
    expect(check!.items[0].why).toMatch(/SEC figure for the quarter ending 2024-12-31/);
    expect(out.series[0].q["2025-12-31"]).toBeUndefined();
    expect(out.series[0].held?.q?.["2025-12-31"]).toMatchObject({ v: 39_000_000, w: "suspect" });
  });

  it("C1 the same chart bar that matches no other quarter is still flagged, never skipped", () => {
    const p = payload([series("pv", "Provision for credit losses", { "2025-12-31": cell(39_000_000) }, { cat: "cost", met: "cost", total: false, bd: "Credit quality" })]);
    const { check } = crossCheckSec(p, keySt("provisionCreditLosses", { "2025-12-31": [108_000_000, null] }));
    expect(check!.items[0]).toMatchObject({ status: "flagged", sec: 108_000_000 });
  });

  it("C2 NII Q1 2025 1,223M (a bridge chart's bar) is flagged although another line of the period agrees with the filing's 1,096M (a 2026 comparative)", () => {
    const p = payload([
      series("a", "Net interest income", { "2025-03-31": cell(1_223_000_000) }, { bd: "Income statement" }),
      series("b", "Net interest income (GAAP)", { "2025-03-31": cell(1_096_000_000) }, { bd: "Pre-provision net revenue" }),
    ]);
    const { payload: out, check } = crossCheckSec(p, keySt("netInterestIncome", { "2025-03-31": [1_096_000_000, "0001628280-26-030507"] }));
    const byK = Object.fromEntries(check!.items.map((x) => [x.k, x.status]));
    expect(byK).toEqual({ a: "flagged", b: "agree" });
    expect(out.series[0].q["2025-03-31"].flags?.[0]).toMatchObject({ k: "sec", v: 1_096_000_000 });
  });

  it("C2 the same bar nested under the income statement's Revenue (real parent) is compared too", () => {
    const p = payload([
      series("rev", "Revenue", {}, { bd: "Income statement" }),
      series("a", "Net interest income", { "2025-03-31": cell(1_223_000_000) }, { parent: "rev", total: false, bd: "Income statement" }),
      series("b", "Net interest income (GAAP)", { "2025-03-31": cell(1_096_000_000) }, { bd: "Pre-provision net revenue" }),
    ]);
    const { check } = crossCheckSec(p, keySt("netInterestIncome", { "2025-03-31": [1_096_000_000, "0001628280-26-030507"] }));
    expect(Object.fromEntries(check!.items.map((x) => [x.k, x.status]))).toEqual({ a: "flagged", b: "agree" });
  });

  it("C2 a segment's line of the same name beside an agreeing one is still not compared", () => {
    const p = payload([
      series("a", "Net interest income", { "2025-03-31": cell(800_000_000) }, { bd: "Net interest income by segment" }),
      series("b", "Net interest income", { "2025-03-31": cell(1_096_000_000) }, { bd: "Income statement" }),
    ]);
    const { check } = crossCheckSec(p, keySt("netInterestIncome", { "2025-03-31": [1_096_000_000, "0001628280-26-030507"] }));
    expect(check!.items.map((x) => [x.k, x.status])).toEqual([["b", "agree"]]);
  });

  it("C3 Consumer Bank revenue 3.6B (trailing twelve months) against a later 10-Q's 1,895M is flagged: a recast does not move a figure 90%", () => {
    const p = payload([series("r", "Revenue", { "2025-09-30": cell(3_600_000_000) }, { bd: "Consumer banking" })]);
    const { payload: out, check } = crossCheckSec(p, keySt("revenue", { "2025-09-30": [1_895_000_000, "0000091576-26-000023"] }));
    expect(check!.items[0]).toMatchObject({ status: "flagged", ir: 3_600_000_000, sec: 1_895_000_000 });
    expect(check!.items[0].why).toMatch(/filed in 2026 .* gives \$1\.90B; this figure is \$3\.60B \(\+90\.0%\)\. A recast does not move a figure this far\./);
    expect(out.series[0].q["2025-09-30"].flags?.[0]).toMatchObject({ k: "sec", v: 1_895_000_000 });
    // within 15% a later comparative still reads as a possible recast
    const near = payload([series("r", "Revenue", { "2025-09-30": cell(2_050_000_000) }, { bd: "Consumer banking" })]);
    expect(crossCheckSec(near, keySt("revenue", { "2025-09-30": [1_895_000_000, "0000091576-26-000023"] })).check!.items[0].status).toBe("later");
  });
});

// p5-ir4 item 1: the new checks run on the kit and review payloads (measure.ts) newly held two right LKQ
// figures as another quarter's. Statement cells are LKQ's EDGAR companyfacts (fetched 2026-11-24): each
// period's newest filing, as buildStatements keeps it.
describe("p5-ir4: another quarter's figure needs its digits, and a figure near its own period is that period's", () => {
  const lkqSt = (key: string, q: Record<string, [number, string]>): CheckStatements => ({
    quarterly: { periods: Object.keys(q).map((end) => ({ end })), rows: [{ key, cells: Object.values(q).map(([v, accn]) => ({ v, src: { accn, concept: "us-gaap:X" } })) }] },
    annual: { periods: [], rows: [] },
  });

  it("LKQ revenue Q1 2025 3,463M (the original 10-Q's figure; a 2026 10-Q recasts it to 3,327M) is not held as Q2 2023's 3,448M", () => {
    const p = payload([series("r", "Revenue", { "2025-03-31": cell(3_463_000_000) }, { bd: "Revenue" })]);
    const st = lkqSt("revenue", { "2023-06-30": [3_448_000_000, "0001065696-24-000112"], "2025-03-31": [3_327_000_000, "0001065696-26-000033"] });
    const { payload: out, check } = crossCheckSec(p, st);
    expect(check!.items[0]).toMatchObject({ status: "later", ir: 3_463_000_000, sec: 3_327_000_000 });
    expect(out.series[0].q["2025-03-31"]?.v).toBe(3_463_000_000);
  });

  it("LKQ net income Q2 2025 192M against its own 193M is not held as Q3 2024's 192M (flagged: another line agrees)", () => {
    const p = payload([
      series("a", "Net (loss) income attributable to LKQ stockholders", { "2025-06-30": cell(192_000_000) }, { bd: "Net income reconciliation" }),
      series("b", "Net income", { "2025-06-30": cell(193_000_000) }, { bd: "Consolidated income statement" }),
    ]);
    const st = lkqSt("netIncome", { "2024-09-30": [192_000_000, "0001065696-25-000063"], "2025-06-30": [193_000_000, "0001065696-26-000044"] });
    const { payload: out, check } = crossCheckSec(p, st);
    expect(Object.fromEntries(check!.items.map((x) => [x.k, x.status]))).toEqual({ a: "flagged", b: "agree" });
    expect(out.series[0].q["2025-06-30"]?.v).toBe(192_000_000);
  });

  it("KEY C2 with KEY's real Q1 2026 1,222M in the statements stays held (same digits, 11.6% from its own period)", () => {
    const p = payload([series("a", "Net interest income", { "2025-03-31": cell(1_223_000_000) }, { bd: "Income statement" })]);
    const st = lkqSt("netInterestIncome", { "2025-03-31": [1_096_000_000, "0001628280-26-030507"], "2026-03-31": [1_222_000_000, "0001628280-26-030507"] });
    const { check } = crossCheckSec(p, st);
    expect(check!.items[0]).toMatchObject({ status: "held" });
    expect(check!.items[0].why).toMatch(/quarter ending 2026-03-31/);
  });
});

// p5-ir4 item 1: LKQ's table named "Total Revenue" (fixtures/lkq-lines.txt; production document ae0bce8a and
// 2a335b4b print "Total Revenue" 129M, 1,442M and 1,607M for Q2 2025) is a split of the company by its own lines.
describe("p5-ir4: a table whose lines print several totals for one period, none the filing's, splits the company", () => {
  const st: CheckStatements = { quarterly: { periods: [{ end: "2025-06-30" }], rows: [{ key: "revenue", cells: [{ v: 3_513_000_000, src: { accn: "0001065696-25-000044", concept: "us-gaap:Revenues" } }] }] }, annual: { periods: [], rows: [] } };
  const conflict = (v: number) => ({ alt: { v, d: 1, kind: "conflict" as const } });

  it("LKQ Q2 2025: 1,607M and 129M (beside 1,442M) against the 10-Q's 3,513M are not flagged", () => {
    const p = payload([
      series("a", "Total Revenue", { "2025-06-30": cell(1_607_000_000) }, { bd: "Total Revenue", total: false }),
      series("b", "Total Revenue", { "2025-06-30": cell(129_000_000, conflict(1_442_000_000)) }, { bd: "Total Revenue" }),
    ]);
    const { payload: out, check } = crossCheckSec(p, st);
    expect(check!.items.filter((x) => x.status === "flagged" || x.status === "held")).toEqual([]);
    expect(out.series.every((s) => !s.q["2025-06-30"]?.flags?.length)).toBe(true);
  });

  it("a lone 1,466M under that title is still flagged, and so is a part beside a printing of the filing's figure", () => {
    const lone = payload([series("a", "Total Revenue", { "2025-06-30": cell(1_466_000_000) }, { bd: "Total Revenue" })]);
    expect(crossCheckSec(lone, st).check!.items[0].status).toBe("flagged");
    const beside = payload([series("b", "Total Revenue", { "2025-06-30": cell(465_000_000, conflict(3_513_000_000)) }, { bd: "Revenue" })]);
    expect(crossCheckSec(beside, st).check!.items[0].status).toBe("flagged");
  });
});

// p3-ir C4 at read time: the VSAT payload stored before the build fix (IR kit payload VSAT.json, line
// "Total Revenue" of "Revenue by segment", values as stored) and Viasat's 10-Q revenue (EDGAR companyfacts
// via buildStatements; the two derived quarters carry no accession).
describe("p5-ir4: a stored line that mixes a segment total into the company's revenue", () => {
  const vsatLine = () =>
    series("t", "Total Revenue", { "2025-03-31": cell(454_300_000), "2025-06-30": cell(1_171_054_000), "2025-09-30": cell(1_141_000_000), "2025-12-31": cell(459_700_000), "2026-03-31": cell(465_200_000), "2026-06-30": cell(1_156_543_000) }, { cat: "segment", bd: "Revenue by segment" });
  const sec: Record<string, [number, string | null]> = { "2024-12-31": [1_123_767_000, "0001193125-26-041421"], "2025-03-31": [1_147_082_000, null], "2025-06-30": [1_171_054_000, "0001193125-26-337903"], "2025-09-30": [1_140_893_000, "0001193125-26-452035"], "2025-12-31": [1_157_045_000, "0001193125-26-041421"], "2026-03-31": [1_171_288_000, null], "2026-06-30": [1_156_543_000, "0001193125-26-337903"], "2026-09-30": [1_179_996_000, "0001193125-26-452035"] };
  const st: CheckStatements = { quarterly: { periods: Object.keys(sec).map((end) => ({ end })), rows: [{ key: "revenue", cells: Object.values(sec).map(([v, accn]) => (accn ? { v, src: { accn, concept: "us-gaap:Revenues" } } : { v, derived: "FY total − 9M YTD" })) }] }, annual: { periods: [], rows: [] } };

  it("holds the three segment-level quarters with the reason and keeps the consolidated ones", () => {
    const { payload: out, check } = crossCheckSec(payload([vsatLine()]), st);
    const held = check!.items.filter((x) => x.status === "held").map((x) => x.e).sort();
    expect(held).toEqual(["2025-03-31", "2025-12-31", "2026-03-31"]);
    expect(check!.items.find((x) => x.e === "2026-03-31")!.why).toMatch(/\$465M is 40% of the 10-Q's revenue .* another level of the company/);
    expect(Object.keys(out.series[0].q).sort()).toEqual(["2025-06-30", "2025-09-30", "2026-06-30"]);
    expect(out.series[0].held?.q?.["2025-12-31"]).toMatchObject({ v: 459_700_000 });
  });

  it("no key metric is computed across the break (was +148.6% against the quarter before)", () => {
    const { payload: out } = crossCheckSec(payload([vsatLine()]), st);
    const before = keyLines(payload([vsatLine()]), periodGrids(payload([vsatLine()])).q).find((l) => l.s.k === "t");
    expect(before?.qoq).toBeCloseTo(148.6, 0);
    const after = keyLines(out, out.quarters).find((l) => l.s.k === "t");
    expect(after?.qoq ?? null).toBeNull();
  });

  it("a real jump in the company's revenue is not a break: the filing moves with the line", () => {
    const jump = series("t", "Total revenue", { "2025-06-30": cell(500_000_000), "2025-09-30": cell(1_200_000_000) });
    const { check } = crossCheckSec(payload([jump]), statements("revenue", { "2025-06-30": 500_000_000, "2025-09-30": 1_200_000_000 }));
    expect(check!.items.map((x) => x.status)).toEqual(["agree", "agree"]);
  });
});

describe("p3-ir L1: a segment table that lists one segment is checked", () => {
  // The reviewer's ZM line (lines.ok, production of 23 Nov) and ZM's 10-Q revenue (companyfacts,
  // RevenueFromContractWithCustomerExcludingAssessedTax, 0001585521-25-000141 and -000202).
  const zm: PayloadSeries = { k: "zm", cat: "segment", met: "revenue", unit: "usd", label: "Total revenue", parent: null, total: true, bd: "Revenue by segment", q: { "2025-07-31": { v: 1_217_200_000, d: 0, m: 3 }, "2025-10-31": { v: 1_229_800_000, d: 1, m: 3 } }, y: {} };
  const payloadOf = (series: PayloadSeries[]): IrPayload => ({ v: 2, ticker: "ZM", builtAt: "", quarters: ["2025-07-31", "2025-10-31"], years: [], docs: [], series, groups: [], checks: [], stats: { series: series.length, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } } });
  const st = (a: number, b: number): CheckStatements => ({ quarterly: { periods: [{ end: "2025-07-31" }, { end: "2025-10-31" }], rows: [{ key: "revenue", cells: [{ v: a, src: { accn: "0001585521-25-000141" } }, { v: b, src: { accn: "0001585521-25-000202" } }] }] }, annual: { periods: [], rows: [] } });

  it("ZM's total revenue is compared and agrees in both quarters", () => {
    const { check } = crossCheckSec(payloadOf([zm]), st(1_217_227_000, 1_229_835_000));
    expect(check?.checked).toBe(2);
    expect(check?.items.map((x) => x.status)).toEqual(["agree", "agree"]);
  });

  it("a segment total of a company with several segments stays out", () => {
    const kids: PayloadSeries[] = ["A", "B"].map((n) => ({ ...zm, k: `zm${n}`, label: `Segment ${n}`, total: false, parent: "zm" }));
    const { check } = crossCheckSec(payloadOf([zm, ...kids]), st(1_217_227_000, 1_229_835_000));
    expect(check?.checked ?? 0).toBe(0);
  });

  it("a one-segment total far from the filing is not read as the whole (no flag)", () => {
    const { payload } = crossCheckSec(payloadOf([zm]), st(3_000_000_000, 3_100_000_000));
    expect(payload.series[0].q["2025-07-31"].flags ?? []).toEqual([]);
  });
});
