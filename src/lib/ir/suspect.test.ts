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
  it("is idempotent: holding twice holds nothing more", () => {
    const once = holdSuspects(payload([series("usd", [4.1e9, 4.3e9, 4.4e6, 4.6e9, 4.8e9])]));
    expect(once.stats.held).toBe(1);
    const twice = holdSuspects(once);
    expect(twice.stats.held).toBe(1);
    expect(Object.keys(twice.series[0].held!.q!)).toEqual(["2020-09-30"]);
  });
});
