import { describe, expect, it } from "vitest";
import { coveredOnly, dayProgress, formatDayState, isEarnings, masterUrl, missingEarnings, parseCurrentAtom, parseDayState, parseMasterIndex, repairWindow, rotate } from "./sec-discover";

const atom = `<feed><entry>
<title>8-K - Apple Inc. (0000320193) (Filer)</title>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-11-18 &lt;b&gt;AccNo:&lt;/b&gt; 0000320193-26-000101 &lt;b&gt;Size:&lt;/b&gt; 1 MB
&lt;br&gt;Item 2.02: Results of Operations and Financial Condition
&lt;br&gt;Item 9.01: Financial Statements and Exhibits</summary>
<category scheme="https://www.sec.gov/" label="form type" term="8-K"/>
<id>urn:tag:sec.gov,2008:accession-number=0000320193-26-000101</id>
</entry><entry>
<title>424B2 - Apple Inc. (0000320193) (Filer)</title>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-11-18 &lt;b&gt;AccNo:&lt;/b&gt; 0000320193-26-000102</summary>
<category term="424B2"/><id>urn:tag:sec.gov,2008:accession-number=0000320193-26-000102</id>
</entry><entry>
<title>4 - Someone (0009999999) (Reporting)</title>
<summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-11-18 &lt;b&gt;AccNo:&lt;/b&gt; 0009999999-26-000001</summary>
<category term="4"/><id>urn:tag:sec.gov,2008:accession-number=0009999999-26-000001</id>
</entry></feed>`;

describe("market-wide SEC discovery", () => {
  it("reads accession, form, date and 8-K items from the current feed", () => {
    expect(parseCurrentAtom(atom)[0]).toEqual({ cik: "320193", accn: "0000320193-26-000101", form: "8-K", filed: "2026-11-18", items: "2.02,9.01" });
  });
  it("keeps only covered filers and the forms the walk stores", () => {
    const rows = coveredOnly(parseCurrentAtom(atom), new Map([["320193", "AAPL"]]));
    expect(rows.map((r) => r.accn)).toEqual(["0000320193-26-000101"]);
    expect(rows[0].ticker).toBe("AAPL");
  });
  it("detects earnings releases only from 8-K item 2.02", () => {
    expect(isEarnings("8-K", "2.02,9.01")).toBe(true);
    expect(isEarnings("8-K", "7.01,9.01")).toBe(false);
    expect(isEarnings("10-Q", "2.02")).toBe(false);
  });
  it("parses the daily master index", () => {
    const idx = "CIK|Company Name|Form Type|Date Filed|File Name\n------\n320193|APPLE INC|10-K|20261031|edgar/data/320193/0000320193-26-000090.txt\n";
    expect(parseMasterIndex(idx)).toEqual([{ cik: "320193", accn: "0000320193-26-000090", form: "10-K", filed: "2026-10-31", items: null }]);
  });
  it("builds the quarter path of a daily index", () => {
    expect(masterUrl("2026-11-18")).toBe("https://www.sec.gov/Archives/edgar/daily-index/2026/QTR4/master.20261118.idx");
  });
});


describe("day pass progress", () => {
  const day = "2026-11-19";
  it("works through a busy day: runs that shrink the missing list never count as tries", () => {
    let prev = parseDayState(null);
    for (const left of [165, 160, 152, 140]) {
      const d = dayProgress(prev, day, left, 4);
      expect(d.kind).toBe("stay");
      if (d.kind !== "stay") return;
      expect(d.state.tries).toBe(0);
      prev = parseDayState(formatDayState(d.state));
    }
    expect(prev).toMatchObject({ day, left: 140, run: 4 });
  });
  it("gives up only after 20 runs without progress", () => {
    let prev = parseDayState(formatDayState({ day, tries: 0, left: 3, run: 9 }));
    for (let i = 1; i < 20; i++) {
      const d = dayProgress(prev, day, 3, 1);
      if (d.kind !== "stay") throw new Error("gave up early");
      expect(d.state.tries).toBe(i);
      prev = d.state;
    }
    const last = dayProgress(prev, day, 3, 1);
    expect(last).toMatchObject({ kind: "next", complete: false });
    expect(last.kind === "next" && last.reason).toMatch(/^gave up on 2026-11-19: 2 companies unresolved after 20 runs without progress$/);
  });
  it("completes when nothing is missing or every missing company synced this run", () => {
    expect(dayProgress(parseDayState(null), day, 0, 0)).toEqual({ kind: "next", reason: null, complete: true });
    expect(dayProgress(parseDayState(null), day, 3, 3)).toMatchObject({ kind: "next", complete: true });
  });
  it("reads the old reason format and a new day starts fresh", () => {
    expect(parseDayState("tries 7 on 2026-11-18")).toEqual({ day: "2026-11-18", tries: 7, left: null, run: 0 });
    const d = dayProgress(parseDayState("tries 7 on 2026-11-18"), day, 50, 2);
    expect(d.kind === "stay" && d.state).toMatchObject({ tries: 0, run: 1 });
  });
  it("rotates the resolve order", () => {
    expect(rotate(["A", "B", "C"], 4)).toEqual(["B", "C", "A"]);
    expect(rotate([], 3)).toEqual([]);
  });
});

describe("earnings repair", () => {
  it("lists 8-K 2.02 filings without an event (CSCO and AMAT examples)", () => {
    const filings = [
      { accn: "0000858877-26-000170", ticker: "CSCO", form: "8-K", filed: "2026-11-12", items: "2.02,9.01" },
      { accn: "0001628280-26-073360", ticker: "AMAT", form: "8-K", filed: "2026-11-12", items: "2.02,9.01" },
      { accn: "x-1", ticker: "MSFT", form: "8-K", filed: "2026-11-12", items: "2.02" },
      { accn: "x-2", ticker: "KO", form: "8-K", filed: "2026-11-12", items: "5.02" },
    ];
    const out = missingEarnings(filings, [{ ticker: "MSFT", accn: "x-1" }]);
    expect(out).toEqual([
      { ticker: "CSCO", accn: "0000858877-26-000170", filed: "2026-11-12", source: "sec-8k-2.02" },
      { ticker: "AMAT", accn: "0001628280-26-073360", filed: "2026-11-12", source: "sec-8k-2.02" },
    ]);
  });
  it("walks five-day windows back over 60 days and wraps", () => {
    expect(repairWindow(0, "2026-11-20")).toEqual({ from: "2026-11-14", to: "2026-11-18", next: 1 });
    expect(repairWindow(1, "2026-11-20")).toEqual({ from: "2026-11-09", to: "2026-11-13", next: 2 });
    const last = repairWindow(11, "2026-11-20");
    expect(last.next).toBe(0);
    expect(last.from <= "2026-09-21").toBe(true);
  });
});
