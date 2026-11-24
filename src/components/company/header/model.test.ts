import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COVERAGE, coverageOf } from "@/lib/coverage";
import type { CompanyDataset, Filing } from "@/lib/financials/types";
import { COMPANY_TABS } from "@/lib/research/site-map";
import type { HqFile } from "@/lib/supply/geo";
import {
  activeTab,
  APP_HEADER_REM,
  awaiting,
  barTopRem,
  changeTone,
  cleanCompanyName,
  edgarUrl,
  exchangeLabel,
  headOffice,
  irUrl,
  isWide,
  landingScrollY,
  latestReports,
  legalNameAdds,
  legalNameLabel,
  marketCap,
  partState,
  priceStatus,
  range52,
  stickyTopRem,
  TAB_GROUPS,
  usableQuote,
  WIDE_ROOM_PX,
} from "./model";

const FIXTURES = ["AAPL", "BAC", "C", "GOOGL", "GS", "JPM", "META", "MS", "MSFT", "NVDA", "WFC"];
const dataset = (t: string) => JSON.parse(readFileSync(`src/test/fixtures/companies/${t}.json`, "utf8")) as CompanyDataset;
const hq = JSON.parse(readFileSync("public/data/hq.json", "utf8")) as HqFile;

describe("company tabs", () => {
  it("offers exactly the pages the assistant's site map lists, under the same labels", () => {
    const mine = TAB_GROUPS.flatMap((g) => g.subs.map((s) => `${s.seg ? `/${s.seg}` : ""}|${s.label}`));
    expect(mine).toEqual(COMPANY_TABS.map((t) => `${t.sub}|${t.label}`));
    expect(new Set(TAB_GROUPS.flatMap((g) => g.subs.map((s) => s.to))).size).toBe(12);
    expect(TAB_GROUPS.map((g) => g.label)).toEqual(["Overview", "Financials", "Valuation", "IR data", "Earnings", "Filings", "Ownership"]);
  });

  it("finds the group and page of an address whatever the ticker's case or a trailing slash", () => {
    expect(activeTab("/app/companies/AAPL").sub.label).toBe("Overview");
    expect(activeTab("/app/companies/AAPL/").group.label).toBe("Overview");
    expect(activeTab("/app/companies/aapl/estimates")).toMatchObject({ group: { label: "Valuation" }, sub: { label: "Estimates & analysts" } });
    expect(activeTab("/app/companies/BRK-B/alt-data").group.label).toBe("Ownership");
    expect(activeTab("/app/companies/JPM/redline/").sub.label).toBe("Filing changes");
    expect(activeTab("/app/companies/JPM/calls?x=1").group.label).toBe("Earnings");
  });

  it("reads the retired memo address as Reports and anything unknown as the Overview", () => {
    expect(activeTab("/app/companies/AAPL/memo").sub.label).toBe("Reports");
    expect(activeTab("/app/companies/AAPL/nothing-here").sub.label).toBe("Overview");
    expect(activeTab("/app/markets").sub.label).toBe("Overview");
  });
});

describe("pinned bar geometry", () => {
  it("sticks under the 56 px app header, lower by the identity row when that sits above the tabs", () => {
    expect(APP_HEADER_REM * 16).toBe(56);
    expect(barTopRem(true) * 16).toBe(56);
    expect(barTopRem(false) * 16).toBe(88);
  });

  it("puts --sticky-top at the bottom edge of the pinned block", () => {
    expect(stickyTopRem(true, false) * 16).toBe(92);
    expect(stickyTopRem(true, true) * 16).toBe(124);
    expect(stickyTopRem(false, false) * 16).toBe(124);
    expect(stickyTopRem(false, true) * 16).toBe(156);
  });

  it("moves the identity beside the tabs only when the row has room for it", () => {
    expect(isWide(1152, 826)).toBe(true);
    expect(isWide(826 + WIDE_ROOM_PX, 826)).toBe(true);
    expect(isWide(826 + WIDE_ROOM_PX - 1, 826)).toBe(false);
    expect(isWide(368, 826)).toBe(false);
    expect(isWide(0, 0)).toBe(false);
  });

  it("never moves the tab strip on a tab change", () => {
    // above the pin point the page stays where it was
    expect(landingScrollY(0, 134)).toBe(0);
    expect(landingScrollY(90, 134)).toBe(90);
    // past it, the new page starts right under the pinned bar
    expect(landingScrollY(134, 134)).toBe(134);
    expect(landingScrollY(4200, 134)).toBe(134);
    expect(landingScrollY(-3, 134)).toBe(0);
  });
});

describe("company names", () => {
  it("drops SEC's state and /NEW tags and nothing else", () => {
    expect(cleanCompanyName("Six Flags Entertainment Corporation/NEW")).toBe("Six Flags Entertainment Corporation");
    expect(cleanCompanyName("Whirlpool Corp /De/")).toBe("Whirlpool Corp");
    expect(cleanCompanyName("MP Materials Corp. / DE")).toBe("MP Materials Corp.");
    expect(cleanCompanyName("Viridian Therapeutics, Inc.\\DE")).toBe("Viridian Therapeutics, Inc.");
    expect(cleanCompanyName("Core Scientific, Inc./tx")).toBe("Core Scientific, Inc.");
    expect(cleanCompanyName("BANK OF AMERICA CORP /DE/")).toBe("BANK OF AMERICA CORP");
    expect(cleanCompanyName("M/I Homes")).toBe("M/I Homes");
    expect(cleanCompanyName("Novo Nordisk A/S")).toBe("Novo Nordisk A/S");
    expect(cleanCompanyName("Telefonaktiebolaget LM Ericsson /ADR/")).toBe("Telefonaktiebolaget LM Ericsson /ADR/");
    expect(cleanCompanyName("  Apple  ")).toBe("Apple");
    expect(cleanCompanyName(null)).toBe("");
  });

  it("leaves no tagged name in the covered universe and only ever removes a tag", () => {
    const changed = COVERAGE.filter((c) => cleanCompanyName(c.shortName) !== c.shortName);
    // The generator strips SEC's state and successor tags at the source now, so the cleaner finds nothing to remove.
    expect(changed.map((c) => c.ticker)).toEqual([]);
    for (const c of changed) {
      const clean = cleanCompanyName(c.shortName);
      expect(c.shortName.startsWith(clean)).toBe(true);
      expect(c.shortName.slice(clean.length)).toMatch(/^\s*[/\\]\s*[A-Za-z]{2,3}\s*[/\\]?$/);
    }
    for (const c of COVERAGE) expect(cleanCompanyName(c.shortName)).not.toMatch(/[/\\]\s*[A-Za-z]{2,3}\s*[/\\]?$/);
  });

  it("keeps a legal name out of the header when it only repeats the display name", () => {
    for (const t of FIXTURES) expect(legalNameAdds(coverageOf(t)!.shortName, dataset(t).profile.name), t).toBe(false);
    expect(legalNameAdds("Coca-Cola", "COCA COLA CO")).toBe(false);
    expect(legalNameAdds("Six Flags Entertainment Corporation", "Six Flags Entertainment Corporation/NEW")).toBe(false);
    expect(legalNameAdds("AT&T", "AT&T INC.")).toBe(false);
    expect(legalNameAdds("Apple", undefined)).toBe(false);
  });

  it("shows a legal name that says more, in readable case", () => {
    expect(legalNameAdds("IBM", "INTERNATIONAL BUSINESS MACHINES CORP")).toBe(true);
    expect(legalNameAdds("GE Aerospace", "GENERAL ELECTRIC CO")).toBe(true);
    expect(legalNameLabel("INTERNATIONAL BUSINESS MACHINES CORP")).toBe("International Business Machines Corp");
    expect(legalNameLabel("PROCTER & GAMBLE Co")).toBe("PROCTER & GAMBLE Co");
    expect(legalNameLabel("U.S. BANCORP \\DE\\")).toBe("U.S. Bancorp");
  });

  it("prints the exchange the same way whichever source names it", () => {
    expect(exchangeLabel("Nasdaq", "NasdaqGS")).toBe("Nasdaq");
    expect(exchangeLabel("", "NasdaqGS")).toBe("Nasdaq");
    expect(exchangeLabel("NYSE", undefined)).toBe("NYSE");
    expect(exchangeLabel(undefined, "NYSEArca")).toBe("NYSE Arca");
    expect(exchangeLabel(null, null)).toBeNull();
    for (const t of FIXTURES) expect(["Nasdaq", "NYSE"]).toContain(exchangeLabel(dataset(t).profile.exchange));
  });
});

describe("head office", () => {
  it("prefers the head-office file, including rows checked against the filing cover page", () => {
    expect(headOffice("AAPL", hq, dataset("AAPL").profile.address)).toEqual({ place: "Cupertino, CA", basis: "SEC business address" });
    // SEC lists Autoliv's U.S. office in Ogden, Utah; the cover page gives Stockholm
    expect(headOffice("alv", hq, { street: "", city: "OGDEN", state: "UT", zip: "" })).toEqual({
      place: "Stockholm, Sweden",
      basis: "checked against the filing cover page",
    });
    expect(headOffice("ACN", hq, null)?.place).toBe("Dublin, Ireland");
  });

  it("falls back to a plain U.S. city and state from the dataset and never guesses a foreign address", () => {
    expect(headOffice("AAPL", null, dataset("AAPL").profile.address)?.place).toBe("Cupertino, CA");
    expect(headOffice("JPM", undefined, dataset("JPM").profile.address)?.place).toBe("New York, NY");
    expect(headOffice("X", null, { street: "", city: "MCLEAN", state: "va", zip: "" })?.place).toBe("McLean, VA");
    expect(headOffice("X", null, { street: "", city: "ST. LOUIS", state: "MO", zip: "" })?.place).toBe("St. Louis, MO");
    expect(headOffice("X", null, { street: "", city: "WINSTON-SALEM", state: "NC", zip: "" })?.place).toBe("Winston-Salem, NC");
    expect(headOffice("X", null, { street: "", city: "DUBLIN 2", state: "L2", zip: "" })).toBeNull();
    expect(headOffice("X", null, { street: "", city: "HAMILTON", state: "D0", zip: "" })).toBeNull();
    expect(headOffice("X", null, { street: "", city: "", state: "CA", zip: "" })).toBeNull();
    expect(headOffice("X", null, undefined)).toBeNull();
  });
});

describe("price status", () => {
  // Friday 20 Nov 2026 in New York (EST, UTC-5)
  const at = (iso: string) => new Date(iso);

  it("calls a price stamped during today's session an as-of price, in New York time", () => {
    const s = priceStatus({ marketTime: "2026-11-20T19:31:00Z" }, at("2026-11-20T19:33:00Z"));
    expect(s).toMatchObject({ kind: "intraday", label: "As of 2:31 PM ET · delayed", stale: false });
  });

  it("calls a price stamped at 4 p.m. or on an earlier day a close, with its date", () => {
    expect(priceStatus({ marketTime: "2026-11-20T21:00:01Z" }, at("2026-11-20T22:15:00Z"))).toMatchObject({ kind: "close", label: "At close · Nov 20", stale: false });
    // over the weekend and into Monday morning before the open
    expect(priceStatus({ marketTime: "2026-11-20T21:00:00Z" }, at("2026-11-23T13:00:00Z"))).toMatchObject({ kind: "close", label: "At close · Nov 20", stale: false });
    // an early close stays an as-of price until the day is over, then reads as that day's close
    expect(priceStatus({ marketTime: "2026-11-27T18:00:00Z" }, at("2026-11-27T20:00:00Z")).label).toBe("As of 1:00 PM ET · delayed");
    expect(priceStatus({ marketTime: "2026-11-27T18:00:00Z" }, at("2026-11-28T15:00:00Z")).label).toBe("At close · Nov 27");
  });

  it("uses New York's calendar day, not the reader's or UTC's", () => {
    // 00:30 UTC on the 21st is still the evening of the 20th in New York
    expect(priceStatus({ marketTime: "2026-11-20T21:00:00Z" }, at("2026-11-21T00:30:00Z")).label).toBe("At close · Nov 20");
    // summer time: 15:59 EDT is 19:59 UTC
    expect(priceStatus({ marketTime: "2026-07-01T19:59:00Z" }, at("2026-07-01T20:05:00Z")).label).toBe("As of 3:59 PM ET · delayed");
    expect(priceStatus({ marketTime: "2026-07-01T20:00:00Z" }, at("2026-07-01T20:05:00Z")).label).toBe("At close · Jul 1");
  });

  it("says so when the price is the stored close, and flags one older than a long weekend", () => {
    expect(priceStatus({ snapshot: true, marketTime: "2026-11-20" }, at("2026-11-23T15:00:00Z"))).toMatchObject({ kind: "stored", label: "Last stored close · Nov 20", stale: false });
    expect(priceStatus({ snapshot: true, marketTime: "2026-11-02" }, at("2026-11-23T15:00:00Z"))).toMatchObject({ kind: "stored", label: "Last stored close · Nov 2", stale: true });
    expect(priceStatus({ snapshot: true }, at("2026-11-23T15:00:00Z"))).toMatchObject({ label: "Last stored close", stale: true });
  });

  it("adds the year when the price is from another year and claims nothing without a time", () => {
    expect(priceStatus({ marketTime: "2025-12-31T21:00:00Z" }, at("2026-01-02T14:00:00Z")).label).toBe("At close · Dec 31, 2025");
    expect(priceStatus({}, at("2026-11-23T15:00:00Z"))).toMatchObject({ kind: "quote", label: "Delayed quote", stale: false });
    expect(priceStatus({ marketTime: "not a date" }, at("2026-11-23T15:00:00Z")).kind).toBe("quote");
  });
});

describe("price facts", () => {
  it("places the last price inside the 52-week range", () => {
    expect(range52(338.32, 243.42, 351.73)).toEqual({ low: 243.42, high: 351.73, position: (338.32 - 243.42) / (351.73 - 243.42) });
    expect(range52(100, 100, 200)?.position).toBe(0);
    expect(range52(200, 100, 200)?.position).toBe(1);
  });

  it("widens the range when the last price is itself a new extreme", () => {
    expect(range52(25.83, 26.4, 65.45)).toMatchObject({ low: 25.83, high: 65.45, position: 0 });
    expect(range52(70, 26.4, 65.45)).toMatchObject({ low: 26.4, high: 70, position: 1 });
  });

  it("shows no range without both bounds and a price", () => {
    expect(range52(100, undefined, 200)).toBeNull();
    expect(range52(100, 90, null)).toBeNull();
    expect(range52(null, 90, 110)).toBeNull();
    expect(range52(100, 100, 100)).toBeNull();
    expect(range52(100, 120, 90)).toBeNull();
    expect(range52(100, Number.NaN, 110)).toBeNull();
  });

  it("multiplies the last price by the cover-page share count", () => {
    const p = dataset("AAPL").profile;
    expect(p.sharesOutstanding).toBe(14594180000);
    expect(marketCap(338.32, p.sharesOutstanding)).toBeCloseTo(4.9375e12, -9);
    expect(marketCap(338.32, null)).toBeNull();
    expect(marketCap(undefined, 1e9)).toBeNull();
    expect(marketCap(0, 1e9)).toBeNull();
  });

  it("colours a change by its sign and leaves a change that prints as 0.00 neutral", () => {
    expect(changeTone(1.35)).toBe("positive");
    expect(changeTone(-6.31)).toBe("negative");
    expect(changeTone(0)).toBe("flat");
    expect(changeTone(0.004)).toBe("flat");
    expect(changeTone(-0.004)).toBe("flat");
    expect(changeTone(undefined)).toBe("flat");
  });
});

describe("late arrivals", () => {
  const quote = (have: boolean, pending: boolean) => partState(have, pending);
  it("holds the place of a figure only while every missing input can still arrive", () => {
    // market cap = last price x cover-page shares: quote and dataset both on their way
    expect(awaiting(null, [quote(false, true), partState(false, true)])).toBe(true);
    // quote in, dataset still loading: the cap keeps its place beside the 52-week range
    expect(awaiting(null, [quote(true, false), partState(false, true)])).toBe(true);
    // the dataset answered without a share count: the cap cannot arrive, so no gap is left for it
    expect(awaiting(null, [quote(false, true), partState(false, false)])).toBe(false);
    // no quote and none coming (the request failed and no close is stored)
    expect(awaiting(null, [quote(false, false), partState(true, false)])).toBe(false);
  });
  it("never holds a place for a figure that is there, or once nothing is pending", () => {
    expect(awaiting(4.94e12, [quote(true, false), partState(true, false)])).toBe(false);
    expect(awaiting(4.94e12, [quote(true, false), partState(false, true)])).toBe(false);
    // both inputs in and still no value (a zero share count): it will not arrive, so no skeleton stays behind
    expect(awaiting(marketCap(338.32, 0), [quote(true, false), partState(true, false)])).toBe(false);
    // the 52-week range comes with the quote itself: a stored close has none
    expect(awaiting(range52(338.32, undefined, undefined), [quote(true, false)])).toBe(false);
    expect(awaiting(range52(undefined, undefined, undefined), [quote(false, true)])).toBe(true);
  });
  it("reads an input as ready before pending, and missing only when nothing is on its way", () => {
    expect(partState(true, true)).toBe("ready");
    expect(partState(false, true)).toBe("pending");
    expect(partState(false, false)).toBe("missing");
  });
});

describe("filings and links", () => {
  it("finds the newest annual and quarterly report in real filing lists", () => {
    for (const t of FIXTURES) {
      const filings = dataset(t).filings;
      const { annual, quarterly } = latestReports(filings);
      expect(annual?.form, t).toBe("10-K");
      expect(quarterly?.form, t).toBe("10-Q");
      expect(filings.filter((f) => f.form === "10-K").every((f) => f.filed <= annual!.filed), t).toBe(true);
      expect(filings.filter((f) => f.form === "10-Q").every((f) => f.filed <= quarterly!.filed), t).toBe(true);
    }
  });

  it("skips amendments, takes a foreign filer's 20-F as the annual report, and copes with nothing on file", () => {
    const f = (form: string, filed: string): Filing => ({ accn: `${form}-${filed}`, form, filed, doc: "d.htm" }) as Filing;
    const list = [f("10-K/A", "2026-03-01"), f("10-K", "2026-02-01"), f("10-Q/A", "2026-09-01"), f("10-Q", "2026-08-01"), f("10-Q", "2026-05-01")];
    expect(latestReports(list).annual?.filed).toBe("2026-02-01");
    expect(latestReports(list).quarterly?.filed).toBe("2026-08-01");
    expect(latestReports([f("20-F", "2026-04-01"), f("6-K", "2026-08-01")])).toMatchObject({ annual: { form: "20-F" }, quarterly: null });
    expect(latestReports(undefined)).toEqual({ annual: null, quarterly: null });
  });

  it("links EDGAR by CIK and the IR site only when the address is a real one", () => {
    expect(edgarUrl("0000320193")).toContain("CIK=0000320193&");
    expect(edgarUrl(320193)).toContain("CIK=320193&");
    expect(irUrl({ investorRelations: "https://investor.apple.com" })).toBe("https://investor.apple.com");
    expect(irUrl({ investorRelations: "" })).toBeNull();
    expect(irUrl({ investorRelations: "investor.apple.com" })).toBeNull();
    expect(irUrl({ investorRelations: "javascript:alert(1)" })).toBeNull();
    expect(irUrl(undefined)).toBeNull();
    for (const t of FIXTURES) expect(irUrl(dataset(t).profile), t).toMatch(/^https:\/\//);
  });
});

describe("a quote whose price is not a price (review M4: HCC printed $0.00 0.00 (0.00%))", () => {
  const q = (price: number) => ({ price, change: 0, changePct: 0 });
  it("is no quote when the price is zero, negative or not a number", () => {
    for (const p of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(usableQuote(q(p))).toBeUndefined();
    expect(usableQuote(undefined)).toBeUndefined();
    expect(usableQuote(null)).toBeUndefined();
  });
  it("keeps a real quote as it is", () => {
    const real = q(104.5);
    expect(usableQuote(real)).toBe(real);
  });
});
