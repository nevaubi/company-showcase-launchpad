import { describe, expect, it } from "vitest";
import type { DetailPeriod, DetailTable, FilingDetail, StoredDetail } from "./detail";
import { bankMetricsOf, exposureOf, rankRegion, regionKey } from "./exposure";

const FY = (y: number): DetailPeriod => ({ key: `D${y}`, start: `${y}-01-01`, end: `${y}-12-31`, months: 12 });
const YE = (y: number): DetailPeriod => ({ key: `I${y}`, end: `${y}-12-31`, months: 0 });
const vals = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v, id: `id-${k}` }]));

function filing(accn: string, year: number, extra: Partial<FilingDetail>): FilingDetail {
  const periods: Record<string, DetailPeriod> = {};
  for (let y = year - 2; y <= year; y++) {
    periods[`D${y}`] = FY(y);
    periods[`I${y}`] = YE(y);
  }
  return { format: 5, ticker: "X", accn, form: "10-K", filed: `${year + 1}-02-15`, reportDate: `${year}-12-31`, doc: `${accn}.htm`, periods, tables: [], segments: null, concentration: [], counts: { facts: 0, dimensional: 0 }, ...extra };
}
const geo = (rows: [string, string, Record<string, number>][], total: Record<string, number>): DetailTable => ({
  id: "geography|us-gaap:Revenues|USD|srt:StatementGeographicalAxis",
  family: "geography",
  title: "Revenue by geography",
  concept: "us-gaap:Revenues",
  conceptLabel: "Revenue",
  axis: "srt:StatementGeographicalAxis",
  axisLabel: "Geography",
  unit: "USD",
  periods: Object.keys(total),
  rows: rows.map(([member, label, v]) => ({ member, label, values: vals(v) })),
  total: vals(total),
});

describe("region keys", () => {
  it("maps filed region names to one key per region", () => {
    expect(regionKey("country:CN", "China")).toBe("china");
    expect(regionKey("x:GreaterChinaMember", "Greater China")).toBe("china");
    expect(regionKey("x:ChinaHk", "China (including Hong Kong)")).toBe("china");
    expect(regionKey("x:RestOfAsiaPacificMember", "Rest of Asia Pacific")).toBe("apac");
    expect(regionKey("x:Emea", "Europe, Middle East and Africa")).toBe("europe");
    expect(regionKey("x:NonUs", "Non-U.S. operations")).toBe("intl");
    expect(regionKey("x:Intl", "Total international")).toBe("intl");
    expect(regionKey("x:Na", "North America")).toBe("americas");
    expect(regionKey("country:US", "United States")).toBe("us");
    expect(regionKey("x:Other", "Other countries")).toBeNull();
    expect(regionKey("x:ExChina", "Asia excluding China")).toBeNull();
  });
});

describe("revenue exposure", () => {
  // Latest 10-K FY2023–FY2025, the one two years back FY2021–FY2023.
  const stored: StoredDetail = {
    ticker: "X",
    builtAt: "",
    format: 5,
    annual: filing("new", 2025, { tables: [geo([["country:US", "United States", { D2023: 60, D2024: 62, D2025: 70 }], ["country:CN", "China", { D2023: 30, D2024: 25, D2025: 20 }], ["x:O", "Other countries", { D2025: 10 }]], { D2023: 100, D2024: 100, D2025: 100 })] }),
    quarterly: null,
    history: [filing("old", 2023, { tables: [geo([["country:US", "United States", { D2021: 50, D2022: 55, D2023: 60 }], ["country:CN", "China", { D2021: 40, D2022: 35, D2023: 30 }]], { D2021: 100, D2022: 100, D2023: 100 })] })],
  };
  const e = exposureOf(stored)!;

  it("measures each region against the consolidated total and skips 'other'", () => {
    expect(e.regions.map((r) => [r.key, r.share])).toEqual([["us", 0.7], ["china", 0.2]]);
    expect(e.regions[1].value.parts[0]).toMatchObject({ accn: "new", id: "id-D2025", concept: "us-gaap:Revenues" });
  });

  it("compares with about three years earlier, from the older filing", () => {
    const cn = e.regions.find((r) => r.key === "china")!;
    expect(cn.prior).toMatchObject({ share: 0.35, period: "FY2022", years: 3 });
    expect(cn.prior!.value.parts[0].accn).toBe("old");
  });

  it("ranks companies by their share of one region", () => {
    const ranked = rankRegion({ builtAt: "", companies: { A: { exposure: e }, B: { exposure: { ...e, regions: [{ ...e.regions[1], share: 0.5 }] } } } }, "china");
    expect(ranked.map((x) => x.ticker)).toEqual(["B", "A"]);
  });
});

describe("bank metrics", () => {
  const C = (o: Record<string, Record<string, number>>) => Object.fromEntries(Object.entries(o).map(([c, m]) => [c, vals(m)]));
  const bank = (consolidated: Record<string, Record<string, number>>, extra: Partial<FilingDetail> = {}): StoredDetail => ({ ticker: "B", builtAt: "", format: 5, annual: filing("b", 2025, { consolidated: C(consolidated), ...extra }), quarterly: null });

  it("reads consolidated tags and prefers the broadest loan balance", () => {
    const m = bankMetricsOf(
      bank({
        "us-gaap:FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss": { I2025: 970, I2024: 896 },
        "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestBeforeAllowanceForCreditLoss": { I2025: 986, I2024: 913 },
        "wfc:FinancingReceivableAndNetInvestmentInLeaseExcludingAccruedInterestAfterAllowanceForCreditLoss": { I2025: 972 },
        "wfc:FinancingReceivableAndNetInvestmentInLeaseAllowanceForLoanLossesExcludingAccruedInterest": { I2025: 13.8 },
        "us-gaap:Deposits": { I2025: 1426, I2024: 1370 },
      }),
    )!;
    expect(m.loans.v).toBe(986);
    expect(m.loansPrior?.v).toBe(913);
    expect(m.allowance?.v).toBe(13.8);
    expect(m.deposits?.v).toBe(1426);
  });

  it("nets recoveries out of gross charge-offs when net charge-offs are not tagged", () => {
    const m = bankMetricsOf(
      bank({
        "us-gaap:FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss": { I2025: 1000 },
        "us-gaap:FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossWriteoff": { D2025: 9 },
        "us-gaap:FinancingReceivableExcludingAccruedInterestAllowanceForCreditLossRecovery": { D2025: 2 },
        "us-gaap:Deposits": { I2025: 1200 },
      }),
    )!;
    expect(m.nco?.v).toBe(7);
    expect(m.nco?.parts.map((p) => p.sign ?? 1)).toEqual([1, -1]);
  });

  it("drops a ratio whose tags describe a different scope", () => {
    const m = bankMetricsOf(bank({ "us-gaap:FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss": { I2025: 100 }, "us-gaap:FinancingReceivableAllowanceForCreditLossExcludingAccruedInterest": { I2025: 60 }, "us-gaap:Deposits": { I2025: 150 } }))!;
    expect(m.allowance).toBeUndefined();
  });

  it("uses only the latest fiscal year-end and needs more than a notes-receivable line", () => {
    expect(bankMetricsOf(bank({ "us-gaap:FinancingReceivableExcludingAccruedInterestBeforeAllowanceForCreditLoss": { I2023: 100 }, "us-gaap:Deposits": { I2023: 150 } }))).toBeNull();
    expect(bankMetricsOf(bank({ "us-gaap:NotesReceivableGross": { I2025: 40 } }))).toBeNull();
  });
});
