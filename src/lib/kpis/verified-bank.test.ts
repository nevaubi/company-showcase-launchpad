import { describe, expect, it } from "vitest";
import {
  reviewedBankCompany,
  standaloneBankCompany,
  reviewedBankLatest,
  type StandardLatest,
  type StdCompany,
  type VerifiedBankPoint,
} from "./verified-bank";

const company: StdCompany = {
  ticker: "PNC",
  sector: "Financials",
  industry: "Banks",
  docs: {},
  series: {
    avg_deposits: {
      kpi_id: "retail",
      name: "Average deposits (In billions)",
      unit: "USD",
      current: true,
      alts: [],
      Q: [["2026-09-30", 267.1e6, "Q3 2026", null, null, null, null, null, null, null]],
      A: [],
    },
  },
};
const latest: StandardLatest = {
  generated: "2026-11-27",
  kpis: {
    avg_deposits: {
      PNC: {
        q: ["2026-09-30", 267.1e6, "Q3 2026", null],
        a: ["2025-12-31", 1, "FY 2025", null],
        ind: "Banks",
        sec: "Financials",
        kpi_id: "retail",
      },
      PEER: {
        q: ["2026-09-30", 310e9, "Q3 2026", null],
        a: null,
        ind: "Banks",
        sec: "Financials",
        kpi_id: "deposits",
      },
    },
  },
};
const point: VerifiedBankPoint = {
  ticker: "PNC",
  metric: "avg_deposits",
  amount_usd: 461.2e9,
  period_end: "2026-09-30",
  period_label: "Q3 2026",
  filing_url: "https://www.sec.gov/Archives/example.htm#deposits",
  issuer_label: "Average deposits",
  source_section: "Consolidated balance sheet review · Deposits",
  source_quote: "In billions · Average deposits $461.2 / $457.0 / $431.8",
  published_on: "2026-10-15",
};

describe("standardized bank filing receipts", () => {
  it("can show an issuer's independent filing sheet while the universe or company file is unavailable", () => {
    const filing = standaloneBankCompany("PNC", [point]);
    expect(filing?.series.avg_deposits.Q[0][1]).toBe(461.2e9);
    expect(standaloneBankCompany("WAL", [point])).toBeUndefined();
  });

  it("withholds incompatible legacy points from both company and peer data while verification is unavailable", () => {
    const corrected = reviewedBankLatest(latest, []);
    expect(reviewedBankCompany(company, []).series.avg_deposits).toBeUndefined();
    expect(corrected.kpis.avg_deposits.PNC).toBeUndefined();
    expect(corrected.kpis.avg_deposits.PEER).toBe(latest.kpis.avg_deposits.PEER);
    expect(latest.kpis.avg_deposits.PNC.q?.[1]).toBe(267.1e6);
  });
  it("rebuilds both presentations from the same chronological, scoped source points", () => {
    const prior = {
      ...point,
      period_end: "2025-09-30",
      period_label: "Q3 2025",
      amount_usd: 431.8e9,
    };
    const rows = [point, prior];
    const result = reviewedBankCompany(company, rows);
    const q = result.series.avg_deposits.Q;
    expect(q.map((p) => p[1])).toEqual([431.8e9, 461.2e9]);
    expect(result.docs[q[1][3]!][3]).toBe(point.filing_url);
    const cell = reviewedBankLatest(latest, rows).kpis.avg_deposits.PNC;
    expect(cell.q?.slice(0, 3)).toEqual(q[1].slice(0, 3));
    expect(cell.q?.[3]).toBeCloseTo((461.2 - 431.8) / 431.8);
    expect(cell.verified).toEqual(point);
    expect(cell.a).toBeNull();
    expect(result.series.avg_deposits.A).toEqual([]);
  });
});
