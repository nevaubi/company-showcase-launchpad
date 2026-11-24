import { describe, expect, it } from "vitest";
import { columnScale, fmtChange, fmtInScale, modalEnd, modalPeriod, periodMark, shortPeriod, type MatrixPoint } from "./matrix";

describe("KPI matrix presentation", () => {
  it("states each column's unit once and scales amounts by the column median", () => {
    const usd = columnScale({ uclass: "usd", unit: "USD" }, [2.1e9, 8.4e9, 450e6, 12e9]);
    expect(usd.head).toBe("$B");
    expect(fmtInScale(8.4e9, usd)).toBe("8.4");
    expect(fmtInScale(450e6, usd)).toBe("0.45");
    expect(fmtInScale(-1.25e9, usd)).toBe("−1.3");
    const pct = columnScale({ uclass: "pct", unit: "%" }, [3.2, 12.5]);
    expect(pct.head).toBe("%");
    expect(fmtInScale(12.5, pct)).toBe("12.5");
    const cnt = columnScale({ uclass: "count", unit: "count" }, [2.4e6, 900e3, 3.1e6]);
    expect(cnt.head).toBe("M");
    expect(fmtInScale(900e3, cnt)).toBe("0.90");
    expect(columnScale({ uclass: "usd_ps", unit: "USD_per_share" }, [4.1]).head).toBe("$ per share");
    expect(fmtInScale(null, pct)).toBe("–");
  });
  it("writes changes as points for rates and percent for amounts", () => {
    expect(fmtChange(1.25, { uclass: "pct", unit: "%" })).toBe("+1.3 pt");
    expect(fmtChange(-0.042, { uclass: "usd", unit: "USD" })).toBe("−4.2%");
    expect(fmtChange(null, { uclass: "usd", unit: "USD" })).toBe("–");
  });
  it("finds the period most companies report so only exceptions carry a label", () => {
    const p = (end: string, label: string): MatrixPoint => [end, 1, label, null];
    expect(modalPeriod([p("2026-09-30", "Q3 2026"), p("2026-09-30", "Q3 2026"), p("2026-06-30", "Q2 2026"), null])).toBe("Q3 2026");
    expect(modalPeriod([p("2026-06-30", "Q2 2026"), p("2026-09-30", "Q3 2026")])).toBe("Q3 2026");
    expect(modalPeriod([])).toBeNull();
    expect(shortPeriod("Q2 2026")).toBe("Q2 26");
    expect(shortPeriod("FY2025")).toBe("FY25");
  });
  it("keeps two significant digits for small amounts in a scaled column and never prints a signed zero", () => {
    const B = columnScale({ uclass: "usd", unit: "USD" }, [2e9, 3e9, 5e9]);
    expect(B.head).toBe("$B");
    expect(fmtInScale(45e6, B)).toBe("0.045");
    expect(fmtInScale(149e6, B)).toBe("0.15");
    expect(fmtInScale(-20e6, B)).toBe("−0.020");
    expect(fmtInScale(3e6, B)).toBe("0.0030");
    expect(fmtInScale(2.5e9, B)).toBe("2.5");
    expect(fmtInScale(0, B)).toBe("0.0");
    const M = columnScale({ uclass: "usd", unit: "USD" }, [2e6, 3e6, 5e6]);
    expect(fmtInScale(45e3, M)).toBe("0.045");
    const pct = columnScale({ uclass: "pct", unit: "%" }, [10, 12]);
    expect(fmtInScale(-0.04, pct)).toBe("0.0");
  });

  it("marks a cell by period end as well as label, and always marks old values", () => {
    const now = Date.parse("2026-11-20");
    const pts: MatrixPoint[] = [
      ["2026-09-30", 1, "Q3 2026", null],
      ["2026-09-30", 2, "Q3 2026", null],
      ["2026-09-28", 3, "Q3 2026", null],
      ["2026-03-31", 4, "Q3 2026", null],
      ["2026-06-30", 5, "Q2 2026", null],
    ];
    const col = { period: modalPeriod(pts), end: modalEnd(pts) };
    expect(col).toEqual({ period: "Q3 2026", end: "2026-09-30" });
    expect(periodMark(pts[0], col, now)).toBeNull();
    expect(periodMark(pts[2], col, now)).toBeNull(); // two days off: same quarter
    expect(periodMark(pts[3], col, now)).toEqual({ text: "Mar 26", stale: true });
    expect(periodMark(pts[4], col, now)).toEqual({ text: "Q2 26", stale: false });
    const old: MatrixPoint = ["2026-03-31", 1, "Q1 2026", null];
    expect(periodMark(old, { period: "Q1 2026", end: "2026-03-31" }, now)).toEqual({ text: "Q1 26", stale: true });
  });
});
