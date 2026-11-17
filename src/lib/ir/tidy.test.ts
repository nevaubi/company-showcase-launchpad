import { describe, expect, it } from "vitest";
import { groupColumns, groupTitle } from "./display";
import type { IrPayload, PayloadCheck, PayloadGroup, PayloadSeries } from "./payload";
import { dropStrays } from "./periods";
import { labelTokens, tidyPayload } from "./tidy";

type Vals = Record<string, number>;
const line = (k: string, label: string, q: Vals, extra: Partial<PayloadSeries> = {}): PayloadSeries => ({
  k,
  cat: "segment",
  met: "revenue",
  label,
  parent: null,
  total: false,
  unit: "usd",
  q: Object.fromEntries(Object.entries(q).map(([e, v]) => [e, { v, d: 0, e }])),
  y: {},
  ...extra,
});
const table = (id: string, root: string, rows: string[], extra: Partial<PayloadGroup> = {}): PayloadGroup => ({
  id,
  cat: "segment",
  met: "revenue",
  unit: "usd",
  label: "",
  root,
  rows: [...rows.map((k) => ({ k, depth: 1 })), { k: root, depth: 0 }],
  ...extra,
});
const payload = (series: PayloadSeries[], groups: PayloadGroup[], checks: PayloadCheck[] = []): IrPayload => ({
  v: 2,
  ticker: "TST",
  builtAt: "2026-01-01",
  quarters: [...new Set(series.flatMap((s) => Object.keys(s.q)))].sort(),
  years: [],
  docs: [{ id: "d0", accn: "a", doc: "x.htm", kind: "press-release", filed: "2026-01-01" }],
  series,
  groups,
  checks,
  stats: { series: series.length, groups: groups.length, documents: 1, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } },
});
const cellsOf = (p: IrPayload, k: string) => {
  const s = p.series.find((x) => x.k === (p.alias?.[k] ?? k));
  return s ? Object.fromEntries(Object.entries(s.q).map(([e, c]) => [e, c.v])) : null;
};

describe("one table per subject", () => {
  // The same segment table, printed 2023 under one wording and 2024 under another.
  const old = [
    line("o:hs", "Total revenues — Health Services", { "2023-03-31": 100, "2023-06-30": 110 }, { parent: "o:t" }),
    line("o:ph", "Total revenues — Pharmacy Services", { "2023-03-31": 200, "2023-06-30": 210 }, { parent: "o:t" }),
    line("o:t", "Net revenues", { "2023-03-31": 300, "2023-06-30": 320 }, { total: true }),
  ];
  const now = [
    line("n:hs", "Health Services", { "2024-03-31": 120, "2024-06-30": 125 }, { parent: "n:t" }),
    line("n:ph", "Pharmacy Services", { "2024-03-31": 230, "2024-06-30": 240 }, { parent: "n:t" }),
    line("n:t", "Total revenues", { "2024-03-31": 350, "2024-06-30": 365 }, { total: true }),
  ];
  const p = payload([...old, ...now], [table("old", "o:t", ["o:hs", "o:ph"]), table("now", "n:t", ["n:hs", "n:ph"])], [
    { k: "o:t", e: "2023-03-31", kind: "q", total: 300, sum: 300, ok: true, n: 2 },
    { k: "n:t", e: "2024-03-31", kind: "q", total: 350, sum: 350, ok: true, n: 2 },
  ]);
  const t = tidyPayload(p);

  it("joins an old and a new era of a breakdown into one continuous table", () => {
    expect(t.groups).toHaveLength(1);
    expect(t.series).toHaveLength(3);
    expect(cellsOf(t, "o:hs")).toEqual({ "2023-03-31": 100, "2023-06-30": 110, "2024-03-31": 120, "2024-06-30": 125 });
    expect(cellsOf(t, "n:t")).toEqual({ "2023-03-31": 300, "2023-06-30": 320, "2024-03-31": 350, "2024-06-30": 365 });
  });
  it("names merged lines as the company names them now and keeps old keys resolvable", () => {
    expect(t.series.map((s) => s.label).sort()).toEqual(["Health Services", "Pharmacy Services", "Total revenues"]);
    expect(Object.keys(t.alias ?? {}).length).toBe(3);
  });
  it("checks every period of the merged table against the surviving total", () => {
    const root = t.groups[0].root!;
    expect(t.checks.map((c) => `${c.k === root}|${c.e}|${c.ok}`).sort()).toEqual(["true|2023-03-31|true", "true|2023-06-30|true", "true|2024-03-31|true", "true|2024-06-30|true"]);
  });
  it("never changes a number while merging", () => {
    for (const s of p.series) for (const [e, c] of Object.entries(s.q)) expect(cellsOf(t, s.k)![e]).toBe(c.v);
  });
  it("is idempotent", () => {
    expect(tidyPayload(t)).toBe(t);
  });
});

describe("tables that only look alike stay apart", () => {
  it("keeps adjusted and GAAP tables separate and titles them apart", () => {
    const gaap = [
      line("g:a", "Health Services", { "2025-03-31": 10, "2025-06-30": 12 }, { parent: "g:t", met: "operating_income" }),
      line("g:b", "Pharmacy Services", { "2025-03-31": 20, "2025-06-30": 22 }, { parent: "g:t", met: "operating_income" }),
      line("g:t", "Operating income (GAAP measure)", { "2025-03-31": 30, "2025-06-30": 34 }, { total: true, met: "operating_income" }),
    ];
    const adj = [
      line("a:a", "Health Services", { "2025-03-31": 15, "2025-06-30": 16 }, { parent: "a:t", met: "operating_income" }),
      line("a:b", "Pharmacy Services", { "2025-03-31": 25, "2025-06-30": 27 }, { parent: "a:t", met: "operating_income" }),
      line("a:t", "Adjusted operating income", { "2025-03-31": 40, "2025-06-30": 43 }, { total: true, met: "operating_income" }),
    ];
    const t = tidyPayload(payload([...gaap, ...adj], [table("g", "g:t", ["g:a", "g:b"], { met: "operating_income" }), table("a", "a:t", ["a:a", "a:b"], { met: "operating_income" })]));
    expect(t.groups).toHaveLength(2);
    expect(t.series).toHaveLength(6);
    const titles = t.groups.map((g) => groupTitle(g));
    expect(new Set(titles).size).toBe(2);
    expect(titles.some((x) => /Adjusted|GAAP/.test(x))).toBe(true);
  });

  it("never merges a level with its change, even when one value coincides", () => {
    const s = [line("l", "Equity volume", { "2025-03-31": 1500, "2025-06-30": 1600 }, { cat: "kpi", met: "volume" }), line("c", "Equity volume — net change", { "2025-03-31": 1500, "2025-09-30": 80 }, { cat: "kpi", met: "volume" })];
    const t = tidyPayload(payload(s, [{ id: "loose", cat: "kpi", met: "volume", unit: "usd", label: "", root: null, rows: [{ k: "l", depth: 0 }, { k: "c", depth: 0 }] }]));
    expect(t.series).toHaveLength(2);
  });

  it("drops a year that is only a column header but keeps a year that names a maturity", () => {
    const loose = (rows: string[]): PayloadGroup => ({ id: "loose", cat: "balance", met: "other", unit: "usd", label: "", root: null, rows: rows.map((k) => ({ k, depth: 0 })) });
    const header = [line("h24", "Lease liabilities — 2024", { "2024-12-31": 500 }, { cat: "balance", met: "other", pit: true }), line("h25", "Lease liabilities — 2025", { "2025-12-31": 520 }, { cat: "balance", met: "other", pit: true })];
    const t1 = tidyPayload(payload(header, [loose(["h24", "h25"])]));
    expect(t1.series).toHaveLength(1);
    expect(t1.series[0].label).toBe("Lease liabilities");
    const maturity = [line("m10", "Debt maturity - 2010", { "2009-12-31": 700 }, { cat: "balance", met: "other", pit: true }), line("m11", "Debt maturity - 2011", { "2010-12-31": 650 }, { cat: "balance", met: "other", pit: true })];
    expect(tidyPayload(payload(maturity, [loose(["m10", "m11"])])).series).toHaveLength(2);
  });
});

describe("label words", () => {
  it("ignore footnote marks, units and generic words but keep age bands", () => {
    expect(labelTokens("Total pharmacy claims processed (5)")).toEqual(["pharmacy", "claim", "processed"]);
    expect(labelTokens("60 and Up")).not.toEqual(labelTokens("62 and Up"));
  });
});

describe("table columns", () => {
  const s = line("x", "X", { "2025-06-30": 1, "2025-12-31": 3 });
  const cols = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];
  it("start at the oldest and end at the newest value, keeping gaps in between", () => {
    expect(groupColumns([{ s }], cols, "q")).toEqual(["2025-06-30", "2025-09-30", "2025-12-31"]);
  });
  it("leave out an almost empty date next to a busy quarter-end", () => {
    const busy = Array.from({ length: 12 }, (_, i) => line(`b${i}`, `B${i}`, { "2025-09-30": i, "2025-12-31": i, "2026-03-31": i }));
    const stray = line("s", "As of", { "2025-12-09": 5 });
    expect(dropStrays({ series: [...busy, stray] }, ["2025-09-30", "2025-12-09", "2025-12-31", "2026-03-31"], (x) => x.q)).toEqual(["2025-09-30", "2025-12-31", "2026-03-31"]);
  });
});

describe("bare totals", () => {
  it("names a total printed as just TOTAL after its table's measure", () => {
    const out = tidyPayload(
      payload(
        [
          line("t", "TOTAL", { "2025-06-30": 100 }, { total: true }),
          line("a", "Data Center", { "2025-06-30": 90 }, { parent: "t" }),
          line("b", "Gaming", { "2025-06-30": 10 }, { parent: "t" }),
        ],
        [table("segment|revenue|total|usd|", "t", ["a", "b"])],
      ),
    );
    expect(out.series.find((s) => s.k === "t")?.label).toBe("Total revenue");
  });
});

describe("segment tables", () => {
  const M = 1e6;
  const Q1 = "2025-03-31";
  const Q2 = "2025-06-30";
  // The company's segment revenue table (ties out) names the segments.
  const revenue = [
    line("r:hs", "Health Services", { [Q1]: 400 * M, [Q2]: 420 * M }, { parent: "r:t" }),
    line("r:ps", "Pharmacy Services", { [Q1]: 600 * M, [Q2]: 630 * M }, { parent: "r:t" }),
    line("r:t", "Total revenues", { [Q1]: 1000 * M, [Q2]: 1050 * M }, { total: true }),
  ];
  const revChecks: PayloadCheck[] = [
    { k: "r:t", e: Q1, kind: "q", total: 1000 * M, sum: 1000 * M, ok: true, n: 2 },
    { k: "r:t", e: Q2, kind: "q", total: 1050 * M, sum: 1050 * M, ok: true, n: 2 },
  ];
  const oi = (k: string, label: string, q: Vals, extra: Partial<PayloadSeries> = {}) => line(k, label, q, { met: "segment_profit", ...extra });
  const loose = (id: string, rows: string[]): PayloadGroup => ({ id, cat: "segment", met: "segment_profit", unit: "usd", label: "", root: null, rows: rows.map((k) => ({ k, depth: 1 })) });
  const scattered = [
    // Q1 from one release's segment table, Q2 from each segment's own results table.
    oi("a:hs", "Adjusted operating income — Health Services", { [Q1]: 40 * M }),
    oi("a:ps", "Adjusted operating income — Pharmacy Services", { [Q1]: 60 * M }),
    oi("b:hs", "Adjusted operating income", { [Q2]: 45 * M }, { sc: "Health Services segment results" }),
    oi("b:ps", "Adjusted operating income", { [Q2]: 65 * M }, { sc: "Pharmacy Services segment results" }),
    oi("c:t", "Adjusted operating income", { [Q1]: 100 * M, [Q2]: 110 * M }, { total: true, sc: "Consolidated summary" }),
  ];
  const build = () =>
    tidyPayload(payload([...revenue, ...scattered], [table("rev", "r:t", ["r:hs", "r:ps"]), loose("l1", ["a:hs", "a:ps"]), loose("l2", ["b:hs"]), loose("l3", ["b:ps"]), loose("l4", ["c:t"])], revChecks));

  it("gathers one measure's lines from every table into one row per segment, closed by the consolidated line", () => {
    const t = build();
    const g = t.groups.find((x) => x.t === "Adjusted operating income by segment");
    expect(g).toBeTruthy();
    const rows = g!.rows.map((r) => t.series.find((s) => s.k === r.k)!);
    expect(rows.map((s) => s.label)).toEqual(["Pharmacy Services", "Health Services", "Adjusted operating income"]);
    expect(cellsOf(t, "a:hs")).toEqual({ [Q1]: 40 * M, [Q2]: 45 * M });
    expect(cellsOf(t, "a:ps")).toEqual({ [Q1]: 60 * M, [Q2]: 65 * M });
    expect(t.checks.filter((x) => x.k === g!.root).map((x) => [x.e, x.ok])).toEqual([
      [Q1, true],
      [Q2, true],
    ]);
  });

  it("keeps the revenue table's own total and checks", () => {
    const t = build();
    const rev = t.groups.find((x) => x.root === "r:t");
    expect(rev?.rows.map((r) => r.k)).toEqual(["r:ps", "r:hs", "r:t"]);
    expect(t.checks.filter((x) => x.k === "r:t").every((x) => x.ok)).toBe(true);
  });

  it("never takes a regional 'Other' as the segment table's 'Other'", () => {
    const withOther = [
      ...revenue.slice(0, 2),
      line("r:o", "Other", { [Q1]: 5 * M }, { parent: "r:t" }),
      line("r:t", "Total revenues", { [Q1]: 1005 * M, [Q2]: 1050 * M }, { total: true }),
      line("g:o", "Other", { [Q2]: 77 * M }, { cat: "geography", parent: "g:t" }),
      line("g:us", "United States", { [Q2]: 973 * M }, { cat: "geography", parent: "g:t" }),
      line("g:t", "Total revenue", { [Q2]: 1050 * M }, { cat: "geography", total: true }),
    ];
    const t = tidyPayload(
      payload(withOther, [table("rev", "r:t", ["r:hs", "r:ps", "r:o"]), table("geo", "g:t", ["g:us", "g:o"], { cat: "geography" })], [{ ...revChecks[0], total: 1005 * M, sum: 1005 * M, n: 3 }, revChecks[1]]),
    );
    expect(cellsOf(t, "r:o")).toEqual({ [Q1]: 5 * M });
    expect(cellsOf(t, "g:o")).toEqual({ [Q2]: 77 * M });
  });
});

describe("figures printed two ways", () => {
  const M = 1e6;
  const loose = (rows: string[]): PayloadGroup => ({ id: "loose", cat: "kpi", met: "other", unit: "usd", label: "", root: null, rows: rows.map((k) => ({ k, depth: 1 })) });
  it("treats a rounded slide figure and the exact release figure as one, keeping the exact one", () => {
    const s = [
      line("a", "Premiums written", { "2025-03-31": 1308 * M, "2025-06-30": 1400 * M }, { cat: "kpi", met: "other" }),
      line("b", "Premiums written", { "2025-03-31": 1300 * M, "2025-09-30": 1500 * M }, { cat: "kpi", met: "other" }),
    ];
    const t = tidyPayload(payload(s, [loose(["a", "b"])]));
    expect(t.series).toHaveLength(1);
    expect(cellsOf(t, "a")).toEqual({ "2025-03-31": 1308 * M, "2025-06-30": 1400 * M, "2025-09-30": 1500 * M });
  });
  it("still treats a real difference as a different line", () => {
    const s = [
      line("a", "Premiums written", { "2025-03-31": 1308 * M }, { cat: "kpi", met: "other" }),
      line("b", "Premiums written", { "2025-03-31": 1200 * M }, { cat: "kpi", met: "other" }),
    ];
    expect(tidyPayload(payload(s, [loose(["a", "b"])])).series).toHaveLength(2);
  });
});
