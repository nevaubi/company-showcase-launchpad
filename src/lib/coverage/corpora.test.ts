import { describe, expect, it } from "vitest";
import { CORPORA, CORPUS, CORPUS_IDS, HEADLINES, NO_MEASURE, STATE_CODE, STATE_OF_CODE, corpusOf, day, daysBetween, emptyHeadlines, emptyNote, judge, tally, type Ctx, type Measure } from "./corpora";
import { LANES } from "@/lib/jobs/lanes";

const TODAY = "2026-11-27";
const ctx: Ctx = { today: TODAY, filingsFrom: "2026-09-21", held: new Map() };
const co = { ticker: "ACME", sector: "Industrials", industry: "Machinery" };
const bank = { ticker: "BNK", sector: "Financials", industry: "Regional Banks" };
const m = (n: number, d: string | null = null, x: Record<string, unknown> = {}): Measure => ({ n, d, x });
/** The verdict of one corpus for the ordinary company. */
const run = (id: string, measure: Measure | undefined, c = co, on: Ctx = ctx) => {
  const def = corpusOf(id);
  if (!def) throw new Error(`no corpus ${id}`);
  return judge(def, measure, c, on);
};

describe("the corpus list", () => {
  it("has unique ids, a rule each, and names only lanes that exist", () => {
    expect(new Set(CORPUS_IDS).size).toBe(CORPORA.length);
    const lanes = new Set(LANES.map((l) => l.id));
    for (const c of CORPORA) for (const l of c.lanes) expect(lanes.has(l), `${c.id} names lane ${l}`).toBe(true);
  });
  it("gives every company a row for every corpus, also when nothing was measured", () => {
    for (const c of CORPORA) {
      const row = judge(c, undefined, co, ctx);
      expect(["none", "not_applicable"], c.id).toContain(row.state);
      expect(row.items).toBe(0);
      expect(row.why.length, c.id).toBeGreaterThan(20);
      expect(row.why.endsWith("."), c.id).toBe(true);
    }
  });
  it("names every corpus once for the pages", () => {
    expect(Object.values(CORPUS).sort()).toEqual([...CORPUS_IDS].sort());
  });
  it("state letters round-trip", () => {
    for (const [state, code] of Object.entries(STATE_CODE)) expect(STATE_OF_CODE[code]).toBe(state);
  });
  it("writes dates in words and counts days", () => {
    expect(day("2026-11-27")).toBe("27 Nov 2026");
    expect(day("2026-01-05T10:00:00Z")).toBe("5 Jan 2026");
    expect(day(null)).toBe("");
    expect(daysBetween("2026-11-20", "2026-11-27")).toBe(7);
    expect(daysBetween(null, "2026-11-27")).toBeNull();
  });
});

describe("statements", () => {
  it("lists only the empty headline values that apply to the company", () => {
    const filled = Object.fromEntries(HEADLINES.map((h) => [h.id, 1]));
    expect(emptyHeadlines(filled, co)).toEqual([]);
    expect(emptyHeadlines({ ...filled, mcap: null, om: null }, co)).toEqual(["market cap", "operating margin"]);
    // Meta on 27 Nov 2026: no revenue for the trailing four quarters, so three values are empty
    expect(emptyHeadlines({ lq_end: "2026-09-30", mcap: 1.559e12, ps: null, nm: null, roa: 0.1923, om: null }, { ticker: "META", sector: "Communication Services", industry: "Interactive Media & Services" })).toEqual(["price to sales", "net margin", "operating margin"]);
    // values that are empty by their own definition are never listed
    expect(emptyHeadlines({ ...filled, gm: null, current_ratio: null, ev: null, net_debt: null, pe: null, roe: null }, co)).toEqual([]);
    // a bank, an insurer, a real estate trust and a payment network print no operating income line
    const noOm = { lq_end: "2026-09-30", mcap: 1, ps: 1, nm: 1, roa: 1, om: null };
    expect(emptyHeadlines(noOm, bank)).toEqual([]);
    expect(emptyHeadlines(noOm, { ticker: "R", sector: "Real Estate", industry: "Retail REITs" })).toEqual([]);
    expect(emptyHeadlines(noOm, { ticker: "V", sector: "Financials", industry: "Transaction & Payment Processing Services" })).toEqual([]);
    expect(emptyHeadlines({ ...noOm, mcap: null }, bank)).toEqual(["market cap"]);
  });
  it("is complete only when every applicable headline value is filled", () => {
    expect(run("statements", m(1, "2026-11-13", { row: true, lq_end: "2026-09-30", empty: [] }))).toMatchObject({ state: "full" });
    const partial = run("statements", m(1, "2026-11-13", { row: true, lq_end: "2026-09-30", empty: ["market cap", "net margin"] }));
    expect(partial.state).toBe("partial");
    expect(partial.why).toBe("Statements are stored through the quarter ended 30 Sep 2026; empty headline values: market cap, net margin.");
    expect(run("statements", m(1, "2026-11-13", { row: false })).state).toBe("partial");
    expect(run("statements", m(0)).state).toBe("none");
  });
});

describe("dated feeds", () => {
  it("SEC filing index: complete while the newest filing is within a quarter", () => {
    expect(run("filings", m(40, "2026-11-20")).state).toBe("full");
    expect(run("filings", m(40, "2026-08-19")).state).toBe("full"); // 100 days before 27 Nov: the limit
    expect(run("filings", m(40, "2026-08-19")).why).toContain("kept from 21 Sep 2026");
    expect(run("filings", m(3, "2026-08-18")).state).toBe("partial"); // 101 days
    expect(run("filings", m(0)).state).toBe("none");
  });
  it("earnings releases: one every quarter", () => {
    expect(run("releases", m(80, "2026-10-28")).state).toBe("full");
    expect(run("releases", m(80, "2026-07-15")).state).toBe("full"); // 135 days before 27 Nov: the limit
    expect(run("releases", m(80, "2026-07-14")).state).toBe("partial"); // 136 days
    expect(run("releases", m(0)).state).toBe("none");
  });
  it("estimates and options: refreshed within a week", () => {
    expect(run("estimates", m(1, "2026-11-26")).state).toBe("full");
    expect(run("estimates", m(1, "2026-11-19")).state).toBe("partial");
    expect(run("estimates", m(0)).why).toContain("not recorded whether any analyst covers");
    expect(run("estimates", m(0, null, { none_at: "2026-11-20" }))).toMatchObject({ state: "not_applicable", why: "The estimates provider listed no analyst coverage for this company when last asked (20 Nov 2026)." });
    expect(run("options", m(30, "2026-11-25")).state).toBe("full");
    // the state on 27 Nov 2026: the last stored day is 19 Nov
    expect(run("options", m(30, "2026-11-19"))).toMatchObject({ state: "partial", why: "30 trading days stored; the newest is 19 Nov 2026." });
    expect(run("options", m(0)).state).toBe("none");
    expect(run("options", m(0, null, { none_at: "2026-11-27" }))).toMatchObject({ state: "not_applicable", why: "The source listed no options for this company when last looked (27 Nov 2026)." });
    // options were listed since: the stored days stand
    expect(run("options", m(4, "2026-11-25", { none_at: "2026-10-01" })).state).toBe("full");
  });
  it("prices: the newest official bar within a long weekend", () => {
    expect(run("prices", m(40, "2026-11-25", { file: true })).state).toBe("full");
    expect(run("prices", m(40, "2026-11-20", { file: true })).state).toBe("partial");
    expect(run("prices", m(0, null, { file: true })).state).toBe("partial");
    expect(run("prices", m(0)).state).toBe("none");
  });
});

describe("filing-derived corpora", () => {
  it("filing changes: behind when a newer report is indexed", () => {
    expect(run("redlines", m(2, "2026-11-04", { report: "2026-11-04" })).state).toBe("full");
    expect(run("redlines", m(2, "2026-08-05", { report: "2026-11-04" }))).toMatchObject({ state: "partial", why: "Changes are compared through the filing of 5 Aug 2026; a newer report was filed on 4 Nov 2026." });
    expect(run("redlines", m(2, "2026-08-05")).state).toBe("full"); // no report in the index to be behind
    expect(run("redlines", m(0, null, { report: "2026-11-04" })).state).toBe("none");
  });
  it("insider trades: tells unread filings from filings that report nothing", () => {
    expect(run("insiders", m(120, "2026-11-20", { indexed: 9, read: 9, since: "2022-10-03" }))).toMatchObject({ state: "full", why: "120 transactions stored since 3 Oct 2022; every indexed Form 4 is read." });
    expect(run("insiders", m(120, "2026-11-20", { indexed: 9, read: 7 })).state).toBe("partial");
    // read, and they hold no share transaction (derivative-only filings): looked, none
    expect(run("insiders", m(0, null, { indexed: 2, read: 2 }))).toMatchObject({ state: "full", items: 0 });
    expect(run("insiders", m(0, null, { indexed: 2, read: 0 }))).toMatchObject({ state: "none", why: "2 Form 4 filings of this company are indexed and not read yet." });
    expect(run("insiders", m(0)).why).toContain("Earlier filings were not collected");
  });
  it("filing detail and tagged shares: a read that found nothing is complete", () => {
    expect(run("filing_detail", m(1, "2026-11-16")).state).toBe("full");
    expect(run("filing_detail", m(0)).state).toBe("none");
    expect(run("concentration", m(6, "2026-10-30", { file: true })).state).toBe("full");
    expect(run("concentration", m(0, null, { file: true }))).toMatchObject({ state: "full", items: 0 });
    expect(run("concentration", m(0)).state).toBe("none");
  });
});

describe("supply chain", () => {
  it("supply links: nothing stored is `none` until a read is on record", () => {
    expect(run("supply_links", m(0))).toMatchObject({ state: "none", why: "No filing of this company has been read for supply links yet." });
    expect(run("supply_links", m(0, null, { scan_filed: "2026-02-20", scan_at: "2026-11-27", scan_form: "10-K", scan_links: 0 }))).toMatchObject({
      state: "full",
      why: "The 10-K filed 20 Feb 2026 was read on 27 Nov 2026: it names no customer, supplier or partner.",
    });
    // Abbott on 27 Nov 2026: two links from its 2024 10-K, none current, and no receipt for a newer read
    expect(run("supply_links", m(0, null, { history: 2, history_newest: "2024-02-16", scan_filed: "2024-02-16", scan_links: 2 }))).toMatchObject({
      state: "partial",
      why: "No current link: the 2 stored links come from older filings (newest filed 16 Feb 2024).",
    });
    // a newer 10-K read since, naming nobody: complete, with the history mentioned
    expect(run("supply_links", m(0, null, { history: 2, history_newest: "2024-02-16", scan_filed: "2026-02-20", scan_links: 0 })).why).toBe(
      "The 10-K filed 20 Feb 2026 was read: it names no customer, supplier or partner. 2 links from older filings are kept as history.",
    );
  });
  it("supply links: behind when a newer 10-K is indexed and not read", () => {
    expect(run("supply_links", m(14, "2026-02-20", { annual: "2026-02-20" })).state).toBe("full");
    expect(run("supply_links", m(14, "2025-02-21", { annual: "2026-02-20" }))).toMatchObject({ state: "partial", why: "14 current links from filings through 21 Feb 2025; the 10-K filed 20 Feb 2026 is not read yet." });
    // the newer 10-K was read and added nothing: the links stand
    expect(run("supply_links", m(14, "2025-02-21", { annual: "2026-02-20", scan_filed: "2026-02-20" })).state).toBe("full");
  });
  it("supply intelligence: re-read within six weeks", () => {
    expect(run("supply_intel", m(40, "2026-11-01")).state).toBe("full");
    expect(run("supply_intel", m(40, "2026-10-01")).state).toBe("partial");
    expect(run("supply_intel", m(0)).state).toBe("none");
  });
});

describe("investor relations", () => {
  it("IR documents: stored, dated and recent", () => {
    expect(run("ir_documents", m(300, "2026-10-29", { undated: 12 }))).toMatchObject({ state: "full", why: "300 documents stored; newest dated 29 Oct 2026. 12 of them have no date." });
    expect(run("ir_documents", m(300, "2026-05-01")).state).toBe("partial");
    expect(run("ir_documents", m(4, null, { undated: 4 }))).toMatchObject({ state: "partial", why: "4 documents stored, none with a date." });
    expect(run("ir_documents", m(0)).state).toBe("none");
  });
  it("IR figures: read through, built and current", () => {
    expect(run("ir_figures", m(18_400, "2026-09-30", { built: "2026-11-20" })).state).toBe("full");
    expect(run("ir_figures", m(150, "2026-09-30", { built: "2026-11-20" }))).toMatchObject({ state: "partial", why: "150 figures read so far; the documents are not read through yet." });
    expect(run("ir_figures", m(18_400, "2026-09-30", {})).why).toContain("not built yet");
    expect(run("ir_figures", m(18_400, "2025-12-31", { built: "2026-11-20" })).why).toContain("newer quarters are not read yet");
    expect(run("ir_figures", m(0)).why).toBe("No figures have been read from this company's documents yet.");
  });
});

describe("calls", () => {
  it("call transcripts: the last eight quarters", () => {
    expect(run("calls", m(21, "2026-10-28", { recent: 9 }))).toMatchObject({ state: "full", why: "21 calls stored; each of the last eight quarters has one (newest 28 Oct 2026)." });
    expect(run("calls", m(5, "2026-10-28", { recent: 5 }))).toMatchObject({ state: "partial", why: "5 calls stored (newest 28 Oct 2026); 5 of the last eight quarters have one." });
    expect(run("calls", m(21, "2026-04-28", { recent: 8 })).state).toBe("partial"); // eight quarters, but the newest two are missing
  });
  it("no call: says whether files wait, a search found nothing, or nothing was tried", () => {
    expect(run("calls", m(0, null, { store: 6 }))).toMatchObject({ state: "none", why: "No call can be read yet: 6 transcript files of this company are stored and not yet turned into speaker turns." });
    expect(run("calls", m(0, null, { checked: "2026-11-22" })).why).toBe("No call is stored. The company's own site was searched on 22 Nov 2026 and no transcript was found.");
    expect(run("calls", m(0)).why).toBe("No call is stored, and none has been searched for yet.");
  });
  it("commitments: need two calls, and follow the newest call", () => {
    expect(run("promises", m(0, null, { calls: 1 }))).toMatchObject({ state: "not_applicable", why: "Commitments are tracked across at least two stored calls; this company has one." });
    expect(run("promises", m(0)).state).toBe("not_applicable");
    expect(run("promises", m(0, null, { calls: 8, call_newest: "2026-10-28" })).state).toBe("none");
    expect(run("promises", m(7, "2026-10-28", { calls: 8, call_newest: "2026-10-28", read: true })).state).toBe("full");
    expect(run("promises", m(7, "2026-07-29", { calls: 8, call_newest: "2026-10-28", read: true })).state).toBe("partial");
    expect(run("promises", m(0, "2026-10-28", { calls: 8, call_newest: "2026-10-28", read: true }))).toMatchObject({ state: "full", items: 0 });
    expect(run("promises", m(0, "2026-10-28", { calls: 8, call_newest: "2026-10-28", read: true, error: "model failed" })).state).toBe("partial");
  });
});

describe("research", () => {
  it("reports: the primer is the one every company should have", () => {
    expect(run("reports", m(2, "2026-11-20", { kinds: ["primer", "recap"] })).state).toBe("full");
    expect(run("reports", m(1, "2026-11-20", { kinds: ["recap"], failed: ["primer"] }))).toMatchObject({ state: "partial", why: "Stored: recap. The primer is missing (its last attempt failed)." });
    expect(run("reports", m(0, null, { failed: ["primer"] })).why).toBe("No report is stored; the last attempt (primer) failed.");
    expect(run("reports", m(0)).state).toBe("none");
  });
  it("alt data: any matched record", () => {
    expect(run("alt_data", m(420, "2026-11-20", { datasets: 6 }))).toMatchObject({ state: "full", why: "420 records in 6 datasets; newest 20 Nov 2026." });
    expect(run("alt_data", m(0)).state).toBe("none");
  });
});

describe("owner holds", () => {
  const held: Ctx = { ...ctx, held: new Map([["loop:company", "owner: hold. model spend"]]) };
  it("nothing stored and the lane stopped is `held`", () => {
    expect(run("ir_figures", m(0), co, held)).toMatchObject({ state: "held", why: "No figures have been read from this company's documents yet. Its collection is stopped by the owner." });
  });
  it("what is stored stays what it is", () => {
    expect(run("ir_figures", m(150, "2026-09-30", { built: "2026-11-20" }), co, held)).toMatchObject({ state: "partial" });
    expect(run("ir_figures", m(150, "2026-09-30", { built: "2026-11-20" }), co, held).why).toContain("stopped by the owner");
    expect(run("ir_figures", m(18_400, "2026-09-30", { built: "2026-11-20" }), co, held).state).toBe("full");
    // a hold on another lane changes nothing
    expect(run("calls", m(0), co, held).state).toBe("none");
  });
});

describe("what a tab says", () => {
  it("tells not stored yet from does not exist", () => {
    expect(emptyNote({ state: "none", why: "No call is stored, and none has been searched for yet.", items: 0 })?.title).toBe("Not stored yet");
    expect(emptyNote({ state: "full", why: "The 10-K was read: it names no customer.", items: 0 })?.title).toBe("Checked: there is none");
    expect(emptyNote({ state: "not_applicable", why: "x", items: 0 })?.title).toBe("Does not apply to this company");
    expect(emptyNote({ state: "held", why: "x", items: 0 })?.title).toBe("Not stored: collection is stopped");
    // something is stored: the tab shows it and needs no note
    expect(emptyNote({ state: "full", why: "x", items: 12 })).toBeNull();
    expect(emptyNote({ state: "partial", why: "x", items: 3 })).toBeNull();
    expect(emptyNote(null)).toBeNull();
  });
  it("counts states", () => {
    expect(tally(["full", "full", "none", "held"])).toEqual({ full: 2, partial: 0, none: 1, not_applicable: 0, held: 1 });
    expect(NO_MEASURE).toEqual({ n: 0, d: null, x: {} });
  });
});
