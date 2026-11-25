import { describe, expect, it } from "vitest";
import {
  aloneAmendments,
  dealFacts,
  factsOf,
  newestFirst,
  planMonitor,
  recordsPeriods,
  rowsPerPoint,
  trendDepth,
} from "./assemble";
import { stageOf, stageReason } from "./stage";
import type { DealRaw, FilingRaw, MonitorPayload } from "./types";
import cmbs from "@/test/fixtures/abs-view/monitor_cmbs.json";
import autoLoan from "@/test/fixtures/abs-view/monitor_auto_loan.json";

const filing = (over: Partial<FilingRaw>): FilingRaw => ({
  accession: "0000000000-26-000001",
  deal_id: "0000000001",
  list_cik: 1,
  form: "ABS-EE",
  filed: "2026-10-20",
  accepted_at: "2026-10-20T16:00:00+00:00",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  is_current: true,
  superseded_by: null,
  load_id: 1,
  ...over,
});

describe("the period the records state", () => {
  it("takes the latest date-shaped bucket and counts only dates", () => {
    const p = recordsPeriods([
      { load_id: 1, bucket: "2026-09-30" },
      { load_id: 1, bucket: "(blank)" },
      { load_id: 1, bucket: "2026-08-31" },
      { load_id: 2, bucket: "as written: 9/30/26" },
    ]);
    expect(p.get(1)).toEqual({ end: "2026-09-30", count: 2 });
    expect(p.get(2)).toEqual({ end: null, count: 0 });
  });
});

describe("stage by dates", () => {
  it("marks a file whose records state a period end after its filing date", () => {
    const s = stageOf({ filed: "2026-10-21", cover_end: "2026-10-11", records_end: "2026-11-11" });
    expect(s).toEqual({ offering: true, recordsAfterFiling: true, coverAfterFiling: false });
  });
  it("marks a file whose cover period ends after its filing date, even when its records are dated before", () => {
    // the Ford pattern: offering files carry the previous month's end in the records and the coming month in the header
    const s = stageOf({ filed: "2026-07-14", cover_end: "2026-07-31", records_end: "2026-06-30" });
    expect(s.offering).toBe(true);
    expect(s.recordsAfterFiling).toBe(false);
    expect(stageReason({ filed: "2026-07-14", cover_end: "2026-07-31", records_end: "2026-06-30" })).toContain(
      "cover period in its EDGAR header ends 2026-07-31",
    );
  });
  it("leaves a monthly report and an unreadable date alone", () => {
    expect(stageOf({ filed: "2026-10-29", cover_end: "2026-09-30", records_end: "2026-09-30" }).offering).toBe(false);
    expect(stageOf({ filed: "2026-10-29", cover_end: null, records_end: null }).offering).toBe(false);
  });
  it("rests on the cover period alone when the records' period was not read", () => {
    const f = factsOf(filing({ filed: "2026-10-20", period_end: "2026-09-30" }), { end: "2026-12-31", count: 1 }, false);
    expect(f.records_end).toBeNull();
    expect(f.period_ends).toBeNull();
    expect(f.records_after_filing).toBe(false);
  });
});

describe("amendments alone in their cover period (the abs_review() condition)", () => {
  it("finds an ABS-EE/A that shares its cover period with no other filing of the deal", () => {
    const original = filing({ accession: "0001539497-26-002699", period_end: "2026-10-11" });
    const moved = filing({ accession: "0001539497-26-002722", form: "ABS-EE/A", period_end: "2026-11-11" });
    const tied = filing({ accession: "0001539497-26-002800", form: "ABS-EE/A", period_end: "2026-10-11" });
    expect([...aloneAmendments([original, moved])]).toEqual(["0001539497-26-002722"]);
    expect(aloneAmendments([original, tied]).size).toBe(0);
  });
});

describe("a deal's filings, counted", () => {
  it("keeps offering-stage and superseded filings out of the monthly list and counts periods", () => {
    const rows = [
      filing({ accession: "a3", load_id: 3, filed: "2026-10-20", period_end: "2026-09-30" }),
      filing({ accession: "a2", load_id: 2, filed: "2026-09-20", period_end: "2026-08-31", is_current: false, superseded_by: "a2b" }),
      filing({ accession: "a2b", load_id: 5, form: "ABS-EE/A", filed: "2026-09-25", period_end: "2026-08-31" }),
      filing({ accession: "a1", load_id: 1, filed: "2026-07-14", period_end: "2026-07-31" }),
    ];
    const periods = recordsPeriods([
      { load_id: 3, bucket: "2026-09-30" },
      { load_id: 2, bucket: "2026-08-31" },
      { load_id: 5, bucket: "2026-08-31" },
      { load_id: 1, bucket: "2026-06-30" },
    ]);
    const d = dealFacts(rows, periods, () => true);
    expect(d.monthly.map((f) => f.accession)).toEqual(["a3", "a2b"]);
    expect(d.offering.map((f) => f.accession)).toEqual(["a1"]);
    expect(d.files).toEqual({
      loaded: 4,
      current: 3,
      offering: 1,
      monthly: 2,
      monthly_periods: 2,
      review: 0,
      first_period: "2026-08-31",
      first_filed: "2026-07-14",
      last_filed: "2026-10-20",
    });
  });
  it("orders by the records' period, then by SEC acceptance", () => {
    const a = factsOf(filing({ accession: "x1", accepted_at: "2026-10-20T10:00:00+00:00" }), { end: "2026-09-30", count: 1 }, true);
    const b = factsOf(filing({ accession: "x2", accepted_at: "2026-10-21T10:00:00+00:00" }), { end: "2026-09-30", count: 1 }, true);
    const c = factsOf(filing({ accession: "x3" }), { end: "2026-10-31", count: 1 }, true);
    expect([a, b, c].sort(newestFirst).map((f) => f.accession)).toEqual(["x3", "x2", "x1"]);
  });
});

describe("trend depth within the row budget", () => {
  it("keeps the full cap while the budget allows it", () => {
    expect(trendDepth([4, 6, 13, 2], 13, 6000)).toBe(13);
  });
  it("shortens every deal's trend alike when the budget binds, never below two", () => {
    const counts = Array.from({ length: 110 }, () => 40);
    const depth = trendDepth(counts, rowsPerPoint("auto_loan"), 6000);
    expect(depth).toBe(4);
    expect(110 * depth * rowsPerPoint("auto_loan")).toBeLessThanOrEqual(6000);
    expect(trendDepth(Array.from({ length: 5000 }, () => 40), 13, 6000)).toBe(2);
  });
  it("says when the cut applied", () => {
    const deals: DealRaw[] = Array.from({ length: 200 }, (_, i) => ({
      deal_id: String(i).padStart(10, "0"),
      issuer_cik: i,
      issuer_name: `Trust ${i}`,
      file_number: null,
      family: "auto_loan",
      depositor_cik: null,
      sponsor_cik: null,
    }));
    const filings = deals.flatMap((d, i) =>
      Array.from({ length: 20 }, (_, m) =>
        filing({
          accession: `${d.deal_id}-${m}`,
          deal_id: d.deal_id,
          load_id: i * 100 + m,
          filed: `20${10 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-25`,
          period_end: `20${10 + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}-01`,
        }),
      ),
    );
    const plan = planMonitor({ family: "auto_loan", deals, filings, periodRows: [], periodRead: new Set() });
    expect(plan.cut).toBe(true);
    expect(plan.splitLoads.length).toBe(200 * plan.depth);
  });
});

describe("monitor payloads read from real filings", () => {
  const payloads = [cmbs, autoLoan] as unknown as MonitorPayload[];
  it("never puts an offering-stage filing in a trend or in a deal's newest period", () => {
    for (const p of payloads)
      for (const d of p.deals) {
        if (d.latest) expect(d.latest.records_after_filing || d.latest.cover_after_filing).toBe(false);
        if (d.offering) expect(d.trend.some(([, acc]) => acc === d.offering!.accession)).toBe(false);
      }
  });
  it("keeps the AXDB amendment that moved its period out of the series and counts it for review", () => {
    const axdb = (cmbs as unknown as MonitorPayload).deals.find((d) => d.deal_id === "0002158812")!;
    expect(axdb.latest!.accession).toBe("0001539497-26-002699");
    expect(axdb.offering!.accession).toBe("0001539497-26-002722");
    expect(axdb.files.review).toBe(1);
  });
  it("gives each trend point the stored end amount, which the status split adds up to", () => {
    for (const p of payloads)
      for (const d of p.deals)
        for (const [, , end, split] of d.trend) {
          const sum = Object.values(split).reduce((s, v) => s + Number(v ?? 0), 0);
          expect(Math.abs(sum - Number(end))).toBeLessThan(0.005);
        }
  });
});
