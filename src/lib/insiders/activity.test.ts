import { describe, expect, it } from "vitest";
import type { InsiderTrade } from "@/lib/financials/types";
import { buyClusters, filterTrades, fmtUsdShort, lanes, marketTrades, summarize, tidyRole, toMs, tradeMarks } from "./activity";

const t = (owner: string, date: string, code: string, shares: number, price: number | null, plan = false, role = "Director"): InsiderTrade => ({
  accn: `0001-${owner}-${date}`, filed: date, owner, role, date, code, security: "Common Stock", shares, price, acquired: code === "P", ownedAfter: null, direct: true, plan10b5: plan, doc: "form4.xml",
});

const RAW = [
  t("Ann Lee", "2026-02-09", "P", 1000, 50, false, "CEO"),
  t("Bo Diaz", "2026-02-10", "P", 400, 50, false, "CFO"),
  t("Cy Park", "2026-02-20", "P", 100, 50),
  t("Dee Wu", "2026-01-05", "S", 2000, 60, true, "Chief HR Officer"),
  t("Dee Wu", "2026-03-05", "S", 1000, 55, true, "Chief HR Officer"),
  t("Eli Roy", "2026-03-17", "S", 1000, 54),
  t("Ann Lee", "2026-02-09", "A", 5000, null),
  t("Ann Lee", "2026-02-11", "F", 300, 51),
];
const all = marketTrades(RAW);
const from = toMs("2026-01-01"), to = toMs("2026-12-31");

describe("insider activity", () => {
  it("keeps only priced open-market trades, oldest first", () => {
    expect(all).toHaveLength(6);
    expect(all[0].owner).toBe("Dee Wu");
    expect(all.find((x) => x.owner === "Ann Lee")).toMatchObject({ buy: true, value: 50_000, plan: false });
  });

  it("totals a range and separates sales made by choice", () => {
    const s = summarize(all, from, to);
    expect(s).toMatchObject({ bought: 75_000, sold: 229_000, soldByDecision: 54_000, net: -154_000, buyers: 3, sellers: 2, buys: 3, sells: 3 });
    expect(summarize(all, toMs("2026-02-01"), toMs("2026-02-28"))).toMatchObject({ bought: 75_000, sold: 0, net: 75_000 });
  });

  it("filters by side and hides pre-scheduled trades", () => {
    expect(filterTrades(all, "sell", false)).toHaveLength(3);
    expect(filterTrades(all, "sell", true).map((x) => x.owner)).toEqual(["Eli Roy"]);
    expect(filterTrades(all, "buy", true)).toHaveLength(3);
  });

  it("builds one lane per insider, net buyers first", () => {
    const l = lanes(all, from, to);
    expect(l.map((x) => x.owner)).toEqual(["Ann Lee", "Bo Diaz", "Cy Park", "Eli Roy", "Dee Wu"]);
    expect(l[4]).toMatchObject({ net: -175_000, volume: 175_000, role: "Chief HR Officer" });
    expect(lanes(all, toMs("2026-03-01"), to).map((x) => x.owner)).toEqual(["Eli Roy", "Dee Wu"]);
  });

  it("finds a cluster of three buyers and ignores pre-scheduled trades", () => {
    const c = buyClusters(all);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ from: toMs("2026-02-09"), to: toMs("2026-02-20"), value: 75_000 });
    expect(c[0].people).toEqual(["Ann Lee", "Bo Diaz", "Cy Park"]);
    expect(buyClusters(all, 5)).toHaveLength(0);
    expect(buyClusters(marketTrades(RAW.map((r) => ({ ...r, plan10b5: true }))))).toHaveLength(0);
  });

  it("merges same-day trades on one side into a single chart marker", () => {
    const marks = tradeMarks(marketTrades([...RAW, t("Bo Diaz", "2026-02-09", "P", 600, 50)]));
    const feb9 = marks.find((m) => m.at === toMs("2026-02-09"));
    expect(feb9).toMatchObject({ label: "Buy $80K", description: "2 insiders bought $80K" });
    expect(marks.find((m) => m.at === toMs("2026-01-05"))?.description).toBe("Dee Wu sold $120K under a pre-scheduled plan");
  });

  it("tidies titles and never prints $1000K", () => {
    expect(tidyRole("PRESIDENT &amp; CEO, Director")).toBe("President & CEO, Director");
    expect(tidyRole("EVP: CHIEF OPERATING OFFICER")).toBe("EVP: Chief Operating Officer");
    expect(tidyRole("Chief Financial Officer")).toBe("Chief Financial Officer");
    expect(fmtUsdShort(999_994)).toBe("$1.0M");
    expect(fmtUsdShort(249_100)).toBe("$249K");
  });
});
