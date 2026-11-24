import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hydrateDataset } from "@/lib/financials/dataset";
import type { CompanyDataset, Period } from "@/lib/financials/types";
import type { Reaction } from "@/lib/markets/core";
import { growth, nextConsensus, pendingRelease, priorIndex, quarterRecords, reactionSummary, recentQuarters, releaseFor, surpriseFor, yearAgoIndex, type Figure } from "./quarters";

const load = (t: string) => hydrateDataset(JSON.parse(readFileSync(path.resolve(__dirname, `../../test/fixtures/companies/${t}.json`), "utf8")) as CompanyDataset);
const AAPL = load("AAPL");
const JPM = load("JPM");
const NVDA = load("NVDA");
const C = load("C");

const reaction = (date: string, move: number, excess: number | null = null, drift20: number | null = null): Reaction => ({
  date,
  accn: `a-${date}`,
  doc: "ex99.htm",
  move,
  excess,
  gap: move,
  preRun: null,
  drift5: null,
  drift20,
  volRatio: null,
  sigma: null,
});

describe("quarterRecords on real filings", () => {
  // Hand-checked against the AAPL fixture's 10-Q cells: Q3 FY26 (27 Jun 2026) and Q3 FY25 (28 Jun 2025).
  const aapl = recentQuarters(quarterRecords({ dataset: AAPL }));
  const q = aapl[0];
  it("takes the newest quarter first", () => {
    expect(q.period.label).toBe("Q3 FY26");
    expect(q.revenue?.v).toBe(109_417_000_000);
    expect(q.revenue?.cell?.src?.accn).toBe("0000320193-26-000020");
  });
  it("computes growth against the quarter a year earlier and the one before", () => {
    expect(q.yoy.revenue?.v).toBeCloseTo(109_417 / 94_036 - 1, 10); // +16.36%
    expect(q.yoy.eps?.v).toBeCloseTo(2.02 / 1.57 - 1, 10); // +28.66%
    expect(q.qoq.revenue?.v).toBeCloseTo(109_417 / 111_184 - 1, 10); // −1.59%
    expect(q.yoy.fcf?.v).toBeCloseTo(31_914 / 24_405 - 1, 10);
  });
  it("computes margins with both statement cells as the formula's parts", () => {
    expect(q.profitMargin?.v).toBeCloseTo(35_695 / 109_417, 10); // 32.6%
    expect(q.grossMargin?.v).toBeCloseTo(54_770 / 109_417, 10);
    const parts = q.profitMargin?.derived?.parts ?? [];
    expect(parts.map((p) => p.concept)).toEqual(expect.arrayContaining(["us-gaap:OperatingIncomeLoss", "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax"]));
  });
  it("finds the release that reported the quarter", () => {
    expect(q.release?.filed).toBe("2026-07-30");
    expect(q.release?.accn).toBe("0000320193-26-000018");
  });
  it("keeps free cash flow from the statement's own line", () => {
    expect(q.fcf?.v).toBe(31_914_000_000);
    expect(q.fcf?.cell?.derived?.formula).toMatch(/Cash from operations/);
  });

  it("uses pre-tax income for a bank and leaves free cash flow out", () => {
    const [j] = recentQuarters(quarterRecords({ dataset: JPM }));
    expect(j.period.end).toBe("2026-06-30");
    expect(j.profit?.v).toBe(27_516_000_000);
    expect(j.profitMargin?.v).toBeCloseTo(27_516 / 57_347, 10);
    expect(j.fcf).toBeNull();
    expect(j.yoy.revenue?.v).toBeCloseTo(57_347 / 44_912 - 1, 10);
  });

  it("matches a fiscal quarter to the provider's calendar-month surprise record", () => {
    const [n] = recentQuarters(quarterRecords({ dataset: NVDA, surprises: [{ quarter: "2026-07-31", actual: 2.22, estimate: 2.09113, surprisePct: 0.0616 }] }));
    expect(n.period.end).toBe("2026-07-26");
    expect(n.surprise?.actual).toBe(2.22);
    expect(n.yoy.revenue?.v).toBeCloseTo(96_221 / 46_743 - 1, 10); // +105.9%
    expect(n.release?.filed).toBe("2026-08-26");
  });

  it("attaches the stock's reaction to the release by its filing date", () => {
    const [a] = recentQuarters(quarterRecords({ dataset: AAPL, reactions: [reaction("2026-07-30", -0.0866, -0.1107, 0.0358)] }));
    expect(a.reaction?.move).toBe(-0.0866);
  });
});

describe("pendingRelease", () => {
  it("names a release newer than the statements (AAPL reported the September quarter on 2 Nov 2026)", () => {
    const recs = quarterRecords({ dataset: AAPL });
    const p = pendingRelease(recs, AAPL.earningsReleases, [reaction("2026-11-02", 0.031)], [
      { quarter: "2026-06-30", actual: 2.02, estimate: 1.89, surprisePct: 0.067 },
      { quarter: "2026-09-30", actual: 2.1, estimate: 1.98483, surprisePct: 0.058 },
    ]);
    expect(p?.release.filed).toBe("2026-11-02");
    expect(p?.throughEnd).toBe("2026-06-27");
    expect(p?.reaction?.move).toBe(0.031);
    expect(p?.surprise?.quarter).toBe("2026-09-30");
  });
  it("is null when the newest release is already reflected", () => {
    const recs = quarterRecords({ dataset: AAPL });
    const old = AAPL.earningsReleases.filter((r) => r.filed <= "2026-07-30");
    expect(pendingRelease(recs, old)).toBeNull();
  });
});

describe("period matching", () => {
  const p = (end: string): Period => ({ key: end, label: end, fy: 0, end });
  it("finds the year-ago quarter across a 53-week year", () => {
    const ps = [p("2024-09-28"), p("2024-12-28"), p("2025-03-29"), p("2025-06-28"), p("2025-09-27"), p("2025-12-27"), p("2026-03-28"), p("2026-06-27"), p("2026-10-03")];
    expect(yearAgoIndex(ps, 8)).toBe(4); // 371 days
    expect(priorIndex(ps, 8)).toBe(7); // 98 days
  });
  it("does not treat a gap in the series as the prior quarter", () => {
    const ps = [p("2025-03-31"), p("2025-09-30")];
    expect(priorIndex(ps, 1)).toBe(-1);
    expect(yearAgoIndex(ps, 1)).toBe(-1);
  });
  it("without the periodic report, matches only a single candidate and leaves two unmatched", () => {
    const rel = (filed: string) => ({ accn: filed, filed, doc: "", title: "" });
    expect(releaseFor("2026-06-30", [rel("2026-06-29"), rel("2026-07-20")])?.filed).toBe("2026-07-20");
    expect(releaseFor("2026-06-30", [rel("2026-07-02"), rel("2026-07-22")])).toBeNull();
    expect(releaseFor("2026-06-30", [rel("2026-10-30")])).toBeNull();
  });
  it("matches a surprise record within a month of the period end", () => {
    expect(surpriseFor("2026-06-27", [{ quarter: "2026-06-30", actual: 1, estimate: 1, surprisePct: 0 }])?.quarter).toBe("2026-06-30");
    expect(surpriseFor("2026-06-27", [{ quarter: "2026-09-30", actual: 1, estimate: 1, surprisePct: 0 }])).toBeNull();
  });
});

describe("growth", () => {
  const f = (v: number): Figure => ({ v, cell: { v, src: { accn: "x", concept: "c", end: "2026-01-01", value: v } } });
  it("is null when the sign flips or the base is zero", () => {
    expect(growth(f(5), f(-2), "Net income", "a year earlier")).toBeNull();
    expect(growth(f(5), f(0), "Net income", "a year earlier")).toBeNull();
  });
  it("measures a smaller loss as a rise against the absolute base", () => {
    expect(growth(f(-50), f(-100), "Net income", "a year earlier")?.v).toBeCloseTo(0.5, 10);
  });
});

describe("reactionSummary", () => {
  it("takes medians over the newest releases", () => {
    const rs = [reaction("2026-01-30", 0.04, 0.03, 0.02), reaction("2026-04-30", -0.06, -0.05, -0.01), reaction("2026-07-30", 0.02, 0.01, 0.05), reaction("2025-10-30", 0.1, 0.08, null)];
    const s = reactionSummary(rs, 3)!;
    expect(s.n).toBe(3);
    expect(s.medianAbs).toBeCloseTo(0.04, 10); // |0.02|, |0.04|, |−0.06|
    expect(s.upRate).toBeCloseTo(2 / 3, 10);
    expect(s.medianExcess).toBeCloseTo(0.01, 10);
    expect(s.medianDrift20).toBeCloseTo(0.02, 10);
    expect(s.largest?.date).toBe("2026-04-30");
  });
  it("needs at least three releases", () => {
    expect(reactionSummary([reaction("2026-01-30", 0.04)])).toBeNull();
  });
});

describe("nextConsensus", () => {
  const r = (avg: number | null) => ({ avg, low: null, high: null, analysts: 25, yearAgo: null, growth: null });
  const per = (code: "0q" | "+1q", endDate: string, eps: number | null) => ({
    code,
    endDate,
    eps: r(eps),
    revenue: r(null),
    trend: { current: null, d7: null, d30: null, d60: null, d90: null },
    revisions: { up7: null, down7: null, up30: null, down30: null },
  });
  it("skips the provider period that was already reported", () => {
    const ps = [per("0q", "2026-09-30", 1.98), per("+1q", "2026-12-31", 2.91)];
    expect(nextConsensus(ps, "2026-09-26")?.endDate).toBe("2026-12-31");
  });
  it("takes this quarter when it is still ahead", () => {
    expect(nextConsensus([per("0q", "2026-12-31", 2.91), per("+1q", "2027-03-31", 2.15)], "2026-09-30")?.eps.avg).toBe(2.91);
  });
  it("is null without estimates", () => {
    expect(nextConsensus(null, "2026-09-30")).toBeNull();
  });
});

// Real EDGAR filing dates (submissions index, read 23 Nov 2026): each company files two Item 2.02 8-Ks
// a quarter (Tesla: deliveries, then results; AbbVie and EOG: a pre-announcement, then results).
const EDGAR_2026: Record<string, { releases: string[]; periodic: [form: string, filed: string, report: string][] }> = {
  TSLA: {
    releases: ["2025-10-02", "2025-10-22", "2026-01-02", "2026-01-28", "2026-04-02", "2026-04-22", "2026-07-02", "2026-07-22", "2026-10-02", "2026-10-21"],
    periodic: [["10-Q", "2025-10-23", "2025-09-30"], ["10-K", "2026-01-29", "2025-12-31"], ["10-Q", "2026-04-23", "2026-03-31"], ["10-Q", "2026-07-23", "2026-06-30"], ["10-Q", "2026-10-22", "2026-09-30"]],
  },
  ABBV: {
    releases: ["2025-10-03", "2025-10-31", "2026-01-07", "2026-02-04", "2026-04-03", "2026-04-29", "2026-07-06", "2026-07-31", "2026-10-05", "2026-10-30"],
    periodic: [["10-Q", "2025-11-04", "2025-09-30"], ["10-K", "2026-02-20", "2025-12-31"], ["10-Q", "2026-05-08", "2026-03-31"], ["10-Q", "2026-08-03", "2026-06-30"], ["10-Q", "2026-11-03", "2026-09-30"]],
  },
  EOG: {
    releases: ["2025-10-08", "2025-11-06", "2026-01-12", "2026-02-24", "2026-04-09", "2026-05-05", "2026-07-09", "2026-08-04", "2026-10-08", "2026-11-05"],
    periodic: [["10-Q", "2025-11-06", "2025-09-30"], ["10-K", "2026-02-24", "2025-12-31"], ["10-Q", "2026-05-05", "2026-03-31"], ["10-Q", "2026-08-04", "2026-06-30"], ["10-Q", "2026-11-05", "2026-09-30"]],
  },
};
const RESULTS: Record<string, string[]> = {
  TSLA: ["2025-10-22", "2026-01-28", "2026-04-22", "2026-07-22", "2026-10-21"],
  ABBV: ["2025-10-31", "2026-02-04", "2026-04-29", "2026-07-31", "2026-10-30"],
  EOG: ["2025-11-06", "2026-02-24", "2026-05-05", "2026-08-04", "2026-11-05"],
};
const ENDS = ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30", "2026-09-30"];

function multiDataset(t: string, statementEnds: string[]): CompanyDataset {
  const e = EDGAR_2026[t];
  const periods = statementEnds.map((end, i) => ({ key: `P${i}`, label: `Q ending ${end}`, fy: 2026, end }));
  const cell = (end: string) => ({ v: 100, src: { accn: "x", concept: "us-gaap:Revenues", end } });
  return {
    statements: { quarterly: { income: { periods, rows: [{ key: "revenue", label: "Revenue", unit: "usd", cells: statementEnds.map(cell) }] } } },
    earningsReleases: e.releases.map((filed) => ({ accn: `a-${filed}`, filed, doc: "ex99.htm", title: "" })),
    filings: e.periodic.map(([form, filed, report]) => ({ accn: `p-${filed}`, form, filed, report, doc: "" })),
  } as unknown as CompanyDataset;
}

describe("two Item 2.02 releases a quarter (earnings-C1)", () => {
  for (const t of Object.keys(EDGAR_2026)) {
    it(`${t}: each quarter gets its results release, not the earlier filing`, () => {
      const recs = quarterRecords({ dataset: multiDataset(t, ENDS) });
      expect(recs.map((r) => r.release?.filed ?? null)).toEqual(RESULTS[t]);
    });
    it(`${t}: with current statements there is no newer release`, () => {
      const d = multiDataset(t, ENDS);
      expect(pendingRelease(quarterRecords({ dataset: d }), d.earningsReleases, [], null, d.filings)).toBeNull();
    });
  }
  it("TSLA with statements through June: one quarter later has two releases, reported as a count", () => {
    const d = multiDataset("TSLA", ENDS.slice(0, 4));
    const p = pendingRelease(quarterRecords({ dataset: d }), d.earningsReleases, [], null, d.filings);
    expect(p?.release.filed).toBe("2026-10-21");
    expect(p?.count).toBe(2);
  });
});

describe("statements lagging several quarters (earnings-H1)", () => {
  it("Citigroup: counts the releases since Q4 FY25 and takes the surprise nearest the newest release", () => {
    const recs = quarterRecords({ dataset: C });
    const p = pendingRelease(recs, C.earningsReleases, [], [
      { quarter: "2026-03-31", actual: 1, estimate: 1, surprisePct: 0 },
      { quarter: "2026-09-30", actual: 2, estimate: 1.9, surprisePct: 0.05 },
    ], C.filings);
    expect(p?.throughLabel).toBe("Q4 FY25");
    expect(p?.release.filed).toBe("2026-10-13");
    expect(p?.count).toBe(3);
    expect(p?.surprise?.quarter).toBe("2026-09-30");
  });
});

describe("fourth-quarter EPS (earnings-H2)", () => {
  const MSFT = load("MSFT");
  const q4 = (d: CompanyDataset, label: string, releaseEps?: { accn: string; v: number; quote?: string }[]) =>
    quarterRecords({ dataset: d, releaseEps }).find((r) => r.period.label === label)!;

  // Releases: Apple 30 Oct 2025 "$1.85", NVIDIA 26 Feb 2025 "$0.89", Microsoft Jul 2026 "$4.81".
  // The year-minus-nine-months cells are 1.84, 0.90 and 4.81.
  it("derives Q4 EPS from net income and weighted diluted shares, matching the releases", () => {
    for (const [d, label, want] of [
      [AAPL, "Q4 FY25", 1.85],
      [AAPL, "Q4 FY24", 0.97],
      [NVDA, "Q4 FY25", 0.89],
      [MSFT, "Q4 FY26", 4.81],
    ] as const) {
      const r = q4(d, label);
      expect(r.eps?.v, label).toBe(want);
      expect(r.eps?.q4).toBe("derived");
      expect(r.eps?.cell).toBeUndefined();
      expect(r.eps?.derived?.parts.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("shows no Q4 EPS where net income over shares does not reproduce reported EPS (preferred dividends)", () => {
    // JPMorgan reported $4.63 for Q4 FY25; net income ÷ shares gives about $4.75.
    expect(q4(JPM, "Q4 FY25").eps).toBeNull();
    expect(q4(JPM, "Q4 FY25").yoy.eps).toBeUndefined();
  });

  it("uses the figure printed in the quarter's release when it is known", () => {
    const rel = q4(AAPL, "Q4 FY25").release!;
    const r = q4(AAPL, "Q4 FY25", [{ accn: rel.accn, v: 1.85, quote: "Diluted earnings per share was $1.85" }]);
    expect(r.eps).toMatchObject({ v: 1.85, q4: "release", doc: { accn: rel.accn, doc: rel.doc } });
  });

  it("leaves reported quarters untouched", () => {
    expect(q4(AAPL, "Q3 FY25").eps?.cell?.src).toBeDefined();
    expect(q4(AAPL, "Q3 FY25").eps?.q4).toBeUndefined();
  });
});
