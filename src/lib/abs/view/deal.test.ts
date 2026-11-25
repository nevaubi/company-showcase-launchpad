import { describe, expect, it } from "vitest";
import { breakdownOf, dealModel, foreclosureShare, loanTable, replacedNote, sortLoans, topItems, watchLoans } from "./deal";
import type { CmbsLoan, CmbsProperty, DealPayload } from "./types";
import dbgs from "@/test/fixtures/abs-view/deal_0001752363.json";
import axdb from "@/test/fixtures/abs-view/deal_0002158812.json";
import lease from "@/test/fixtures/abs-view/deal_0002126256.json";
import worldOmni from "@/test/fixtures/abs-view/deal_0002140699.json";
import single from "@/test/fixtures/abs-view/deal_0002149768.json";

const model = (p: unknown) => dealModel(p as DealPayload);

describe("filings list", () => {
  it("lists a superseded filing, points it at its replacement and feeds no figure from it", () => {
    const m = model(dbgs);
    const old = m.filings.find((f) => f.accession === "0001539497-18-001601")!;
    expect(old.state).toBe("superseded");
    expect(old.replacedBy).toMatchObject({ accession: "0001539497-18-001710", amendment: true });
    expect(replacedNote(old)).toContain("0001539497-18-001710");
    expect(m.cmbs.some((p) => p.accession === old.accession)).toBe(false);
    expect(m.cmbs).toHaveLength(97);
  });
  it("carries the review condition and keeps the moved amendment out of the series", () => {
    const m = model(axdb);
    expect(m.review.map((f) => f.accession)).toEqual(["0001539497-26-002722"]);
    expect(m.cmbs.map((p) => p.accession)).toEqual(["0001539497-26-002699"]);
    expect(m.offeringCmbs.map((p) => p.accession)).toEqual(["0001539497-26-002722"]);
    const moved = m.filings.find((f) => f.accession === "0001539497-26-002722")!;
    expect(moved.stage).toEqual({ offering: true, recordsAfterFiling: true, coverAfterFiling: true });
  });
  it("keeps the asset file's size and SHA-256 and the EDGAR index address of every filing", () => {
    for (const f of model(worldOmni).filings) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.bytes).toBeGreaterThan(0);
      expect(f.indexUrl).toMatch(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/\d+\//);
    }
  });
});

describe("auto series and breakdowns", () => {
  const m = model(worldOmni);
  it("builds the series oldest first from current monthly filings only", () => {
    expect(m.auto.map((p) => p.recordsEnd)).toEqual(["2026-06-30", "2026-07-31", "2026-08-31", "2026-09-30"]);
    const last = m.auto[m.auto.length - 1];
    expect(last.due60.denominator).toBeCloseTo(last.end!.value!, 2);
    expect(last.pti.p50?.text).not.toBeNull();
  });
  it("ranks the newest file's states by end amount, each share of the whole file", () => {
    const states = m.breakdowns.state;
    expect(states.items.length).toBeGreaterThan(10);
    const amounts = states.items.map((i) => i.amount ?? 0);
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    const total = states.items.reduce((s, i) => s + (i.amount ?? 0), 0);
    expect(total).toBeCloseTo(states.total!, 0);
    const top = topItems(states, 10);
    expect(top.items).toHaveLength(11);
    expect(top.items[10].share).toBeCloseTo(
      states.items.slice(10).reduce((s, i) => s + (i.amount ?? 0), 0) / states.total!,
      12,
    );
  });
  it("keeps the score bands in their order", () => {
    const bands = m.breakdowns.score_band.items.map((i) => i.bucket);
    const order = ["under 620", "620 to 659", "660 to 719", "720 and over", "no valid score", "(blank)"];
    expect(bands).toEqual(order.filter((b) => bands.includes(b)));
  });
  it("reads lease files by their end securitization value", () => {
    const l = model(lease);
    expect(l.auto).toHaveLength(6);
    expect(l.auto[5].end!.value).toBeGreaterThan(0);
    expect(l.auto[5].recoveries).toBeNull();
    expect(l.breakdowns.make.items.length).toBeGreaterThan(0);
  });
  it("shows a single filing without a series to draw", () => {
    const s = model(single);
    expect(s.auto).toHaveLength(1);
    expect(s.shown?.accession).toBe("0001104659-26-108299");
  });
});

describe("commercial mortgage loans", () => {
  const m = model(dbgs);
  const table = m.loanTable!;
  it("ties every property row to its loan or lists it as untied", () => {
    const tied = table.loans.reduce((s, l) => s + l.properties.length + (l.own ? 1 : 0), 0);
    expect(tied + table.untied.length).toBe((dbgs as unknown as DealPayload).properties.length);
  });
  it("lists the loans to look at first, worst payment status first", () => {
    const watch = watchLoans(table);
    expect(watch.length).toBeGreaterThan(0);
    expect(watch[0].statusCode).toBe("3");
  });
  it("sorts by balance and keeps loans without one last", () => {
    const sorted = sortLoans(table.loans, "balance", "desc");
    const known = sorted.map((l) => l.endBalance).filter((v): v is number => v != null);
    expect(known).toEqual([...known].sort((a, b) => b - a));
  });
  it("reads foreclosure and REO from workout strategy and property status", () => {
    const loan = (over: Partial<CmbsLoan>): CmbsLoan => ({
      rec: 1, kind: "loan", asset_number: "1", period_begin: null, period_end: null, original_loan_amount: null,
      maturity_date: null, properties: null, interest_only: null, sched_end_balance: 100, actual_end_balance: null,
      period_rate: null, paid_through_date: null, payment_status_code: "0", modified: null, realized_loss: null,
      liquidation_prepayment_code: null, liquidation_prepayment_date: null, workout_strategy_code: null,
      special_servicer_transfer_date: null, master_servicer_return_date: null, ...over,
    });
    const prop = (over: Partial<CmbsProperty>): CmbsProperty => ({
      rec: 2, seq: 1, asset_number: "2", loan_asset_number: "2", link: "nested", name: null, city: null, state: null,
      type_code: null, status_code: "6", occupancy_securitization: null, occupancy_recent: null,
      financials_recent_end: null, dscr_ncf_securitization: null, dscr_ncf_recent: null,
      dscr_noi_securitization: null, dscr_noi_recent: null, ...over,
    });
    const t = loanTable(
      [loan({ rec: 1, asset_number: "1", workout_strategy_code: "7" }), loan({ rec: 2, asset_number: "2", sched_end_balance: 300 }), loan({ rec: 3, asset_number: "3", sched_end_balance: 600 })],
      [prop({ rec: 2, asset_number: "2", loan_asset_number: "2", status_code: "1" })],
    );
    const s = foreclosureShare(t, "x");
    expect(s.loans).toBe(2);
    expect(s.value).toBeCloseTo(400 / 1000, 12);
  });
});

describe("breakdown edges", () => {
  it("gives no share when the file states no end amount", () => {
    const b = breakdownOf("auto_loan", [["end_balance", "state", "CA", "10", 1, 0]], "state", null);
    expect(b.items[0].share).toBeNull();
  });
});
