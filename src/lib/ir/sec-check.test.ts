import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IrPayload, PayloadCell, PayloadSeries } from "./payload";
import { agrees, crossCheckSec, stdLineOf, type CheckStatements } from "./sec-check";
import { tidyPayload } from "./tidy";

// Real rows: IR standard-line values copied from production with the checksum-verified transfer
// (ticker|line|period_end|months|values[|…]|md5-6), see /home/claude/fu/round3/reports/iracc_data.
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

// Fix pass (review iracc C1, C2, H3, H4, M2): real companies and periods, values from the reviewer's
// independent run (/home/claude/work/r3/review-iracc/r2/summary.txt: IR rows through tidy against
// EDGAR companyfacts put through buildStatements).
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
    expect(check!.items[0].why).toMatch(/filed in 2026, after this period's own filing; that filing may have recast/);
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
