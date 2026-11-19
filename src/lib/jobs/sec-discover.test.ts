import { describe, expect, it } from "vitest";
import { coveredOnly, isEarnings, masterUrl, parseCurrentAtom, parseMasterIndex } from "./sec-discover";

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
