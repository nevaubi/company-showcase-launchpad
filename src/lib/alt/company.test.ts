import { describe, expect, it } from "vitest";
import { buildCompanyAlt, snapshotFigures, type CompanyAltRow } from "./company";

const TODAY = "2026-11-23";
let n = 0;
const row = (p: Partial<CompanyAltRow>): CompanyAltRow => ({ uid: `u${n++}`, ticker: "LMT", dataset: "events", kind: "event", date: null, title: "", value: null, unit: null, meta: {}, source: "s", source_url: `https://example.org/${n}`, ...p });

// Real LMT figures (alt_data, 23 Nov 2026): FY2025 obligations $69,313,261,998.29, FY2024 $34,774,315,531.77;
// revenue from the FY2025 10-K (accn 0001628280-26-004195) $75,048,000,000.
const contracts = [
  row({ dataset: "contracts", kind: "series", title: "Federal contract obligations", date: "2024-09-30", value: 34774315531.77, unit: "USD", meta: { fiscal_year: 2024, ytd: false } }),
  row({ dataset: "contracts", kind: "series", title: "Federal contract obligations", date: "2025-09-30", value: 69313261998.29, unit: "USD", meta: { fiscal_year: 2025, ytd: false } }),
  row({ dataset: "contracts", kind: "series", title: "Federal contract obligations", date: "2026-09-30", value: 55798650433.48, unit: "USD", meta: { fiscal_year: 2026, ytd: false } }),
];
const revenue = [{ value: 71043000000, end: "2024-12-31" }, { value: 75048000000, end: "2025-12-31", accn: "0001628280-26-004195" }];

describe("buildCompanyAlt", () => {
  it("compares settled fiscal years, keeps the unsettled one apart and sizes obligations against revenue", () => {
    const alt = buildCompanyAlt(contracts, TODAY, revenue);
    const v = alt.views.find((x) => x.dataset === "contracts")!;
    expect(v.figures[0].label).toBe("Federal obligations, FY2025");
    expect(v.figures[0].value).toBe("$69.3B");
    // 69.31 / 34.77 − 1 = +99.3%; FY2026 ended 2026-09-30 and is within the 120-day lag
    expect(v.figures[0].sub).toBe("+99% vs FY2024 · FY2026 prelim.: $55.8B");
    // 69.31 / 75.05 = 92%
    expect(v.figures[1].value).toBe("92%");
    expect(v.figures[1].revenue!.accn).toBe("0001628280-26-004195");
    expect(v.chart!.points.map((p) => p.partial)).toEqual([false, false, true]);
  });

  it("omits a regulatory series of zeros and a company without rows", () => {
    const zeros = [2024, 2025].map((y) => row({ dataset: "regulatory", kind: "series", title: "Federal Register documents naming the company", date: `${y}-12-31`, value: 0, unit: "docs" }));
    expect(buildCompanyAlt(zeros, TODAY).views).toEqual([]);
    expect(buildCompanyAlt([], TODAY).themes).toEqual([]);
  });

  it("adds Part D and Part B into one yearly Medicare figure", () => {
    const m = (title: string, date: string, value: number, meta: Record<string, unknown>) => row({ dataset: "medicare", kind: "series", title, date, value, unit: "USD", meta });
    // UTHR 2025: Part D $1,310,918,477 + Part B $111,148,523 = $1,422,067,000; 2024: $981,712,148 + $304,622,615 = $1,286,334,763
    const alt = buildCompanyAlt([
      m("Medicare Part D spending", "2024-12-31", 981712148, { year: 2024, ytd: false }),
      m("Medicare Part B spending", "2024-12-31", 304622615, { year: 2024, ytd: false }),
      m("Medicare Part D spending", "2025-12-31", 1310918477, { year: 2025, ytd: false }),
      m("Medicare Part B spending", "2025-12-31", 111148523, { year: 2025, ytd: false }),
      m("Medicare Part D spending", "2026-03-31", 342071433, { year: 2026, ytd: true, quarters: 1 }),
    ], TODAY, [{ value: 3182700000, end: "2025-12-31" }]);
    const f = alt.views[0].figures;
    expect(f[0].value).toBe("$1.4B");
    // 1,422,067,000 / 1,286,334,763 − 1 = 10.55%, shown without a decimal above 10%
    expect(f[0].sub).toBe("+11% vs 2024 · 2026 Q1: $342.1M");
    // 1,422,067,000 / 3,182,700,000 = 44.7%
    expect(f[1].value).toBe("45%");
  });

  it("flags an 8-K burst against a steady history and lists red-flag items as notable", () => {
    const ev: CompanyAltRow[] = [];
    // one item every 45 days for two years, then eight in the last month
    for (let d = 100; d < 800; d += 45) ev.push(row({ date: new Date(Date.parse(`${TODAY}T00:00:00Z`) - d * 864e5).toISOString().slice(0, 10), title: "Director or officer change", meta: { item: "5.02" } }));
    for (let i = 0; i < 8; i++) ev.push(row({ date: `2026-11-${String(10 + i).padStart(2, "0")}`, title: i ? "Director or officer change" : "Prior financials no longer reliable", meta: { item: i ? "5.02" : "4.02" } }));
    const alt = buildCompanyAlt(ev, TODAY);
    expect(alt.flags).toHaveLength(1);
    expect(alt.flags[0].direction).toBe("up");
    expect(alt.flags[0].text).toMatch(/^8 8-K items in the last 90 days/);
    expect(alt.notable.map((r) => r.meta.item)).toEqual(["4.02"]);
    expect(snapshotFigures(alt)[0].flag).toBeDefined();
  });

  it("does not flag 8-K items that only began to be collected", () => {
    const ev = Array.from({ length: 6 }, (_, i) => row({ date: `2026-11-0${i + 1}`, meta: { item: "5.02" } }));
    expect(buildCompanyAlt(ev, TODAY).flags).toEqual([]);
  });
});
