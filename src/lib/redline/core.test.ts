import { describe, expect, it } from "vitest";
import { htmlToBlocks, splitSections } from "./extract";
import { diffBlocks, wordDiff } from "./diff";
import { buildRedline, compactRedline, defaultBase, textsOf } from "./core";
import { vetSummary } from "./summary";

const doc = (risk: string[], mdna: string[]) => `<html><body>
<div><span style="font-family:'Times New Roman';font-weight:700">Item 1A. Risk Factors</span></div>
${risk.join("\n")}
<div><span style="font-weight:700">Item 7. Management's Discussion and Analysis of Financial Condition and Results of Operations</span></div>
${mdna.join("\n")}
<div><span style="font-weight:700">Item 8. Financial Statements and Supplementary Data</span></div>
<p>See the financial statements beginning on page 50 of this annual report, which are incorporated herein by reference for all purposes.</p>
</body></html>`;
const h = (t: string) => `<div style="margin-top:12pt"><span style="font-family:'NVIDIA Sans',sans-serif;font-weight:700">${t}</span></div>`;
const p = (t: string) => `<div><span style="font-family:'NVIDIA Sans',sans-serif;font-weight:400">${t}</span></div>`;

const RISK_OLD = [
  h("Risks Related to Demand"),
  p("Demand for our products may fluctuate because customers might delay purchases when new architectures are announced and transitions are complex."),
  h("Risks Related to Regulation"),
  p("We may become subject to export controls that could restrict sales of certain products to customers in some regions of the world."),
  p("Our business depends on a limited number of contract manufacturers located in Asia, and any disruption could harm results."),
];
const RISK_NEW = [
  h("Risks Related to Demand"),
  p("Demand for our products may fluctuate because customers might delay purchases when new architectures are announced and transitions are complex."),
  h("Risks Related to Regulation"),
  p("We are subject to export controls that restrict sales of certain products to customers in China, and the government imposed new license requirements."),
  h("Our indebtedness may adversely affect our financial condition."),
  p("We issued senior notes that require interest payments and contain covenants that could limit our operating flexibility."),
];
const MDNA = [p("Revenue for fiscal year 2025 was $130.5 billion, up 114% from a year ago, driven by Data Center demand.")];
const MDNA_NEW = [p("Revenue for fiscal year 2026 was $215.9 billion, up 65% from a year ago, driven by Data Center demand.")];
const F = (accn: string, filed: string, form = "10-K", report?: string) => ({ accn, doc: "d.htm", form, filed, report });

describe("filing text extraction", () => {
  it("treats bold spans with quoted font names as headings", () => {
    const b = htmlToBlocks(`<div><span style="font-family:'NVIDIA Sans';font-weight:700">Risks Related to Demand</span></div><div><span style="font-weight:400">Body text that is not bold at all and keeps going.</span></div>`);
    expect(b.map((x) => x.heading)).toEqual([true, false]);
  });

  it("re-joins a paragraph split by a page break", () => {
    const b = htmlToBlocks(`<p>Our suppliers may be unable to meet demand for</p><p>12</p><p>advanced packaging capacity in the coming year.</p>`);
    expect(b.map((x) => x.text)).toEqual(["Our suppliers may be unable to meet demand for advanced packaging capacity in the coming year."]);
  });

  it("reads an Item heading laid out as a table with empty spacer rows", () => {
    const html = `<table><tr><td/><td/></tr><tr><td colspan="2" style="background:#032d42"></td></tr><tr><td><span style="font-weight:700">Item 2. Management's Discussion and Analysis</span></td></tr><tr><td></td></tr></table>`;
    expect(htmlToBlocks(html)).toEqual([{ text: "Item 2. Management's Discussion and Analysis", heading: true }]);
  });

  it("falls back to standard section titles when a filer doesn't use Item headings", () => {
    const body = (t: string) => `<p>${t} discussion that continues for long enough to count as the real section rather than an index entry.</p>`;
    const html = `<p><b>Notes to Consolidated Condensed Financial Statements</b></p>${body("Notes")}<p><b>Management's Discussion and Analysis</b></p>${body("MD&A")}<p><b>Risk Factors and Other Key Information</b></p>${body("Risk")}`;
    expect(splitSections(htmlToBlocks(html), "10-Q").map((x) => x.key)).toEqual(["I-1", "I-2", "II-1A"]);
  });

  it("splits 10-K items and skips the table-of-contents copy", () => {
    const toc = `<p>Item 1A. Risk Factors</p><p>Item 7. Management's Discussion and Analysis</p>`;
    const s = splitSections(htmlToBlocks(toc + doc(RISK_OLD, MDNA)), "10-K");
    expect(s.find((x) => x.key === "1A")?.blocks.length).toBe(5);
    expect(s.find((x) => x.key === "7")?.blocks.length).toBe(1);
  });
});

describe("paragraph diff", () => {
  it("word diff reproduces both texts exactly", () => {
    const a = "We may become subject to export controls that could restrict sales.";
    const b = "We are subject to export controls that restrict sales in China.";
    const ops = wordDiff(a, b);
    expect(textsOf({ ops }).before).toBe(a);
    expect(textsOf({ ops }).after).toBe(b);
  });

  it("pairs a rewritten paragraph instead of reporting an add and a remove", () => {
    const blocks = (xs: string[]) => xs.map((text) => ({ text, heading: false }));
    const r = diffBlocks(
      blocks(["Same opening paragraph that does not change between the two years at all.", "We may become subject to export controls that could restrict sales of certain products."]),
      blocks(["Same opening paragraph that does not change between the two years at all.", "We are subject to export controls that restrict sales of certain products in China."]),
    );
    expect(r.changes.map((c) => c.type)).toEqual(["changed"]);
    expect(r.unchanged).toBe(1);
  });
});

describe("buildRedline", () => {
  const r = buildRedline({ ticker: "NVDA", form: "10-K", from: F("0001045810-25-000023", "2025-02-26"), to: F("0001045810-26-000023", "2026-02-25"), oldHtml: doc(RISK_OLD, MDNA), newHtml: doc(RISK_NEW, MDNA_NEW) });
  const risk = r.changes.filter((c) => c.section === "1A");

  it("finds the new risk factor heading, the hardened export-control language and the removed paragraph", () => {
    expect(risk.some((c) => c.type === "added" && c.isHeading && /indebtedness/.test(c.after ?? ""))).toBe(true);
    const hardened = risk.find((c) => c.type === "changed" && /export controls/.test(textsOf(c).after ?? ""));
    expect(hardened?.level).not.toBe("low");
    expect(risk.some((c) => c.type === "removed" && /contract manufacturers/.test(c.before ?? ""))).toBe(true);
  });

  it("records the heading a change sits under", () => {
    expect(risk.find((c) => c.type === "changed")?.context).toBe("Risks Related to Regulation");
  });

  it("marks number-only rewrites as figure updates scored low", () => {
    const m = r.changes.find((c) => c.section === "7");
    expect(m?.figuresOnly).toBe(true);
    expect(m?.level).toBe("low");
  });

  it("compaction keeps the texts recoverable from the word diff", () => {
    const c = compactRedline(r).changes.find((x) => x.type === "changed")!;
    expect(c.after).toBeUndefined();
    expect(textsOf(c).after).toContain("restrict sales of certain products to customers in China");
  });

  it("a summary bullet survives only with a verbatim quote and numbers from the cited change", () => {
    const id = risk.find((c) => c.type === "changed")!.id;
    const v = vetSummary({
      headline: "Export controls are now a fact rather than a possibility.",
      bullets: [
        { text: "Export-control risk hardened.", changeIds: [id], quote: "the government imposed new license requirements" },
        { text: "Made-up quote.", changeIds: [id], quote: "we expect China sales to recover next year" },
        { text: "Invented number: 40% of revenue.", changeIds: [id], quote: "restrict sales of certain products to customers in China" },
        { text: "Unknown change.", changeIds: ["nope"], quote: "the government imposed new license requirements" },
      ],
    }, r);
    expect(v.bullets.map((b) => b.text)).toEqual(["Export-control risk hardened."]);
    expect(v.dropped).toBe(3);
  });
});

describe("whole-report fallback", () => {
  it("compares the full text when neither filing has recognisable sections", () => {
    const html = (x: string) => `<p><b>CONSOLIDATED RESULTS</b></p><p>Orders grew in the quarter as commercial engine demand stayed strong across regions.</p><p>${x}</p>`;
    const r = buildRedline({ ticker: "GE", form: "10-Q", from: F("a", "2025-10-21", "10-Q"), to: F("b", "2026-10-20", "10-Q"), oldHtml: html("Supply chain constraints may limit deliveries of certain engines."), newHtml: html("Supply chain constraints have limited deliveries of certain engines and tariffs were imposed on imported parts.") });
    expect(r.sections.map((x) => [x.key, x.found])).toEqual([["ALL", "both"]]);
    expect(r.changes.filter((c) => c.type === "changed")).toHaveLength(1);
  });
});

describe("defaultBase", () => {
  it("compares a 10-K with the prior 10-K and a 10-Q with the same quarter a year earlier", () => {
    const fs = [F("a", "2026-02-25"), F("b", "2025-02-26"), F("q3", "2026-11-19", "10-Q", "2026-10-26"), F("q2", "2026-08-26", "10-Q", "2026-07-27"), F("q3old", "2025-11-19", "10-Q", "2025-10-26")];
    expect(defaultBase(fs, fs[0])?.accn).toBe("b");
    expect(defaultBase(fs, fs[2])?.accn).toBe("q3old");
  });
});
