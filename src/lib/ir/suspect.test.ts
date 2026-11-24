import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMap } from "./map";
import { keyLines } from "./highlights";
import type { IrFact } from "./kpis";
import { buildPayload, type IrPayload, type PayloadSeries } from "./payload";
import { heldFor, periodGrids } from "./periods";
import { findSuspects, holdSuspects } from "./suspect";
import { XYZ_FACTS } from "@/test/ir-xyz";

// PNC 8-K of 15 Jul 2026 (q22026financialhighlightsa.htm): revenue lines of the Consolidated Financial
// Highlights and of the income statement, from U2's checksum-verified fixture (labels folded).
const PNC: IrFact[] = readFileSync(path.resolve(__dirname, "../../test/fixtures/ir/pnc-revenue.folded.txt"), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    const [id, category, metric, breakdown, parent, label, unit, total, start, end, months, value, method, loc, text] = l.split("|");
    const [t, r, c] = loc.split(",").map(Number);
    return { id, document_id: "dd4bf281-f736-458f-8ec0-c6b996d9ffa8", document_kind: "other", category, metric, breakdown: breakdown || null, parent: parent || null, label, unit, is_total: total === "true", period_start: start || null, period_end: end, months: Number(months), value: Number(value), accn: "0001628280-26-048244", doc: null, filed: "2026-07-15", method, locator: { t, r, c, text } };
  });

const heldKeys = (p: IrPayload) => p.series.flatMap((s) => (["q", "y"] as const).flatMap((k) => Object.keys(s.held?.[k] ?? {}).map((e) => `${s.label}|${k}|${e}`))).sort();
const find = (p: IrPayload, label: string, scope: string) => p.series.find((s) => s.label === label && s.k.endsWith(`@${scope}`))!;

describe("held figures on real stored data", () => {
  const xyz = buildPayload("XYZ", XYZ_FACTS);

  it("XYZ: quarters a later release printed in thousands are held; the dollar quarters stay", () => {
    const total = find(xyz, "Total net revenue", "revenue type");
    expect(Object.keys(total.held!.q!).sort()).toEqual(["2019-03-31", "2019-12-31", "2020-03-31"]);
    expect(Object.keys(total.held!.y!)).toEqual(["2019-12-31"]);
    expect(total.held!.q!["2019-03-31"]).toMatchObject({ v: 959_359, w: "suspect" });
    expect(total.held!.q!["2019-03-31"].why).toMatch(/About 1,000× smaller than this line's other periods/);
    // Q2 2020 (1.92 billion) sits with the line's other dollar quarters: shown (the old neighbour test held it).
    expect(total.q["2020-06-30"].v).toBe(1_923_625_000);
    for (const label of ["Transaction-based revenue", "Subscription and services-based revenue", "Hardware revenue", "Bitcoin revenue"]) {
      const s = xyz.series.find((x) => x.label === label && x.parent === total.k)!;
      expect(Object.keys(s.held?.q ?? {}).length, label).toBeGreaterThanOrEqual(3);
      expect(Object.values(s.q).every((c) => Math.abs(c.v) >= 1e7), label).toBe(true);
    }
    expect(xyz.stats.held).toBe(heldKeys(xyz).length);
  });

  it("held cells keep their source and never reach checks, key metrics or the map", () => {
    const total = find(xyz, "Total net revenue", "revenue type");
    const c = heldFor(total, "q")["2019-03-31"];
    expect(c.d).toBeDefined();
    expect(c.l).toEqual([41, 9, 7]);
    expect(xyz.checks.some((x) => x.k === total.k && x.e === "2019-03-31")).toBe(false);
    const map = buildMap(xyz, 13);
    const line = map.zones.flatMap((z) => z.tiles.flatMap((t) => t.lines)).find((l) => l.key === total.k)!;
    const qs = map.quarters;
    expect(line.values[qs.indexOf("2019-03-31")]).toBeNull();
    for (const k of keyLines(xyz, periodGrids(xyz).q)) expect(k.trend.every((v) => v == null || Math.abs(v) >= 1e7)).toBe(true);
  });

  it("PNC: highlights figures read under Q2 but printed for Q1 by the same release are held", () => {
    const p = buildPayload("PNC", PNC);
    const total = p.series.find((s) => s.label === "Total revenue")!;
    expect(total.held?.q?.["2026-06-30"]?.v).toBe(6_165_000_000);
    expect(total.held!.q!["2026-06-30"].why).toMatch(/prints this figure for the period ending 2026-03-31 and 6,875,000,000 for this one/);
    const nonInterest = p.series.find((s) => s.label === "Noninterest income" && s.parent === total.k)!;
    expect(nonInterest.held?.q?.["2026-06-30"]?.v).toBe(2_204_000_000);
    // Net interest income agrees in both tables: shown. The income statement's own lines: shown.
    const nii = p.series.find((s) => s.label === "Net interest income" && s.parent === total.k)!;
    expect(nii.q["2026-06-30"].v).toBe(4_107_000_000);
    expect(p.series.find((s) => s.label === "Revenue")!.q["2026-06-30"].v).toBe(6_875_000_000);
    expect(heldKeys(p)).toEqual(["Noninterest income|q|2026-06-30", "Total revenue|q|2026-06-30"]);
  });
});

describe("rules that must not hold real figures", () => {
  const series = (unit: string, vals: number[], extra: Partial<PayloadSeries> = {}): PayloadSeries => ({
    k: `kpi|other|x|${unit}|`,
    cat: "kpi",
    met: "other",
    label: "Line",
    parent: null,
    total: false,
    unit,
    q: Object.fromEntries(vals.map((v, i) => [`20${20 + Math.floor(i / 4)}-${["03-31", "06-30", "09-30", "12-31"][i % 4]}`, { v, d: 0, m: 3 }])),
    y: {},
    ...extra,
  });
  const payload = (s: PayloadSeries[]): IrPayload => ({ v: 2, ticker: "T", builtAt: "", quarters: [], years: [], docs: [], series: s, groups: [], checks: [], stats: { series: s.length, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } } });
  it("fast growth, a 10× jump and a line winding down stay", () => {
    expect(findSuspects(payload([series("usd", [1e6, 2e6, 4e6, 8e6, 16e6, 32e6, 64e6, 128e6])])).size).toBe(0);
    expect(findSuspects(payload([series("usd", [1e9, 1.1e9, 11e9, 1.2e9, 1.3e9])])).size).toBe(0);
    expect(findSuspects(payload([series("usd", [300e6, 280e6, 250e6, 210e6, 4e6, 2e6])])).size).toBe(0);
  });
  it("percentages, ratios and per-share lines are never judged by size", () => {
    expect(findSuspects(payload([series("pct", [45, 46, 0.04, 47]), series("usdPerShare", [1.2, 1300, 1.3, 1.4]), series("ratio", [1e15, 1, 1, 1])])).size).toBe(0);
  });
  it("assets under custody may pass $10 trillion; a $3.65 quadrillion revenue may not", () => {
    const auc = series("usd", [5.21e13, 5.3e13, 5.5e13, 5.7e13], { label: "Assets under custody and/or administration", pit: true });
    const nvda = series("usd", [3.5082e10, 3.650035082e15, 3.9331e10, 4.4062e10], { k: "segment|revenue|revenue|usd|", label: "Revenue" });
    const found = findSuspects(payload([auc, nvda]));
    expect(found.has(auc.k)).toBe(false);
    expect([...found.get(nvda.k)!.get("q")!.keys()]).toEqual(["2020-06-30"]);
    expect(found.get(nvda.k)!.get("q")!.get("2020-06-30")).toMatch(/more than \$10 trillion/);
  });
  it("a line printed in thousands in older releases and in dollars in newer ones: the company's usual size decides (GWW)", () => {
    // Real Grainger values (ir_kpi_facts, 20 Nov 2026): "Unallocated expenses" as stored, and the company's other lines.
    const unallocated = series("usd", [11392, 11605, 48009, 14244, 15115, 17358, 69781, 18211, 18332, -130676000, -143571000, -146725000, -146948000], { k: "segment|operating_income|unallocated expenses|usd|" });
    const us = series("usd", [1308737, 1353795000, 1384282000, 1398576000, 1408141000, 1416138000, 1469355000, 1497424000, 1506446000, 1537686000, 1608058000], { k: "segment|revenue|united states|usd|" });
    const canada = series("usd", [5954, 3587000, 4894000, 6314000, 8361000, 9387000, 9499000, 9740000, 10156000, 11675000, 12347000, 12407000], { k: "segment|revenue|canada|usd|" });
    const found = findSuspects(payload([unallocated, us, canada]));
    // The dollar quarters are not held; the thousands quarters are a unit twin of them, not an outlier.
    expect(found.get(unallocated.k)).toBeUndefined();
    expect([...found.get(us.k)!.get("q")!.keys()]).toEqual(["2020-03-31"]);
    expect([...found.get(canada.k)!.get("q")!.keys()]).toEqual(["2020-03-31"]);
  });
  it("a line mixing two measures is left alone; only the stray values above it are held (XOM total worldwide)", () => {
    const xom = series("usd", [259000, 24157000, 25006000, 11145000000, 14718000000, 8533000000, 8578000000, 12816000000, 53810000000000, 57173000000000], { k: "geography|revenue|total worldwide|usd|" });
    const found = findSuspects(payload([xom]));
    expect([...found.get(xom.k)!.get("q")!.keys()].sort()).toEqual(["2022-03-31", "2022-06-30"]);
  });
  it("is idempotent: holding twice holds nothing more", () => {
    const once = holdSuspects(payload([series("usd", [4.1e9, 4.3e9, 4.4e6, 4.6e9, 4.8e9])]));
    expect(once.stats.held).toBe(1);
    const twice = holdSuspects(once);
    expect(twice.stats.held).toBe(1);
    expect(Object.keys(twice.series[0].held!.q!)).toEqual(["2020-09-30"]);
  });
});

describe("a subtotal rebuilt from its parts", () => {
  it("counts a line printed in two tables of one release once (PNC Q1 2026 total revenue)", () => {
    const p = buildPayload("PNC", PNC);
    const total = p.series.find((s) => s.label === "Total revenue")!;
    const q1 = total.q["2026-03-31"];
    // Before: 3,961 + 3,961 = 7,922 (net interest income from the highlights and the income statement).
    expect(q1?.v ?? null).not.toBe(7_922_000_000);
    // Only net interest income is printed for Q1 in this table: no subtotal is rebuilt from one part.
    expect(q1).toBeUndefined();
  });
});

describe("results that cross zero", () => {
  it("keep a small quarter: XOM downstream US printed (1) million", () => {
    const vals = [-1000000, -101000000, -101000000, 310000000, 460000000, 536000000, 597000000, 623000000, 673000000, 895000000];
    const s: PayloadSeries = { k: "segment|segment_profit|downstream united states|usd|", cat: "segment", met: "segment_profit", label: "Downstream — United States", parent: null, total: false, unit: "usd", q: Object.fromEntries(vals.map((v, i) => [`20${20 + Math.floor(i / 4)}-${["03-31", "06-30", "09-30", "12-31"][i % 4]}`, { v, d: 0, m: 3 }])), y: {} };
    const p: IrPayload = { v: 2, ticker: "XOM", builtAt: "", quarters: [], years: [], docs: [], series: [s], groups: [], checks: [], stats: { series: 1, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } } };
    expect(findSuspects(p).size).toBe(0);
  });
});

describe("count lines printed in two units", () => {
  it("hold neither side (UHS diluted shares: thousands in older releases, full counts in newer)", () => {
    const vals = [83692, 85587, 97973, 98275, 79675, 85587, 90967, 94683, 98080, 98453, 70125000, 73832000, 99361000, 100544000, 68108000, 68550000, 69624000];
    const s: PayloadSeries = { k: "kpi|other|weighted average number of common shares|count|", cat: "kpi", met: "other", label: "Weighted average number of common shares", parent: null, total: false, unit: "count", pit: true, q: Object.fromEntries(vals.map((v, i) => [`20${10 + Math.floor(i / 4)}-${["03-31", "06-30", "09-30", "12-31"][i % 4]}`, { v, d: 0, m: 0 }])), y: {} };
    const p: IrPayload = { v: 2, ticker: "UHS", builtAt: "", quarters: [], years: [], docs: [], series: [s], groups: [], checks: [], stats: { series: 1, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } } };
    expect(findSuspects(p).size).toBe(0);
  });
});

describe("a run read in the wrong unit outnumbers the right one", () => {
  // Real stored values (ir_kpi_facts, 20 Nov 2026) with a company context of ordinary lines.
  const ctx = (n: number) => ({ k: `ctx|${n}`, vals: Array.from({ length: 12 }, (_, i) => (1 + i / 10 + n) * 1e8) });
  const mk = (k: string, vals: number[]): PayloadSeries => ({ k, cat: "kpi", met: "other", label: k, parent: null, total: false, unit: "usd", q: Object.fromEntries(vals.map((v, i) => [`20${10 + Math.floor(i / 4)}-${["03-31", "06-30", "09-30", "12-31"][i % 4]}`, { v, d: 0, m: 3 }])), y: {} });
  const pay = (s: PayloadSeries[]): IrPayload => ({ v: 2, ticker: "T", builtAt: "", quarters: [], years: [], docs: [], series: s, groups: [], checks: [], stats: { series: s.length, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } } });
  const others = [ctx(1), ctx(2)].map((c) => mk(c.k, c.vals));
  it("LPLA income before taxes: three quarters in thousands, two in dollars; the thousands are held", () => {
    const lpla = mk("lpla", [368804, 484584, 515504, 330071000, 417253000]);
    const found = findSuspects(pay([lpla, ...others]));
    expect([...found.get("lpla")!.get("q")!.keys()].sort()).toEqual(["2010-03-31", "2010-06-30", "2010-09-30"]);
  });
  it("JAZZ Xyrem: a run read 1,000x too large; the one quarter in the company's usual size is shown", () => {
    const xyrem = mk("xyrem", [133742000, 117526000000, 153664000000, 160378000000, 164181000000, 191366000000, 204337000000]);
    const found = findSuspects(pay([xyrem, ...others]));
    expect(found.get("xyrem")!.get("q")!.has("2010-03-31")).toBe(false);
    expect(found.get("xyrem")!.get("q")!.size).toBe(6);
  });
});

describe("a line printed in another unit beside its same-named twin in one table (iracc-H5)", () => {
  // VSAT "Revenue by segment": the supplement (69085149) prints the table in thousands, the deck (bea91f83) in dollars.
  const VSAT: IrFact[] = readFileSync(path.resolve(__dirname, "fixtures/vsat-segment.folded.txt"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [id, document_id, document_kind, category, metric, breakdown, parent, label, unit, total, start, end, months, value, filed, method] = l.split("|");
      return { id, document_id, document_kind, category, metric, breakdown, parent: parent || null, label, unit, is_total: total === "true", period_start: start || null, period_end: end, months: Number(months), value: Number(value), accn: null, doc: null, filed: filed || null, method, locator: {} };
    });
  const linesFacts = (file: string): IrFact[] => {
    const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    let n = 0;
    return readFileSync(path.resolve(__dirname, `fixtures/${file}`), "utf8")
      .split("\n")
      .filter(Boolean)
      .flatMap((ln) => {
        const f = ln.split("|");
        return ([["q", f[8]], ["y", f[9]]] as const).flatMap(([kind, cells]) =>
          cells.slice(2).split(",").filter(Boolean).flatMap((c) => c.split("=")[1].split("~").map((v) => ({ id: `f${++n}`, document_id: `doc-${n}`, document_kind: "release", category: f[1], metric: f[2], breakdown: f[7] || null, parent: f[6] || null, label: f[5], unit: f[3], is_total: f[4] === "1", period_start: null, period_end: iso(c.split("=")[0]), months: kind === "q" ? 3 : 12, value: Number(v), accn: null, doc: null, filed: null, method: "table", locator: {} }))),
        );
      });
  };
  const p = buildPayload("VSAT", VSAT);
  const byLabel = (label: string) => p.series.filter((s) => s.label === label);

  it("holds the thousands figure whose other printed figure is 1,000× larger, and the same document's other periods", () => {
    // The build merges the two documents' "Total revenues" / "Total Revenue" into one line; the supplement's
    // thousands won the year cells and the deck's dollars sit beside them as the conflicting figure.
    const [total] = byLabel("Total revenues");
    expect(total.held?.y?.["2026-03-31"]).toMatchObject({ v: 1_832_925, w: "suspect" });
    expect(total.held!.y!["2026-03-31"].why).toMatch(/1,832,900,000 for this period, 1,000× this figure: this line was probably read in thousands/);
    // FY2025: the deck prints another figure (no 1,000× match), but the same supplement prints the line in thousands.
    expect(total.held?.y?.["2025-03-31"]).toMatchObject({ v: 2_214_741, w: "suspect" });
    expect(total.held!.y!["2025-03-31"].why).toMatch(/^The same document prints this table in another unit \(period ending 2026-03-31/);
    expect(Object.keys(total.y)).toEqual([]);
    // Held, never multiplied; the cell keeps its source. The deck's quarters (dollars) stay.
    expect(total.held!.y!["2026-03-31"].d).toBe(total.held!.y!["2025-03-31"].d);
    expect(total.q["2026-03-31"].v).toBe(465_200_000);
    expect(total.q["2025-03-31"].v).toBe(454_300_000);
  });

  it("holds the parts that total prints in the same document, and leaves their dollar quarters alone", () => {
    for (const label of ["Aviation", "Government", "Maritime", "Enterprise", "Central Services"]) {
      const [s] = byLabel(label);
      expect(Object.keys(s.y), label).toEqual([]);
      expect(Object.keys(s.held?.y ?? {}).sort(), label).toEqual(["2025-03-31", "2026-03-31"]);
      expect(Object.keys(s.held?.q ?? {}), label).toEqual([]);
      expect(Object.values(s.q).every((c) => c.v > 1e7), label).toBe(true);
    }
  });

  it("a same-named line of the same table 1,000× larger for the period holds it (reviewer's split series)", () => {
    const mk = (k: string, label: string, y: Record<string, number>, d: number): PayloadSeries => ({ k, cat: "segment", met: "revenue", label, parent: null, total: true, unit: "usd", bd: "Revenue by segment", q: {}, y: Object.fromEntries(Object.entries(y).map(([e, v]) => [e, { v, d, m: 12 }])) });
    const a = mk("a", "Total revenues", { "2025-03-31": 2_214_741, "2026-03-31": 1_832_925 }, 1);
    const b = mk("b", "Total Revenue", { "2025-03-31": 1_781_400_000, "2026-03-31": 1_832_900_000 }, 0);
    const other = { ...mk("c", "Total revenues", { "2026-03-31": 1_832_900_000 }, 2), bd: "Revenue by product" };
    // The company's quarters (deck, dollars) give its usual line size: VSAT's segment quarters of FY2026.
    const ctx: PayloadSeries = { k: "ctx", cat: "segment", met: "revenue", label: "Segments", parent: null, total: false, unit: "usd", q: Object.fromEntries([127_600_000, 161_800_000, 116_600_000, 117_900_000, 183_900_000, 115_300_000].map((v, i) => [`2025-0${i + 1}-28`, { v, d: 3, m: 3 }])), y: {} };
    const pay: IrPayload = { v: 2, ticker: "VSAT", builtAt: "", quarters: [], years: [], docs: [], series: [a, b, other, ctx], groups: [], checks: [], stats: { series: 4, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } } };
    const found = findSuspects(pay);
    expect([...found.get("a")!.get("y")!.keys()].sort()).toEqual(["2025-03-31", "2026-03-31"]);
    expect(found.get("a")!.get("y")!.get("2026-03-31")).toMatch(/The same table's line “Total Revenue” prints 1,832,900,000/);
    expect(found.has("b")).toBe(false);
    expect(found.has("c")).toBe(false);
    expect(found.has("ctx")).toBe(false);
  });

  it("holds the parts also when another rule holds their total first (page payload: segment rows with VSAT's standard lines)", () => {
    const std = linesFacts("vsat-lines.txt");
    const page = buildPayload("VSAT", [...std, ...VSAT]);
    const parts = page.series.filter((s) => ["Aviation", "Government", "Maritime", "Enterprise", "Central Services"].includes(s.label) && s.bd === "Revenue by segment");
    expect(parts.length).toBe(5);
    for (const s of parts) {
      expect(Object.values(s.y).filter((c) => Math.abs(c.v) < 1e7), s.label).toEqual([]);
      expect(Object.keys(s.held?.y ?? {}).length, s.label).toBe(2);
    }
  });

  it("holds nothing shown when the 1,000x figure is the slip (HOOD: 1,274,000,000 printed elsewhere as 1,274,100,000,000)", () => {
    // Series as the reviewer's indep2.ts builds them: each printed cell its own document, the other printing as `alt`.
    const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const series: PayloadSeries[] = readFileSync(path.resolve(__dirname, "fixtures/hood-lines.txt"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((ln, i) => {
        const f = ln.split("|");
        const cells = (str: string, m: number) =>
          Object.fromEntries(
            str.slice(2).split(",").filter(Boolean).map((c, j) => {
              const [v, alt] = c.split("=")[1].split("~").map(Number);
              return [iso(c.split("=")[0]), { v, d: i * 100 + j, m, ...(alt != null ? { alt: { v: alt, d: i * 100 + j + 50, kind: "conflict" as const } } : {}) }];
            }),
          );
        return { k: `s${i}`, cat: f[1], met: f[2], unit: f[3], total: f[4] === "1", label: f[5], parent: null, bd: f[7] || undefined, q: cells(f[8], 3), y: cells(f[9], 12) } as PayloadSeries;
      });
    const pay: IrPayload = { v: 2, ticker: "HOOD", builtAt: "", quarters: [], years: [], docs: [], series, groups: [], checks: [], stats: { series: series.length, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } } };
    expect(series.some((s) => s.q["2025-09-30"]?.alt?.v === 1_274_100_000_000)).toBe(true);
    const why = [...findSuspects(pay).values()].flatMap((m) => [...m.values()].flatMap((x) => [...x.values()]));
    expect(why.filter((w) => /1,000× this figure|same document prints this table/.test(w))).toEqual([]);
  });

  it("holds no real segment line: LKQ's segment tables (4% to 46% of revenue)", () => {
    const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
    const series: PayloadSeries[] = readFileSync(path.resolve(__dirname, "fixtures/lkq-lines.txt"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((ln, i) => {
        const f = ln.split("|");
        const cells = (s: string, m: number) => Object.fromEntries(s.slice(2).split(",").filter(Boolean).map((c, j) => [iso(c.split("=")[0]), { v: Number(c.split("=")[1].split("~")[0]), d: i * 100 + j, m }]));
        return { k: `s${i}`, cat: f[1], met: f[2], unit: f[3], total: f[4] === "1", label: f[5], parent: null, bd: f[7] || undefined, q: cells(f[8], 3), y: cells(f[9], 12) } as PayloadSeries;
      });
    const pay: IrPayload = { v: 2, ticker: "LKQ", builtAt: "", quarters: [], years: [], docs: [], series, groups: [], checks: [], stats: { series: series.length, groups: 0, documents: 0, facts: 0, firstPeriod: null, lastPeriod: null, checksQ: { ok: 0, total: 0 }, checksFY: { ok: 0, total: 0 } } };
    const why = [...findSuspects(pay).values()].flatMap((m) => [...m.values()].flatMap((x) => [...x.values()]));
    expect(why.filter((w) => /same table|same document prints this line/.test(w))).toEqual([]);
  });
});
