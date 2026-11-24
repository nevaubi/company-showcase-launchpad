import { describe, expect, it } from "vitest";
import { buildEvidence } from "./evidence";
import { evidenceLine, liveLine, luckLines, recordLine, verdictLine } from "./explain";
import { count, dayLong, dayShort, holdLabel, monthLabel, nameOf, niceTicks, num, pct, pctTone, price, tidyDetail, usdCompact } from "./format";
import { DEFAULT_FILTERS } from "./rank";
import { defaultView, filtersActive, filtersOf, searchOf, setupsSearch } from "./url-state";
import { realVariants } from "./variants-real.fixture";

describe("figures as the pages print them", () => {
  it("uses a true minus, a sign only where asked, and an en dash for missing", () => {
    expect(pct(0.0067)).toBe("+0.67%");
    expect(pct(-0.0032)).toBe("−0.32%");
    expect(pct(0.5479, 0, false)).toBe("55%");
    expect(pct(-0.103, 1, false)).toBe("−10.3%");
    // A loss too small to show is not printed as a negative zero.
    expect(pct(-0.00001)).toBe("0.00%");
    // And it takes no colour: the colour follows the sign that is printed.
    expect(pctTone(-0.00001)).toBe("");
    expect(pctTone(-0.0032)).toBe("text-negative");
    expect(pctTone(0.0067)).toBe("text-positive");
    expect(pctTone(0.004, 0)).toBe("");
    expect(pctTone(null)).toBe("");
    expect(pct(null)).toBe("–");
    expect(num(-0.03)).toBe("−0.03");
    expect(num(1.966, 2)).toBe("1.97");
    expect(num(NaN)).toBe("–");
    expect(count(28276)).toBe("28,276");
  });

  it("keeps the last digit of a penny stock and compacts dollar volume", () => {
    expect(price(170.03)).toBe("$170.03");
    expect(price(1210.5)).toBe("$1,210.50");
    expect(price(0.815)).toBe("$0.815");
    expect(price(undefined)).toBe("–");
    expect(usdCompact(44_654_400)).toBe("$45M");
    expect(usdCompact(12_559_800_000)).toBe("$13B");
    expect(usdCompact(2_300_000_000)).toBe("$2.3B");
  });

  it("writes dates and holds the way the rest of the app does", () => {
    expect(dayShort("2026-11-20")).toBe("Nov 20");
    expect(dayLong("2026-11-20")).toBe("Nov 20, 2026");
    expect(monthLabel("2022-01")).toBe("Jan 2022");
    expect([holdLabel(1), holdLabel(5), holdLabel(10), holdLabel(21), holdLabel(40)]).toEqual(["1 day", "5 days", "10 days", "4 weeks", "8 weeks"]);
  });

  it("gives stored signal text a true minus without touching hyphens inside words", () => {
    expect(tidyDetail("3.9x normal volume, price -0.2%")).toBe("3.9x normal volume, price −0.2%");
    expect(tidyDetail("-4.0 standard deviations vs its sector over 5 days")).toBe("−4.0 standard deviations vs its sector over 5 days");
    expect(tidyDetail("12-1 momentum near a 52-week high (-3.1)")).toBe("12-1 momentum near a 52-week high (−3.1)");
  });

  it("drops a company name that only repeats the symbol", () => {
    expect(nameOf("UPS")).toBeUndefined();
    expect(nameOf("SCHW")).toBe("Charles Schwab");
    expect(nameOf("NOT_A_TICKER")).toBeUndefined();
  });

  it("picks round axis ticks that include zero when the range spans it", () => {
    expect(niceTicks(0, 0.42)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(niceTicks(-0.13, 0.08)).toEqual([-0.1, -0.05, 0, 0.05]);
    expect(niceTicks(0, 1.9)).toEqual([0, 0.5, 1, 1.5]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });
});

describe("the evidence in words, on the production record of 20 Nov 2026", () => {
  const book = buildEvidence(realVariants(), "Down, stressed", "2026-11-20");

  it("states the verdict with the numbers behind it", () => {
    expect(verdictLine(book)).toBe(
      "No rule clears the bar today. The best of 46 scores t 1.97 on its monthly record since 2022. Luck alone would put the best of 46 worthless rules near 2.24, and a rule has to reach 2.98 to stand out.",
    );
    const luck = luckLines(book);
    expect(luck).toHaveLength(3);
    expect(luck[0]).toContain("46 rules are tried");
    expect(luck[2]).toBe("Today the best rule scores 1.97, and 3 rules beat 1.65 where luck alone gives 2.3. That is what luck looks like, so nothing is listed.");
  });

  it("says why a rule is not listed, without calling a backtest proven", () => {
    const vol = book.byKey.get("volPremium:L:20")!;
    expect(recordLine(vol)).toBe("+0.67% a trade after costs since 2022, 33 of 58 months up, t 1.88");
    expect(evidenceLine(vol, book.discovery)).toBe(`${recordLine(vol)}. Not past the bar: with 46 rules tried, the best needs t 2.98 before it stands out from luck.`);
    expect(evidenceLine(book.byKey.get("shortFlow:S:5")!, book.discovery)).toBe("Does not make money after costs since 2022: −0.32% a trade, t −3.95.");
    for (const e of book.variants) expect(evidenceLine(e, book.discovery)).not.toMatch(/proven|Passes/);
  });

  it("says a live record of one holding period is too short to judge", () => {
    // Without the day breakdown nothing is judged.
    expect(liveLine(book.byKey.get("rsi2:L:3")!.live)).toBe("190 finished live trades since Nov 16: +1.37% a trade, 66% up. Not judged: the live trades by day did not load.");
    const days = new Map([["rsi2:L:3", [{ date: "2026-11-16", n: 120, mean: 0.01 }, { date: "2026-11-17", n: 70, mean: 0.02 }]]]);
    const withDays = buildEvidence(realVariants(), "Up, calm", "2026-11-20", days);
    expect(liveLine(withDays.byKey.get("rsi2:L:3")!.live)).toBe("190 finished live trades since Nov 16: +1.37% a trade, 66% up. Too short to judge: 2 signal days in 1 independent holding period, 6 periods needed.");
    expect(liveLine(book.byKey.get("volPremium:L:20")!.live)).toBe("No finished live trades yet.");
  });

  it("names a rule whose live trades are another rule's, so one record is not read as two", () => {
    expect(liveLine(book.byKey.get("rsi2:L:3")!.live, ["residual:L:5"])).toMatch(/^190 finished live trades since Nov 16 \(the same trades as residual:L:5: one record, not 2\): /);
  });

  it("counts listed rules when there are some", () => {
    const d = { ...book.discovery, proven: 1, candidates: 2, watch: 1, probation: 1 };
    expect(verdictLine({ discovery: d })).toBe("4 of 46 rules clear the bar today (1 proven, 2 candidates, 1 on watch). 1 on probation.");
    expect(verdictLine({ discovery: { ...book.discovery, candidates: 1 } })).toBe("1 of 46 rules clears the bar today (1 candidate).");
  });
});

describe("the address of the setups page", () => {
  it("falls back to the defaults on missing or unknown values instead of failing", () => {
    const s = setupsSearch.parse({ view: "everything", side: "long", hold: "decade", family: "pairs", liq: "100", sector: "Energy" });
    expect(s).toEqual({ view: undefined, side: "long", hold: undefined, family: undefined, liq: 100, sector: "Energy" });
    expect(filtersOf(s, ["Energy", "Utilities"])).toEqual({ ...DEFAULT_FILTERS, side: "long", sector: "Energy", minDollarVolume: 1e8 });
    // A sector no live signal has, or a floor that is not offered, is ignored.
    expect(filtersOf({ sector: "Atlantis", liq: 37 }, ["Energy"])).toEqual(DEFAULT_FILTERS);
    expect(filtersOf({})).toEqual(DEFAULT_FILTERS);
  });

  it("round-trips filters and leaves defaults out of the address", () => {
    const f = { side: "short", hold: "week", family: "events", sector: "Health Care", minDollarVolume: 5e8 } as const;
    expect(filtersOf(setupsSearch.parse(searchOf(f)), ["Health Care"])).toEqual(f);
    expect(searchOf(DEFAULT_FILTERS)).toEqual({ side: undefined, hold: undefined, family: undefined, sector: undefined, liq: undefined });
    expect(filtersActive(DEFAULT_FILTERS)).toBe(false);
    expect(filtersActive({ ...DEFAULT_FILTERS, minDollarVolume: 5e6 })).toBe(true);
  });

  it("opens on the short list, or on the closest rules when the short list is empty", () => {
    expect(defaultView(3)).toBe("short");
    expect(defaultView(0)).toBe("closest");
  });
});
