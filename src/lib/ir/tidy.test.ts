import { describe, expect, it } from "vitest";
import { groupColumns, groupTitle } from "./display";
import type { IrPayload, PayloadCheck, PayloadGroup, PayloadSeries } from "./payload";
import { dropStrays } from "./periods";
import { alikeLabels, labelTokens, tidyPayload } from "./tidy";

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

describe("a line repeated one level down after two eras of a table merge", () => {
  // NVIDIA revenue by market platform, $ millions: the old table lists Auto and "OEM & Other" under the
  // total; the new one nests Automotive and "OEM and Other" under Edge Computing. Same numbers, so the
  // old lines fold into the nested ones instead of being counted twice (546 and 696 over the total).
  const Q = (a: number, b: number) => ({ "2024-10-27": a * 1e6, "2025-01-26": b * 1e6 });
  const series = [
    line("dc", "Data Center", Q(30771, 35580), { parent: "rev" }),
    line("edge", "Edge Computing", Q(4311, 3751), { parent: "rev", total: true }),
    line("gam", "Gaming", Q(3279, 2544), { parent: "edge" }),
    line("pv", "Professional Visualization", Q(486, 511), { parent: "edge" }),
    line("auto2", "Automotive", Q(449, 570), { parent: "edge" }),
    line("oem2", "OEM and Other", Q(97, 126), { parent: "edge" }),
    line("auto1", "Auto", Q(449, 570), { parent: "rev" }),
    line("oem1", "OEM & Other", Q(97, 126), { parent: "rev" }),
    line("rev", "Revenue", Q(35082, 39331), { total: true }),
  ];
  const g: PayloadGroup = { id: "rev", cat: "product", met: "revenue", unit: "usd", label: "Revenue", root: "rev", rows: [
    { k: "dc", depth: 1 }, { k: "gam", depth: 2 }, { k: "pv", depth: 2 }, { k: "auto2", depth: 2 }, { k: "oem2", depth: 2 }, { k: "edge", depth: 1 }, { k: "auto1", depth: 1 }, { k: "oem1", depth: 1 }, { k: "rev", depth: 0 },
  ] };
  const checks: PayloadCheck[] = [
    { k: "rev", e: "2024-10-27", kind: "q", total: 35082e6, sum: 35628e6, ok: false, n: 4 },
    { k: "rev", e: "2025-01-26", kind: "q", total: 39331e6, sum: 40027e6, ok: false, n: 4 },
  ];
  const p = tidyPayload(payload(series, [g], checks));
  it("keeps one Automotive and one OEM line, nested under Edge Computing", () => {
    const labels = p.series.map((s) => s.label);
    expect(labels.filter((l) => /^auto/i.test(l))).toEqual(["Automotive"]);
    expect(labels.filter((l) => /^oem/i.test(l))).toHaveLength(1);
    expect(p.alias?.auto1).toBe("auto2");
    expect(cellsOf(p, "auto1")).toEqual({ "2024-10-27": 449e6, "2025-01-26": 570e6 });
  });
  it("re-checks the total, which now adds up", () => {
    expect(p.checks.filter((c) => c.k === "rev").every((c) => c.ok)).toBe(true);
  });
  it("never folds lines whose names differ or whose numbers conflict", () => {
    const other = tidyPayload(payload([...series.slice(0, 6), line("auto1", "Auto", Q(300, 570), { parent: "rev" }), series[8]], [{ ...g, rows: g.rows.filter((r) => r.k !== "oem1") }], checks));
    expect(other.series.some((s) => s.k === "auto1")).toBe(true);
  });
});

describe("the same figures shown twice under two tables", () => {
  // PNC 8-K of 15 Jul 2026, $ millions: Jun '25, Mar '26, Jun '26.
  const Q = (a: number, b: number, c: number) => ({ "2025-06-30": a * 1e6, "2026-03-31": b * 1e6, "2026-06-30": c * 1e6 });
  it("folds a loose income-statement line into the breakdown total it repeats", () => {
    const series = [
      line("pers", "Personnel", Q(1889, 2106, 2273), { cat: "cost", met: "expense", parent: "tne" }),
      line("occ", "Occupancy", Q(235, 262, 252), { cat: "cost", met: "expense", parent: "tne" }),
      line("tne", "Total noninterest expense", Q(3383, 3768, 4098), { cat: "cost", met: "expense", total: true }),
      line("ne", "Noninterest expense", Q(3383, 3768, 4098), { cat: "cost", met: "expense" }),
    ];
    const g = table("tne", "tne", ["pers", "occ"], { cat: "cost", met: "expense" });
    const loose: PayloadGroup = { id: "cost|expense|usd", cat: "cost", met: "expense", unit: "usd", label: "", root: null, rows: [{ k: "ne", depth: 0 }] };
    const p = tidyPayload(payload(series, [g, loose]));
    expect(p.alias?.ne).toBe("tne");
    expect(p.groups.some((x) => x.rows.some((r) => r.k === "ne"))).toBe(false);
  });
  it("drops a table printed again inside a bigger one", () => {
    const fee = [
      line("f:amb", "Asset management and brokerage", Q(391, 420, 440), { cat: "product", parent: "f:t" }),
      line("f:cmd", "Capital markets and advisory", Q(321, 463, 577), { cat: "product", parent: "f:t" }),
      line("f:t", "Fee income (non-GAAP)", Q(1894, 2079, 2279), { cat: "product", total: true }),
    ];
    const nii = [
      line("n:amb", "Asset management and brokerage", Q(391, 420, 440), { parent: "n:fee" }),
      line("n:cmd", "Capital markets and advisory", Q(321, 463, 577), { parent: "n:fee" }),
      line("n:fee", "Fee income (non-GAAP)", Q(1894, 2079, 2279), { parent: "n:t", total: true }),
      line("n:oth", "Other", Q(212, 125, 489), { parent: "n:t" }),
      line("n:t", "Total noninterest income", Q(2106, 2204, 2768), { total: true }),
    ];
    const groups = [table("f:t", "f:t", ["f:amb", "f:cmd"], { cat: "product" }), table("n:t", "n:t", ["n:amb", "n:cmd", "n:fee", "n:oth"])];
    const p = tidyPayload(payload([...fee, ...nii], groups));
    expect(p.groups.map((x) => x.id)).toEqual(["n:t"]);
    expect(p.alias?.["f:amb"]).toBe("n:amb");
  });
});

describe("a line whose only part prints the same numbers", () => {
  // PNC business segment income, $ millions: "Retail Banking" and the "Earnings" closing the Retail Banking table.
  const Q = (a: number, b: number, c: number) => ({ "2025-06-30": a * 1e6, "2026-03-31": b * 1e6, "2026-06-30": c * 1e6 });
  it("shows the figure once, under the segment's name", () => {
    const series = [
      line("rb:e", "Earnings", Q(1386, 1349, 1747), { met: "segment_profit", parent: "rb", total: true }),
      line("rb", "Retail Banking", Q(1386, 1349, 1747), { met: "segment_profit", parent: "t" }),
      line("oth", "Other", Q(-1209, -1190, -1430), { met: "segment_profit", parent: "t" }),
      line("t", "Net income excluding noncontrolling interests", Q(177, 159, 317), { met: "segment_profit", total: true }),
    ];
    const g: PayloadGroup = { id: "t", cat: "segment", met: "segment_profit", unit: "usd", label: "", root: "t", rows: [{ k: "rb:e", depth: 2 }, { k: "rb", depth: 1 }, { k: "oth", depth: 1 }, { k: "t", depth: 0 }] };
    const p = tidyPayload(payload(series, [g]));
    expect(p.series.map((s) => s.label)).not.toContain("Earnings");
    expect(p.alias?.["rb:e"]).toBe("rb");
    expect(cellsOf(p, "rb")).toEqual({ "2025-06-30": 1386e6, "2026-03-31": 1349e6, "2026-06-30": 1747e6 });
  });
});

describe("a printed total is never replaced (review C1)", () => {
  // Total revenue printed as round figures; its only part sits 0.4% below it in three quarters.
  const s = [
    line("t", "Total revenue", { "2025-03-31": 10000e6, "2025-06-30": 10000e6, "2025-09-30": 10200e6, "2025-12-31": 10500e6 }, { total: true }),
    line("p", "Products", { "2025-03-31": 9960e6, "2025-06-30": 10000e6, "2025-09-30": 10160e6, "2025-12-31": 10460e6 }, { parent: "t" }),
  ];
  const p = tidyPayload(payload(s, [table("t", "t", ["p"])]));
  it("keeps the total's own printed values and sources", () => {
    expect(cellsOf(p, "t")).toEqual({ "2025-03-31": 10000e6, "2025-06-30": 10000e6, "2025-09-30": 10200e6, "2025-12-31": 10500e6 });
    expect(p.series.find((x) => x.k === "t")!.q["2025-03-31"]).toEqual({ v: 10000e6, d: 0, e: "2025-03-31" });
  });
  it("keeps a near-equal part as its own line", () => {
    expect(p.alias?.p).toBeUndefined();
    expect(cellsOf(p, "p")?.["2025-03-31"]).toBe(9960e6);
    expect(p.groups[0].rows.map((r) => r.k)).toContain("p");
  });
});

describe("one coincidental match never merges two lines (review C2)", () => {
  // Revenue = Software + Hardware (Devices + Other) + Other; the root's Other prints 12 only in Jun,
  // the same as Hardware's Other.
  const series = [
    line("a", "Software", { "2025-03-31": 500e6, "2025-06-30": 520e6 }, { parent: "rev" }),
    line("hw", "Hardware", { "2025-03-31": 300e6, "2025-06-30": 310e6 }, { parent: "rev", total: true }),
    line("h1", "Devices", { "2025-03-31": 288e6, "2025-06-30": 298e6 }, { parent: "hw" }),
    line("ho", "Other", { "2025-03-31": 12e6, "2025-06-30": 12e6 }, { parent: "hw" }),
    line("ro", "Other", { "2025-06-30": 12e6 }, { parent: "rev" }),
    line("rev", "Revenue", { "2025-03-31": 800e6, "2025-06-30": 842e6 }, { total: true }),
  ];
  const g: PayloadGroup = { id: "rev", cat: "product", met: "revenue", unit: "usd", label: "Revenue", root: "rev", rows: [{ k: "a", depth: 1 }, { k: "h1", depth: 2 }, { k: "ho", depth: 2 }, { k: "hw", depth: 1 }, { k: "ro", depth: 1 }, { k: "rev", depth: 0 }] };
  const checks: PayloadCheck[] = [
    { k: "rev", e: "2025-03-31", kind: "q", total: 800e6, sum: 800e6, ok: true, n: 2 },
    { k: "rev", e: "2025-06-30", kind: "q", total: 842e6, sum: 842e6, ok: true, n: 3 },
  ];
  const p = tidyPayload(payload(series, [g], checks));
  it("keeps the root's Other in the table", () => {
    expect(p.alias?.ro).toBeUndefined();
    expect(p.groups[0].rows.map((r) => r.k)).toContain("ro");
  });
  it("every check marked as adding up adds up from the parts shown", () => {
    for (const x of p.checks.filter((c) => c.ok && c.k === "rev")) {
      const parts = p.series.filter((s) => s.parent === "rev" && s.q[x.e]);
      expect(parts.reduce((n, s) => n + s.q[x.e].v, 0)).toBe(x.total);
    }
  });
  it("never folds a line when the total then stops adding up", () => {
    // Same names and two identical periods, but the root's Other is a real part: removing it breaks the total.
    const s2 = series.map((x) => (x.k === "ro" ? line("ro", "Other", { "2025-03-31": 12e6, "2025-06-30": 12e6 }, { parent: "rev" }) : x.k === "rev" ? line("rev", "Revenue", { "2025-03-31": 812e6, "2025-06-30": 842e6 }, { total: true }) : x));
    const q = tidyPayload(payload(s2, [g]));
    expect(q.alias?.ro).toBeUndefined();
  });
});

describe("names that only look alike (review M2)", () => {
  it("are told apart, while known short forms still match", () => {
    expect(alikeLabels("Net revenue", "Network revenue")).toBe(false);
    expect(alikeLabels("Other (Americas)", "Other (Europe)")).toBe(false);
    expect(alikeLabels("Data", "Database")).toBe(false);
    expect(alikeLabels("Car", "Cargo")).toBe(false);
    expect(alikeLabels("Auto", "Automotive")).toBe(true);
    expect(alikeLabels("Int'l", "International")).toBe(true);
    expect(alikeLabels("OEM & Other", "OEM and Other")).toBe(true);
  });
  it("a loose line never folds into a breakdown line with a look-alike name", () => {
    const Q = { "2025-06-30": 2106e6, "2026-03-31": 2204e6 };
    const series = [
      line("x", "Network revenue", Q, { parent: "t" }),
      line("y", "Other", { "2025-06-30": 1e6, "2026-03-31": 2e6 }, { parent: "t" }),
      line("t", "Total revenue", { "2025-06-30": 2107e6, "2026-03-31": 2206e6 }, { total: true }),
      line("l", "Net revenue", Q),
    ];
    const loose: PayloadGroup = { id: "segment|revenue|usd", cat: "segment", met: "revenue", unit: "usd", label: "", root: null, rows: [{ k: "l", depth: 0 }] };
    expect(tidyPayload(payload(series, [table("t", "t", ["x", "y"]), loose])).alias?.l).toBeUndefined();
  });
});

describe("the same line in two loose lists (review M4)", () => {
  // PNC: "Provision for credit losses" 254 / 210 / 191 printed in two lists.
  const Q = { "2025-06-30": 254e6, "2026-03-31": 210e6, "2026-06-30": 191e6 };
  const a: PayloadGroup = { id: "segment|expense|usd", cat: "segment", met: "expense", unit: "usd", label: "", root: null, rows: [{ k: "p1", depth: 0 }, { k: "o1", depth: 0 }] };
  const b: PayloadGroup = { id: "cost|expense|usd", cat: "cost", met: "expense", unit: "usd", label: "", root: null, rows: [{ k: "p2", depth: 0 }, { k: "o2", depth: 0 }] };
  const series = [
    line("p1", "Provision for credit losses", Q, { cat: "segment", met: "expense" }),
    line("o1", "Occupancy", { "2025-06-30": 235e6 }, { cat: "segment", met: "expense" }),
    line("p2", "Provision for credit losses", Q, { cat: "cost", met: "expense" }),
    line("o2", "Equipment", { "2025-06-30": 400e6 }, { cat: "cost", met: "expense" }),
  ];
  it("shows it once, in the first list", () => {
    const p = tidyPayload(payload(series, [a, b]));
    const where = p.groups.filter((g) => g.rows.some((r) => r.k === "p1"));
    expect(where).toHaveLength(1);
    expect(p.alias?.p2).toBe("p1");
  });
  it("keeps both when one period differs", () => {
    const s2 = series.map((x) => (x.k === "p2" ? line("p2", "Provision for credit losses", { ...Q, "2026-06-30": 192e6 }, { cat: "cost", met: "expense" }) : x));
    const p = tidyPayload(payload(s2, [a, b]));
    expect(p.alias?.p2).toBeUndefined();
  });
});

describe("speed on a bank-sized payload (review H3)", () => {
  it("tidies 14,000+ lines in well under the time a quadratic pass needs", () => {
    const words = ["loans", "deposits", "fees", "income", "expense", "assets", "securities", "card", "mortgage", "commercial", "consumer", "wealth", "trading", "advisory", "custody", "treasury", "leasing", "auto", "student", "home", "equity", "capital", "markets", "retail", "corporate", "investment", "banking", "services", "interest", "noninterest"];
    const name = (i: number) => `${words[i % 30]} ${words[Math.floor(i / 30) % 30]} item${i.toString(36).replace(/[0-9]/g, (d) => "abcdefghij"[+d])}`;
    const ends = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"];
    let n = 0;
    const val = () => Object.fromEntries(ends.map((e, j) => [e, (1000 + ((n * 2654435761 + j * 97) % 900000) / 7) * 1e6]));
    const series: PayloadSeries[] = [];
    const groups: PayloadGroup[] = [];
    for (let g = 0; g < 1200; g++) {
      const rows: string[] = [];
      for (let i = 0; i < 11; i++) {
        n++;
        series.push(line(`g${g}_${i}`, name(n), val(), { parent: `r${g}` }));
        rows.push(`g${g}_${i}`);
      }
      n++;
      series.push(line(`r${g}`, `Total ${name(n)}`, val(), { total: true }));
      groups.push(table(`r${g}`, `r${g}`, rows));
    }
    const loose: PayloadGroup = { id: "segment|revenue|usd", cat: "segment", met: "revenue", unit: "usd", label: "", root: null, rows: [] };
    for (let i = 0; i < 1000; i++) {
      n++;
      series.push(line(`l${i}`, name(n), val()));
      loose.rows.push({ k: `l${i}`, depth: 0 });
    }
    groups.push(loose);
    expect(series.length).toBeGreaterThanOrEqual(14_000);
    const t = performance.now();
    tidyPayload(payload(series, groups));
    // Measured at ~1 s on a loaded 2-core box; the quadratic passes took 38–67 s on this shape.
    expect(performance.now() - t).toBeLessThan(10_000);
  });
});

describe("checks are read off the page (review C2)", () => {
  it("drops a check of a total none of whose parts is shown under it", () => {
    const Q = { "2026-01-25": 62314e6 };
    const series = [
      line("dc", "Data Center", Q, { met: "revenue", cat: "product" }),
      line("hy", "Hyperscale", { "2026-01-25": 33814e6 }, { parent: "dc" }),
      line("t", "Total revenue", { "2026-01-25": 68127e6 }, { total: true }),
      line("gm", "Gaming", { "2026-01-25": 5813e6 }, { parent: "t" }),
    ];
    const groups = [table("t", "t", ["dc", "gm"]), { id: "loose", cat: "segment", met: "revenue", unit: "usd", label: "", root: null, rows: [{ k: "hy", depth: 0 }] } as PayloadGroup];
    const checks: PayloadCheck[] = [{ k: "dc", e: "2026-01-25", kind: "q", total: 62314e6, sum: 124628e6, ok: false, n: 4 }];
    expect(tidyPayload(payload(series, groups, checks)).checks.filter((c) => c.k === "dc")).toEqual([]);
  });
});
