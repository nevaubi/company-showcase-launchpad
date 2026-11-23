import { describe, expect, it } from "vitest";
import { pickDetailFilings } from "../../scripts/lib/detail-pick";

const isAnnual = (f: string) => f === "10-K" || f === "10-KT";
const idx = (cik: string, rows: [string, string, string][]) => ({ cik, r: { accessionNumber: rows.map((x) => x[0]), form: rows.map((x) => x[1]), filingDate: rows.map((x) => x[2]) } });

describe("filing detail picks across registrants", () => {
  it("with one index: the first annual and the first 10-Q before it (the old rule)", () => {
    const one = idx("320193", [["a4", "8-K", "2026-11-01"], ["a3", "10-Q", "2026-08-01"], ["a2", "10-K", "2026-02-01"], ["a1", "10-Q", "2025-11-01"]]);
    const p = pickDetailFilings([one], isAnnual);
    expect([p.annual?.i, p.quarterly?.i]).toEqual([2, 1]);
    const noQ = idx("1", [["b2", "10-K", "2026-02-01"], ["b1", "10-Q", "2025-11-01"]]);
    expect(pickDetailFilings([noQ], isAnnual).quarterly).toBeNull();
  });
  it("XOM: the annual report under 34088, the November 10-Q under 2115436", () => {
    const now = idx("2115436", [["0002115436-26-000020", "10-Q", "2026-11-02"], ["0000034088-26-000093", "10-Q", "2026-08-03"]]);
    const old = idx("34088", [["0000034088-26-000093", "10-Q", "2026-08-03"], ["0000034088-26-000067", "10-Q", "2026-05-04"], ["0000034088-26-000045", "10-K", "2026-02-18"]]);
    const p = pickDetailFilings([now, old], isAnnual);
    expect(p.annual && [p.annual.src.cik, p.annual.src.r.accessionNumber[p.annual.i]]).toEqual(["34088", "0000034088-26-000045"]);
    expect(p.quarterly && [p.quarterly.src.cik, p.quarterly.src.r.accessionNumber[p.quarterly.i]]).toEqual(["2115436", "0002115436-26-000020"]);
  });
});
