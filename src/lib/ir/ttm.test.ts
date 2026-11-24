import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { IrPayload, PayloadSeries } from "@/lib/ir/payload";
import { fiscalCalendar, periodGrids, uniqueHeads } from "@/lib/ir/periods";
import { tidyPayload } from "@/lib/ir/tidy";
import { crossCheckSec } from "@/lib/ir/sec-check";
import { annualEnds, offYearEnds, splitTrailing, trailingLine, trailingShown } from "@/lib/ir/ttm";

const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/** Lines in the reviewers' transfer format: ticker|category|metric|unit|is_total|label|parent|breakdown|q:..|y:.. */
function load(file: string, ticker?: string): PayloadSeries[] {
  return readFileSync(path.resolve(__dirname, "fixtures", file), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((ln) => ln.split("|"))
    .filter((f) => !ticker || f[0] === ticker)
    .map((f, i) => {
      const cells = (str: string, m: number) =>
        Object.fromEntries(
          str.slice(2).split(",").filter(Boolean).map((c, j) => [iso(c.split("=")[0]), { v: Number(c.split("=")[1].split("~")[0]), d: i * 100 + j, m }]),
        );
      const pit = f[3] === "pct" || f[3] === "count";
      return { k: `${f[0]}${i}`, cat: f[1], met: f[2], unit: f[3], total: f[4] === "1", label: f[5], parent: null, bd: f[7] || undefined, ...(pit ? { pit: true } : {}), q: cells(f[8], pit ? 0 : 3), y: cells(f[9], 12) } as PayloadSeries;
    });
}

function payload(ticker: string, series: PayloadSeries[]): IrPayload {
  const qs = new Set<string>();
  const ys = new Set<string>();
  for (const s of series) {
    for (const e of Object.keys(s.q)) qs.add(e);
    for (const e of Object.keys(s.y)) ys.add(e);
  }
  return {
    v: 2,
    ticker,
    builtAt: "",
    quarters: [...qs].sort(),
    years: [...ys].sort(),
    docs: [],
    series,
    groups: [],
    checks: [],
    stats: { series: series.length, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } },
  };
}

const cellsShown = (p: IrPayload, k: string) => {
  const s = p.series.find((x) => x.k === k);
  return s ? Object.keys(s.q).length + Object.keys(s.y).length : 0;
};

describe("p3-ir H1: trailing-twelve-month figures never sit under a quarter or fiscal-year head", () => {
  it("takes the reviewer's TTM lines (AMP, AMZN, EQH, HIG, UNFI, ZM; production rows of 24 Nov) out of the quarter and year columns", () => {
    const counts: Record<string, [number, number]> = {};
    for (const t of ["AMP", "AMZN", "EQH", "HIG", "UNFI", "ZM"]) {
      const raw = payload(t, load("ttm-lines.txt", t));
      const out = tidyPayload(raw);
      counts[t] = [trailingShown(raw).length, trailingShown(out).length];
    }
    // Before: every TTM line of the sample shows under quarter or year heads (ZM's two customer counts
    // are quarter-end counts above a TTM revenue threshold, not TTM figures).
    expect(counts).toEqual({ AMP: [4, 0], AMZN: [2, 0], EQH: [4, 0], HIG: [4, 0], UNFI: [4, 0], ZM: [0, 0] });
  });

  it("says how many it left out, per line and for the page", () => {
    const raw = payload("AMZN", load("ttm-lines.txt", "AMZN"));
    const out = splitTrailing(raw);
    expect(out.stats.ttm).toBe(14);
    expect(out.series.map((s) => s.ttm)).toEqual([7, 7]);
    // Columns only TTM figures filled are gone: no "Mar ’26 / fiscal year" head is left to show.
    expect(out.years).toEqual([]);
    expect(periodGrids(out).y).toEqual([]);
  });

  it("keeps quarter-end counts whose twelve months qualify a threshold (ZM customers above $100K of TTM revenue)", () => {
    const zm = load("ttm-lines.txt", "ZM");
    expect(zm.map(trailingLine)).toEqual([false, false]);
    const out = splitTrailing(payload("ZM", zm));
    expect(out.series.map((s) => Object.keys(s.q).length)).toEqual([3, 2]);
  });

  it("HOOD: 12-month figures at Sep 2025, Mar 2026 and Jun 2025/2026 get no fiscal-year head once the 10-K year-end is known; FY 2025 figures stay", () => {
    const raw = payload("HOOD", load("hood-lines.txt"));
    const fyHeads = (p: IrPayload) => [...uniqueHeads(periodGrids(p).y, "y", fiscalCalendar(p)).entries()].filter(([e]) => e !== "2025-12-31").map(([, h]) => h);
    // Before: Sep 2025, Mar 2026 and the June columns all head as years.
    expect(fyHeads(raw).length).toBe(4);
    // The payload alone: the named lines leave (Sep 2025, Mar 2026); June has as many plain 12-month
    // figures as December, so the payload cannot tell which month closes the year.
    const tidied = tidyPayload(raw);
    expect(tidied.years).toEqual(["2025-06-30", "2025-12-31", "2026-06-30"]);
    // With HOOD's 10-K years (December), as the page's SEC check has them.
    const st = { annual: { periods: [{ end: "2024-12-31", start: "2024-01-01" }, { end: "2025-12-31", start: "2025-01-01" }], rows: [] } };
    const { payload: out } = crossCheckSec(tidied, st);
    expect(trailingShown(raw, annualEnds(st.annual.periods)).length).toBe(12);
    expect(trailingShown(out, annualEnds(st.annual.periods))).toEqual([]);
    expect(periodGrids(out).y).toEqual(["2025-12-31"]);
    expect(fyHeads(out)).toEqual([]);
    expect(uniqueHeads(periodGrids(out).y, "y", fiscalCalendar(out)).get("2025-12-31")?.main).toBe("FY25");
    // FY 2025 provision for credit losses (114M) and revenue (4,473M) are still shown.
    expect(out.series.some((s) => s.y["2025-12-31"]?.v === 114_000_000)).toBe(true);
    expect(out.series.some((s) => s.y["2025-12-31"]?.v === 4_473_000_000)).toBe(true);
    expect(out.stats.ttm).toBe(13);
  });

  it("reads the fiscal year-end from the payload when a derived Q4 says it", () => {
    const s = (k: string, y: Record<string, number>, q: Record<string, { v: number; f?: string }> = {}): PayloadSeries => ({
      k, cat: "income", met: "revenue", unit: "usd", label: k, parent: null, total: true,
      y: Object.fromEntries(Object.entries(y).map(([e, v]) => [e, { v, m: 12 }])),
      q: Object.fromEntries(Object.entries(q).map(([e, c]) => [e, { v: c.v, m: 3, ...(c.f ? { f: { formula: c.f, parts: [] } } : {}) }])),
    });
    const series = [s("a", { "2025-06-30": 3.6e9, "2026-06-30": 4.9e9 }), s("b", { "2025-12-31": 4.47e9 }, { "2025-12-31": { v: 1.27e9, f: "Full year − Q1 − Q2 − Q3" } })];
    expect([...offYearEnds(series)]).toEqual(["2026-06-30"]);
  });

  it("KEY C3: a quarter cell whose sentence says trailing twelve months leaves the quarter column", () => {
    // Reviewer's row: Consumer banking revenue 3,600,000,000 at 2025-09-30, deck ee403652, stored as 3 months.
    const rev: PayloadSeries = {
      k: "rev",
      cat: "income",
      met: "revenue",
      unit: "usd",
      label: "Revenue",
      parent: null,
      total: true,
      bd: "Consumer banking",
      q: {
        "2025-03-31": { v: 1_850_000_000, m: 3, d: 0 },
        "2025-06-30": { v: 1_870_000_000, m: 3, d: 1 },
        "2025-09-30": { v: 3_600_000_000, m: 3, d: 2, x: "(2) Calculated on a trailing twelve-month basis $3.6Bn Revenue(2)" },
      },
      y: {},
    };
    const raw = payload("KEY", [rev]);
    const out = splitTrailing(raw);
    expect(Object.keys(out.series[0].q)).toEqual(["2025-03-31", "2025-06-30"]);
    expect(out.stats.ttm).toBe(1);
    expect(out.quarters).not.toContain("2025-09-30");
  });

  it("leaves a payload without TTM figures untouched", () => {
    const raw = payload("LKQ", load("lkq-lines.txt"));
    expect(splitTrailing(raw)).toBe(raw);
    expect(cellsShown(raw, raw.series[0].k)).toBeGreaterThan(0);
  });
});
