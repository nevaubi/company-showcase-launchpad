import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IrPayload, PayloadSeries } from "./payload";
import { mergeTwinEnds } from "./twins";
import { cleanMember } from "./tidy";

// Real MU rows (checksum-verified transfer): revenue printed for fiscal 2026 under 27 Aug 2026 (fiscal
// end in one document) and 3 Sep 2026 (the release), the same figures under both dates.
function rows(t: string, line: string) {
  const out: { e: string; m: number; v: number }[] = [];
  for (const ln of readFileSync(path.resolve(__dirname, "fixtures/std-lines-b01.txt"), "utf8").split("\n")) {
    if (!ln) continue;
    const body = ln.slice(0, ln.lastIndexOf("|"));
    expect(createHash("md5").update(body).digest("hex").slice(0, 6)).toBe(ln.slice(ln.lastIndexOf("|") + 1));
    const p = body.split("|");
    if (p[0] === t && p[1] === line) out.push({ e: p[2], m: Number(p[3]), v: Number(p[4]) });
  }
  return out;
}

const payloadOf = (series: PayloadSeries[]): IrPayload => ({
  v: 2, ticker: "MU", builtAt: "", quarters: [...new Set(series.flatMap((s) => Object.keys(s.q)))].sort(), years: [...new Set(series.flatMap((s) => Object.keys(s.y)))].sort(), docs: [], groups: [], checks: [], series,
  stats: { series: series.length, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } },
});

describe("twin period columns", () => {
  const mu = rows("MU", "rev");
  const rev: PayloadSeries = { k: "rev", cat: "income", met: "revenue", label: "Revenue", parent: null, total: true, unit: "usd", q: Object.fromEntries(mu.filter((r) => r.m === 3).map((r) => [r.e, { v: r.v, d: 0 }])), y: Object.fromEntries(mu.filter((r) => r.m === 12).map((r) => [r.e, { v: r.v, d: 0 }])) };
  it("joins a quarter and year printed under two dates a week apart with the same figures (MU fiscal 2026)", () => {
    expect(Object.keys(rev.q)).toEqual(expect.arrayContaining(["2026-08-27", "2026-09-03"]));
    const out = mergeTwinEnds(payloadOf([rev]));
    expect(out.quarters.filter((e) => e >= "2026-08-01")).toHaveLength(1);
    expect(out.years.filter((e) => e >= "2026-08-01")).toHaveLength(1);
    const q = out.series[0].q;
    expect(Object.values(q).filter((c) => c.v === 54_229_000_000)).toHaveLength(1);
    expect(out.series[0].y[out.years.at(-1)!].v).toBe(133_188_000_000);
  });
  it("decides one end per period for quarters and years together (iracc-M4, reviewer's edge case E10)", () => {
    const a = "2026-08-27";
    const b = "2026-09-03";
    const S = (k: string, q: Record<string, number>, y: Record<string, number>): PayloadSeries => ({ k, cat: "income", met: "other", label: k, parent: null, total: true, unit: "usd", q: Object.fromEntries(Object.entries(q).map(([e, v]) => [e, { v, d: 0 }])), y: Object.fromEntries(Object.entries(y).map(([e, v]) => [e, { v, d: 0 }])) });
    // Quarter cells sit mostly under b, year cells mostly under a: deciding each kind alone dropped both columns.
    const series = [S("Revenue", { [a]: 100, [b]: 100 }, { [a]: 400, [b]: 400 }), S("Net income", { [a]: 10, [b]: 10 }, { [a]: 40, [b]: 40 }), S("Gross profit", { [b]: 50 }, { [a]: 200 }), S("Opex", { [b]: 30 }, { [a]: 120 }), S("Capex", { [b]: 5 }, { [a]: 20 })];
    const p = { ...payloadOf(series), quarters: ["2026-05-28", a, b], years: [a, b] };
    const out = mergeTwinEnds(p);
    expect(out.quarters).toHaveLength(2);
    expect(out.years).toHaveLength(1);
    const kept = out.years[0];
    expect(out.quarters).toContain(kept);
    for (const s of out.series) {
      expect(Object.keys(s.q), s.label).toEqual([kept]);
      expect(Object.keys(s.y), s.label).toEqual([kept]);
    }
  });
  it("keeps the same end for MU's quarter and year columns (real revenue and operating income rows)", () => {
    const opi = rows("MU", "opi");
    const op: PayloadSeries = { k: "opi", cat: "income", met: "operating_income", label: "Operating income", parent: null, total: true, unit: "usd", q: Object.fromEntries(opi.filter((r) => r.m === 3).map((r) => [r.e, { v: r.v, d: 0 }])), y: Object.fromEntries(opi.filter((r) => r.m === 12).map((r) => [r.e, { v: r.v, d: 0 }])) };
    const out = mergeTwinEnds(payloadOf([rev, op]));
    const qs = out.quarters.filter((e) => e >= "2026-08-01");
    const ys = out.years.filter((e) => e >= "2026-08-01");
    expect(qs).toHaveLength(1);
    expect(ys).toEqual(qs);
  });
  it("keeps dates a week apart that print different figures (a retail month next to a quarter)", () => {
    const s: PayloadSeries = { ...rev, q: { "2026-01-31": { v: 5, d: 0 }, "2026-02-07": { v: 7, d: 0 } }, y: {} };
    const out = mergeTwinEnds(payloadOf([s]));
    expect(out.quarters).toEqual(["2026-01-31", "2026-02-07"]);
  });
});

describe("segment names", () => {
  it("keeps a name that starts with a table word ('Data Center', round 2 open item)", () => {
    expect(cleanMember("Data Center revenue")).toBe("Data Center");
    expect(cleanMember("Health Care Benefits adjusted operating income")).toBe("Health Care Benefits");
    expect(cleanMember("Selected data Gaming revenue")).toBe("Gaming");
  });
});
