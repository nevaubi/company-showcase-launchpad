import { describe, expect, it } from "vitest";
import type { InsiderTrade } from "@/lib/financials/types";
import { insiderWindow, insiderWindowLabel } from "./window";

const trade = (date: string, code: string, shares: number, price: number | null, accn = `a-${date}`): InsiderTrade => ({
  accn, filed: date, owner: "A Director", role: "Director", date, code, security: "Common Stock", shares, price, acquired: code === "P", ownedAfter: null, direct: true, plan10b5: false, doc: "f4.xml",
});
const today = new Date("2026-11-12T12:00:00Z");

describe("insiderWindow", () => {
  const trades = [
    trade("2026-11-01", "S", 1000, 200),
    trade("2026-09-01", "S", 500, 100),
    trade("2026-08-20", "P", 10, 50),
    trade("2026-08-01", "S", 9000, 300), // before the 90-day window
    trade("2026-10-10", "G", 500000, null), // a gift is not an open-market trade
    trade("2026-10-11", "M", 7000, 10),
  ];

  it("counts only open-market sales and purchases inside the window", () => {
    const w = insiderWindow(trades, today);
    expect(w.since).toBe("2026-08-14");
    expect(w.sold).toBe(250_000);
    expect(w.bought).toBe(500);
    expect(w.sales).toBe(2);
    expect(w.buys).toBe(1);
    expect(w.filings).toBe(5);
    expect(w.complete).toBe(true);
  });

  it("says when the stored trades do not reach back the full window", () => {
    const w = insiderWindow(trades.filter((t) => t.date >= "2026-09-01"), today);
    expect(w.complete).toBe(false);
    expect(w.from).toBe("2026-09-01");
    expect(insiderWindowLabel(w, (d) => d)).toBe("Open-market trades since 2026-09-01");
    expect(insiderWindowLabel(insiderWindow(trades, today), (d) => d)).toBe("Open-market trades, last 90 days");
  });

  it("is all zeros with no trades", () => {
    const w = insiderWindow([], today);
    expect([w.sold, w.bought, w.sales, w.buys, w.filings]).toEqual([0, 0, 0, 0, 0]);
    expect(w.complete).toBe(false);
  });
});
