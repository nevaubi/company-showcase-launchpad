import { describe, expect, it } from "vitest";
import { columnScale, fmtChange, fmtInScale, modalPeriod, shortPeriod, type MatrixPoint } from "./matrix";

describe("KPI matrix presentation", () => {
  it("states each column's unit once and scales amounts by the column median", () => {
    const usd = columnScale({ uclass: "usd", unit: "USD" }, [2.1e9, 8.4e9, 450e6, 12e9]);
    expect(usd.head).toBe("$B");
    expect(fmtInScale(8.4e9, usd)).toBe("8.4");
    expect(fmtInScale(450e6, usd)).toBe("0.5");
    expect(fmtInScale(-1.25e9, usd)).toBe("−1.3");
    const pct = columnScale({ uclass: "pct", unit: "%" }, [3.2, 12.5]);
    expect(pct.head).toBe("%");
    expect(fmtInScale(12.5, pct)).toBe("12.5");
    const cnt = columnScale({ uclass: "count", unit: "count" }, [2.4e6, 900e3, 3.1e6]);
    expect(cnt.head).toBe("M");
    expect(fmtInScale(900e3, cnt)).toBe("0.9");
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
});
