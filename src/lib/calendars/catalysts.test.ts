import { describe, expect, it } from "vitest";
import { altCatalysts, daysAway, heatGrid, lockupCatalysts, mergeCatalysts, type CatalystEvent } from "./catalysts";
import type { CalData } from "./rows";

const ev = (o: Partial<CatalystEvent>): CatalystEvent => ({
  id: Math.random().toString(36),
  date: "2026-11-10",
  kind: "earnings",
  ticker: "AAPL",
  name: "Apple",
  title: "t",
  detail: null,
  estimated: false,
  basis: null,
  source: { label: "s", url: null },
  weight: 2,
  ...o,
});

describe("catalysts", () => {
  it("derives a labelled 180-day lock-up from the pricing date", () => {
    const d = {
      today: "2026-11-07",
      uni: new Map(),
      ipos: { generated: "", as_of: "", window_days: 0, method: "", rows: [{ cik: 1, name: "NewCo", status: "priced", priced: "2026-06-01", symbol: "NEW", filings: [{ form: "424B4", date: "2026-06-02", accn: "a", doc: null, url: "https://sec.gov/x" }] }] },
    } as unknown as CalData;
    const [e] = lockupCatalysts(d);
    expect(e.date).toBe("2026-11-28");
    expect(e.estimated).toBe(true);
    expect(e.source.url).toBe("https://sec.gov/x");
  });
  it("reads trial completions, awards and award ends", () => {
    const out = altCatalysts(
      [
        { uid: "1", ticker: "MRNA", dataset: "trials", date: null, title: "Trial X", value: null, meta: { primary_completion: "2027-01", phase: "PHASE3", nct: "NCT1" }, source: "ClinicalTrials.gov", source_url: null },
        { uid: "2", ticker: "LMT", dataset: "contracts", date: "2026-11-01", title: "Award", value: 2e9, meta: { end: "2027-03-31", agency: "DoD", award_id: "A1" }, source: "USAspending.gov", source_url: null },
      ],
      new Map([["MRNA", "Moderna"]]),
    );
    expect(out.map((e) => [e.kind, e.date, e.estimated])).toEqual([
      ["trial", "2027-01-28", true],
      ["award", "2026-11-01", false],
      ["award_end", "2027-03-31", false],
    ]);
    expect(out[1].weight).toBe(3);
  });
  it("merges, filters by window and tickers (macro always kept), and sorts", () => {
    const m = mergeCatalysts(
      [[ev({ id: "a", date: "2026-11-12", ticker: "MSFT" }), ev({ id: "b", date: "2026-11-11" }), ev({ id: "c", date: "2027-02-01" })], [ev({ id: "m", kind: "macro", ticker: null, date: "2026-11-11", weight: 3 })]],
      "2026-11-07",
      "2026-12-31",
      new Set(["AAPL"]),
    );
    expect(m.map((e) => e.id)).toEqual(["m", "b"]);
  });
  it("builds a weekday heat grid", () => {
    const g = heatGrid([ev({ date: "2026-11-10" }), ev({ date: "2026-11-10", kind: "macro" })], "2026-11-09", 2);
    expect(g.length).toBe(2);
    expect(g[0][1]).toMatchObject({ date: "2026-11-10", count: 2 });
    expect(g[1][0].date).toBe("2026-11-16");
  });
  it("counts days from today", () => {
    expect(daysAway("2026-11-10", "2026-11-07")).toBe(3);
  });
});
