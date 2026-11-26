import { describe, expect, it } from "vitest";
import { AAPL } from "./fixtures/aapl";
import { CFG } from "./fixtures/cfg";
import { fixturePayload, parseRows } from "./fixtures/build";
import { JPM } from "./fixtures/jpm";
import { fmtChange, fmtValue } from "./format";
import { bankFiguresOf, marginFiguresOf, partsOf, segmentMixOf, seriesOf } from "./from-payload";
import {
  bridgeCloses,
  bridgeOf,
  changeBetween,
  defaultBridge,
  halfUnit,
  oneAxis,
  printedNumber,
  spreadLabels,
  stackColumns,
  stackable,
  statOf,
  tieAt,
  valueDomain,
  waterfallBars,
} from "./model";
import type { VizPoint, VizSeries } from "./types";

const pt = (period: string, value: number, printed?: string): VizPoint => ({
  period,
  periodLabel: period,
  short: period.slice(0, 7),
  value,
  ...(printed ? { printed } : {}),
});
const ser = (key: string, pts: VizPoint[], unit: VizSeries["unit"] = "usd"): VizSeries => ({
  key,
  label: key,
  unit,
  cadence: "q",
  points: pts,
});

describe("fixtures are the stored cells", () => {
  for (const fx of [JPM, CFG, AAPL])
    it(`${fx.ticker}: every value equals its printed text times the table's unit`, () => {
      let n = 0;
      for (const l of fx.lines)
        for (const r of parseRows(l, fx.valuesIn)) {
          const printed = printedNumber(r.printed);
          expect(printed, `${l.label} ${r.end}`).not.toBeNull();
          expect(r.value).toBeCloseTo(printed! * fx.mult[l.unit], 0);
          expect(r.doc).toBeLessThan(fx.docs.length);
          n++;
        }
      expect(n).toBeGreaterThan(50);
    });
});

describe("changes", () => {
  it("percent for amounts, points for percentages, none across a sign change", () => {
    expect(changeBetween(pt("2026-09-30", 110), pt("2025-09-30", 100), "usd")!.value).toBeCloseTo(
      10,
    );
    expect(changeBetween(pt("2026-09-30", 2.48), pt("2025-09-30", 2.45), "pct")).toMatchObject({
      kind: "pts",
    });
    expect(changeBetween(pt("2026-09-30", 5), pt("2025-09-30", -5), "usd")).toBeNull();
    expect(changeBetween(pt("2026-09-30", 5), null, "usd")).toBeNull();
    expect(fmtChange({ kind: "pct", value: -3.21, base: pt("2025-09-30", 1) })).toBe("−3.2%");
    expect(fmtChange({ kind: "pts", value: 0.03, base: pt("2025-09-30", 1) })).toBe("+0.03 pts");
  });
  it("JPM net interest income: latest, YoY on the same quarter a year before, 12-quarter trend", () => {
    const p = fixturePayload(JPM);
    const s = seriesOf(
      p,
      "JPM",
      p.series.find((x) => x.k === "nii")!,
    );
    const st = statOf(s)!;
    expect(st.latest.value).toBe(27_036e6);
    expect(st.latest.printed).toBe("27,036");
    expect(st.yoy!.base.period).toBe("2025-09-30");
    expect(st.yoy!.value).toBeCloseTo(((27036 - 23966) / 23966) * 100, 6);
    expect(st.qoq!.base.period).toBe("2026-06-30");
    expect(st.spark).toHaveLength(12);
    expect(st.spark.every(Boolean)).toBe(true);
  });
  it("Apple's 52/53-week quarters still find the year-ago quarter", () => {
    const p = fixturePayload(AAPL);
    const st = statOf(
      seriesOf(
        p,
        "AAPL",
        p.series.find((x) => x.k === "tns")!,
      ),
    )!;
    expect(st.yoy!.base.period).toBe("2025-09-27");
    expect(fmtValue(st.latest.value, "usd", "M")).toBe("$114,477M");
  });
  it("gaps stay gaps in a sparkline", () => {
    const s = ser("a", [pt("2025-03-31", 1), pt("2025-09-30", 2), pt("2025-12-31", 3)]);
    const st = statOf(s)!;
    expect(st.spark.map((x) => x?.value ?? null)).toEqual([1, null, 2, 3]);
  });
});

describe("ties", () => {
  it("rounding of the printed figures decides a tie", () => {
    expect(halfUnit(pt("x", 23_136e6, "23,136"))).toBe(5e5);
    expect(halfUnit(pt("x", 2.48, "2.48"))).toBeCloseTo(0.005);
    const total = ser("t", [pt("2026-09-30", 100e6, "100")]);
    const parts = [
      ser("a", [pt("2026-09-30", 60e6, "60")]),
      ser("b", [pt("2026-09-30", 43e6, "43")]),
    ];
    expect(tieAt(total, parts, [], "2026-09-30")!.ok).toBe(false);
    expect(tieAt(total, parts, ["b"], "2026-09-30")!.ok).toBe(false);
    const close = [
      ser("a", [pt("2026-09-30", 60e6, "60")]),
      ser("b", [pt("2026-09-30", 40e6, "40")]),
    ];
    expect(tieAt(total, close, [], "2026-09-30")!.ok).toBe(true);
    expect(tieAt(total, [...close, ser("c", [])], [], "2026-09-30")).toBeNull();
  });
  it("JPM noninterest revenue ties in all 13 quarters but has a negative line, so it is not stacked", () => {
    const p = fixturePayload(JPM);
    const parts = partsOf(
      p,
      "JPM",
      p.groups.find((g) => g.id === "g_nir")!,
    )!;
    expect(parts.parts).toHaveLength(9);
    expect(parts.ties).toHaveLength(13);
    expect(stackable(parts)).toBe(false);
    expect(stackColumns(parts, "stacked")).toEqual([]);
  });
  it("JPM segments stack, and shares add to 100", () => {
    const p = fixturePayload(JPM);
    const parts = partsOf(
      p,
      "JPM",
      p.groups.find((g) => g.id === "g_seg")!,
    )!;
    expect(parts.ties).toHaveLength(13);
    const cols = stackColumns(parts, "share");
    expect(cols).toHaveLength(13);
    for (const c of cols) expect(c.segments.at(-1)!.y1).toBeCloseTo(100, 6);
    expect(stackColumns(parts, "stacked").at(-1)!.segments.at(-1)!.y1).toBe(50_907e6);
  });
  it("CFG fees tie only where every line is printed", () => {
    const p = fixturePayload(CFG);
    const parts = partsOf(
      p,
      "CFG",
      p.groups.find((g) => g.id === "g_nonii")!,
    )!;
    expect(parts.ties).toEqual([
      "2025-09-30",
      "2025-12-31",
      "2026-03-31",
      "2026-06-30",
      "2026-09-30",
    ]);
  });
});

describe("bridges", () => {
  it("JPM managed net revenue by line of business, 3Q25 to 3Q26, closes to the change of the total", () => {
    const p = fixturePayload(JPM);
    const parts = partsOf(
      p,
      "JPM",
      p.groups.find((g) => g.id === "g_seg")!,
    )!;
    const { bridge } = defaultBridge(parts);
    expect(bridge!.from.period).toBe("2025-09-30");
    expect(bridge!.to.period).toBe("2026-09-30");
    expect(bridge!.span).toBe("yoy");
    expect(bridgeCloses(bridge!)).toBe(true);
    const bars = waterfallBars(bridge!);
    expect(bars).toHaveLength(6);
    expect(bars[1]).toMatchObject({
      label: "Consumer & Community Banking",
      start: 47_120e6,
      delta: (21_171 - 19_473) * 1e6,
    });
    expect(bars.at(-2)!.end).toBeCloseTo(50_907e6, -3);
  });
  it("no bridge into a period where a line is missing", () => {
    const p = fixturePayload(CFG);
    const parts = partsOf(
      p,
      "CFG",
      p.groups.find((g) => g.id === "g_nonii")!,
    )!;
    const r = bridgeOf(parts, "2024-09-30", "2025-09-30");
    expect(r.bridge).toBeNull();
    expect(r.reason).toMatch(/Not every line/);
    expect(defaultBridge(parts).bridge!.span).toBe("yoy");
  });
});

describe("bank and margin figures", () => {
  it("JPM: the company's own lines, named as printed", () => {
    const p = fixturePayload(JPM);
    const b = bankFiguresOf(p, "JPM")!;
    expect(b.nii!.label).toBe("Net interest income");
    expect(b.nim!.label).toBe("NET YIELD ON INTEREST-EARNING ASSETS");
    expect(b.efficiency!.label).toBe("Overhead ratio");
    expect(b.credit.map((s) => s.label)).toEqual([
      "PROVISION FOR CREDIT LOSSES",
      "Total net charge-offs/(recoveries)",
      "Total allowance for loan losses",
    ]);
    expect(b.capital[0].label).toMatch(/CET1/);
    expect(b.capital).toHaveLength(5);
    expect(b.balances.map((s) => s.label)).toEqual(["Total deposits", "Total loans"]);
    expect(b.noninterest!.ties).toHaveLength(13);
    expect(marginFiguresOf(p, "JPM")).toBeNull();
  });
  it("CFG: GAAP margin and the printed efficiency ratio", () => {
    const b = bankFiguresOf(fixturePayload(CFG), "CFG")!;
    expect(b.nim!.label).toBe("Net interest margin (GAAP)");
    expect(b.efficiency!.points.at(-1)!.printed).toBe("63.03");
    expect(b.capital[0].label).toBe("CET1 capital ratio");
  });
  it("AAPL: no bank panel; operating expenses tie; no printed margin percentage", () => {
    const p = fixturePayload(AAPL);
    expect(bankFiguresOf(p, "AAPL")).toBeNull();
    const m = marginFiguresOf(p, "AAPL")!;
    expect(m.margins).toEqual([]);
    expect(m.expenses!.ties).toHaveLength(13);
    expect(segmentMixOf(p, "AAPL")!.label).toBe("Net sales by reportable segment");
  });
  it("every point opens the stored document at its printed cell", () => {
    const p = fixturePayload(CFG);
    const s = seriesOf(
      p,
      "CFG",
      p.series.find((x) => x.k === "eff")!,
    );
    const src = s.points.at(-1)!.source!.src!;
    expect(src).toMatchObject({
      accn: "0000759944-25-000139",
      irDoc: "286cab43-ee62-48e6-ab9e-de70355b5156",
      cell: { t: 20, r: 14, c: 2 },
    });
  });
});

describe("layout helpers", () => {
  it("one axis: lines in another unit are left out and counted", () => {
    const r = oneAxis([
      ser("a", [pt("x", 1)]),
      ser("b", [pt("x", 1)], "pct"),
      ser("c", [pt("x", 1)]),
    ]);
    expect(r.shown.map((s) => s.key)).toEqual(["a", "c"]);
    expect(r.leftOut).toBe(1);
  });
  it("end labels keep their gap and stay inside", () => {
    const m = spreadLabels(
      [
        { key: "a", y: 10 },
        { key: "b", y: 12 },
        { key: "c", y: 100 },
      ],
      12,
      0,
      120,
    );
    expect(m.get("b")! - m.get("a")!).toBeGreaterThanOrEqual(11.99);
    expect(m.get("a")!).toBeGreaterThanOrEqual(0);
    expect(m.get("c")).toBe(100);
  });
});

describe("value domain", () => {
  it("columns include zero; padded lines of positive figures stay at or above zero", () => {
    expect(valueDomain([5, 10], true)).toEqual([0, 10]);
    const [lo, hi] = valueDomain([1, 100], false);
    expect(lo).toBe(0);
    expect(hi).toBeGreaterThan(100);
    expect(valueDomain([2.4, 2.8], false)[0]).toBeGreaterThan(2);
  });
});
