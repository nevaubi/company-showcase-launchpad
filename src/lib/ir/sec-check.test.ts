import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IrPayload, PayloadCell, PayloadSeries } from "./payload";
import { agrees, crossCheckSec, stdLineOf, type CheckStatements } from "./sec-check";

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
  quarterly: { periods: Object.keys(q).map((end) => ({ end })), rows: [{ key, cells: Object.values(q).map((v) => ({ v, src: { accn: "0000000000-26-000001", concept: "us-gaap:X" } })) }] },
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
    expect(stdLineOf(series("a", "Revenue", {}, { parent: "p", total: false }))).toBeNull();
  });
});

describe("agreement tolerances", () => {
  it("accepts equal figures and figures equal at their printed precision only", () => {
    expect(agrees(7_685_000_000, 7_685_000_000, "usd")).toBe(true);
    expect(agrees(7_700_000_000, 7_685_000_000, "usd")).toBe(true); // AMD "7.7 billion" in a sentence
    expect(agrees(7_658_000_000, 7_685_000_000, "usd")).toBe(false);
    expect(agrees(4.63, 4.63, "usdPerShare")).toBe(true);
    expect(agrees(4.6, 4.63, "usdPerShare")).toBe(true);
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
    expect(c.flags?.[0].why).toBe("The 10-Q reports $18.64B; this figure is $20.22B (+8.4%).");
  });

  it("leaves periods the filing doesn't carry unchecked, and checks nothing without statements", () => {
    const p = payload([series("rev", "Revenue", { "2026-09-30": cell(1e9) })]);
    expect(crossCheckSec(p, statements("revenue", { "2026-06-30": 9e8 })).check).toMatchObject({ checked: 0 });
    expect(crossCheckSec(p, null)).toEqual({ payload: p, check: null });
  });

  it("restated: says when another printing of the figure agrees with the filing", () => {
    // The release shows the newer printing; the 10-Q matches the value first printed (alt).
    const c = cell(25_100_000_000, { alt: { v: 24_995_000_000, kind: "restated", d: 1 } });
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
});
