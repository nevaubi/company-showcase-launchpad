import { describe, expect, it } from "vitest";
import { addDays, dayDiff, minutesOf, shortTime, weekStart } from "./data";
import { dividendEvents, earningsRows, type CalData } from "./rows";

describe("calendar dates", () => {
  it("weekStart returns the Monday, rolling weekends forward", () => {
    expect(weekStart("2026-11-05")).toBe("2026-11-02"); // Thursday
    expect(weekStart("2026-11-07")).toBe("2026-11-09"); // Saturday
    expect(weekStart("2026-11-08")).toBe("2026-11-09"); // Sunday
    expect(weekStart("2026-11-09")).toBe("2026-11-09");
  });
  it("adds days and diffs across month ends", () => {
    expect(addDays("2026-11-30", 2)).toBe("2026-12-02");
    expect(dayDiff("2026-11-30", "2026-12-02")).toBe(2);
  });
  it("orders release times", () => {
    expect(minutesOf("8:30 a.m. ET")).toBe(510);
    expect(minutesOf("2:00 p.m. ET")).toBe(840);
    expect(minutesOf("12:00 p.m. ET")).toBe(720);
    expect(minutesOf(null)).toBe(1440);
    expect(shortTime("10:00 a.m. ET")).toBe("10a");
  });
});

const base: CalData = { today: "2026-11-07", uni: new Map() };

describe("calendar rows", () => {
  it("falls back to the index's next_earnings when the calendar entry is absent", () => {
    const rows = earningsRows({
      ...base,
      earnings: {
        generated: "",
        companies: [
          { ticker: "AAA", next_earnings: "2026-11-10", consensus_as_of: null, eps_0q: 1.2 },
          { ticker: "BBB", next_earnings: null, consensus_as_of: null, eps_0q: null },
        ],
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].eps).toBe(1.2);
  });
  it("drops a projection once a declaration lands near it", () => {
    const dec = {
      amount: 0.5,
      kind: "quarterly",
      record: "2026-11-20",
      payable: "2026-12-01",
      ex_date: "2026-11-20",
      increase: false,
      quote: "q",
      filed: "2026-11-01",
      accn: "a",
      doc: "d",
      url: "u",
      form: "8-K",
      exhibit: null,
    };
    const ev = dividendEvents({
      ...base,
      dividends: {
        generated: "",
        as_of: "",
        declared_window_days: 60,
        sources: {},
        rows: [
          {
            ticker: "AAA",
            name: null,
            close: 10,
            declared: [dec],
            upcoming: [dec],
            projected: { ex_date: "2026-11-18", amount: 0.5, basis: "b" },
          },
          {
            ticker: "BBB",
            name: null,
            close: 10,
            declared: [],
            upcoming: [],
            projected: { ex_date: "2026-11-18", amount: 0.2, basis: "b" },
          },
        ],
      },
    });
    expect(ev.map((e) => `${e.ticker}:${e.kind}`)).toEqual(["AAA:declared", "BBB:projected"]);
  });
});
