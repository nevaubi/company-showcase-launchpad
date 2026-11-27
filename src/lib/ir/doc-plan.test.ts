// The rebuild's document plan: one copy per document family, decks for two years, older history from the
// primary statement documents only, nothing older than 15 years; a document is never left out for sharing a
// kind and period with another, or for carrying no filing date.
import { describe, expect, it } from "vitest";
import { filingLag, periodMark, planDocuments, type PlanDocRow } from "@/lib/ir/doc-plan";

const row = (
  id: string,
  filed: string | null,
  kind: string,
  ext = "htm",
  extra: Partial<PlanDocRow> = {},
): PlanDocRow => ({
  id,
  kind,
  ext,
  filed,
  title: extra.title ?? `${kind} ${filed}`,
  period: extra.period ?? null,
  source_url: extra.source_url ?? null,
  rendition_path: extra.rendition_path ?? null,
  extract_facts: extra.extract_facts ?? null,
  prose_facts: extra.prose_facts ?? null,
});

describe("document plan", () => {
  it("keeps one copy of a supplement stored as SEC exhibit, IR-site PDF and spreadsheet (auda-02)", () => {
    const p = planDocuments([
      row("pdf", "2026-10-14", "supplement", "pdf", {
        title: "3Q26 Financial Supplement",
        rendition_path: "r/1.html",
      }),
      row("sec", "2026-10-13", "supplement", "htm", {
        title: "3Q26 Financial Supplement",
        source_url: "https://www.sec.gov/Archives/x.htm",
      }),
      row("xlsx", "2026-10-15", "supplement", "xlsx", { title: "3Q26 Financial Supplement" }),
      row("deck", "2026-10-13", "presentation", "pdf"),
    ]);
    // The family counts from its latest copy (Oct 15), so it lists before the deck of Oct 13.
    expect(p.load).toEqual(["sec", "deck"]);
    expect(p.counts).toEqual({ stored: 4, loaded: 2, left: { copy: 2 } });
  });
  it("loads two exhibits of one filing stored under one kind and period (Citizens' release and supplement)", () => {
    // Stored rows of 16 Oct 2026: the earnings release and the financial supplement, both kind "supplement".
    const sec = "https://www.sec.gov/Archives/edgar/data/759944/000075994426000206/";
    const p = planDocuments([
      row("5f0b", "2026-10-16", "supplement", "htm", {
        title: "8-K 2026-10-16 a3q26earningsrelease.htm (Items 2.02,9.01)",
        period: "Q3 FY26",
        source_url: `${sec}a3q26earningsrelease.htm`,
        extract_facts: 174,
      }),
      row("a295", "2026-10-16", "supplement", "htm", {
        title: "8-K 2026-10-16 q326financialsupplement.htm (Items 2.02,9.01)",
        period: "Q3 FY26",
        source_url: `${sec}q326financialsupplement.htm`,
        extract_facts: 1361,
      }),
      row("deck", "2026-10-16", "presentation", "htm", {
        title: "8-K 2026-10-16 a3q26earningspresentatio.htm (Items 2.02,9.01)",
        period: "Q3 FY26",
        source_url: `${sec}a3q26earningspresentatio.htm`,
      }),
    ]);
    expect(p.load).toEqual(["5f0b", "a295", "deck"]);
    expect(p.counts).toEqual({ stored: 3, loaded: 3, left: {} });
  });
  it("among copies loads the one that carries figures, then the SEC HTML exhibit", () => {
    const p = planDocuments([
      row("sec", "2026-10-13", "supplement", "htm", {
        title: "3Q26 Financial Supplement",
        source_url: "https://www.sec.gov/Archives/x.htm",
      }),
      row("pdf", "2026-10-14", "supplement", "pdf", {
        title: "3Q26 Financial Supplement",
        rendition_path: "r/1.html",
        extract_facts: 900,
      }),
    ]);
    expect(p.load).toEqual(["pdf"]);
    expect(p.counts.left).toEqual({ copy: 1 });
  });
  it("keeps decks for two years and, before 37 months, only supplements (else releases) per quarter", () => {
    const p = planDocuments([
      row("new", "2026-10-13", "press-release"),
      row("deck-1y", "2025-10-13", "presentation", "pdf"),
      row("deck-3y", "2024-01-13", "presentation", "pdf"),
      row("old-pr", "2022-10-13", "press-release"),
      row("old-sup", "2022-10-13", "supplement", "htm", { title: "supplement" }),
      row("old-other", "2022-10-14", "other"),
      row("old-pr-only", "2021-04-20", "press-release"),
      row("ancient", "2010-04-20", "press-release"),
      row("undated", null, "other"),
    ]);
    // A document that cannot be placed in time is loaded, last.
    expect(p.load).toEqual(["new", "deck-1y", "old-sup", "old-pr-only", "undated"]);
    expect(p.counts.left).toEqual({ deck: 1, older: 2, "too-old": 1 });
    expect(p.counts.undated).toBe(1);
  });
  it("reads a period as a date, a quarter or a year", () => {
    expect(periodMark("2026-10-16")).toEqual({ date: "2026-10-16", exact: true });
    expect(periodMark("Q3 FY26")).toEqual({ date: "2026-09-30", exact: false });
    expect(periodMark("Q1 FY99")).toEqual({ date: "1999-03-31", exact: false });
    expect(periodMark("FY2024")).toEqual({ date: "2024-12-31", exact: false });
    expect(periodMark("Q1 TP12")).toBeNull();
    expect(periodMark(null)).toBeNull();
  });
  it("places undated documents by their period and the company's own filing lag", () => {
    // A fiscal year ending in January is named a year ahead: Q1 FY26 ends in April 2025.
    const dated = [
      row("q4", "2025-02-26", "press-release", "htm", { period: "Q4 FY25" }),
      row("q1", "2025-05-28", "press-release", "htm", { period: "Q1 FY26" }),
      row("q2", "2025-08-27", "press-release", "htm", { period: "Q2 FY26" }),
      row("q3", "2025-11-19", "press-release", "htm", { period: "Q3 FY26" }),
    ];
    expect(filingLag(dated)).toBe(-308);
    const p = planDocuments([
      ...dated,
      // Placed in August 2025: inside the full window.
      row("u-sup", null, "supplement", "pdf", { title: "Q2 supplement", period: "Q2 FY26" }),
      // Placed in November 2021: older than 37 months, a release is a primary document.
      row("u-old-pr", null, "press-release", "pdf", { title: "Q3 release", period: "Q3 FY22" }),
      // The same quarter's spreadsheet is not.
      row("u-old-data", null, "data", "xlsx", { title: "Q3 data", period: "Q3 FY22" }),
      // Placed in May 2022: a deck older than two years.
      row("u-old-deck", null, "presentation", "pdf", { title: "Q1 deck", period: "Q1 FY23" }),
      // Placed in 2008: older than 15 years.
      row("u-ancient", null, "press-release", "pdf", { title: "2008 release", period: "Q3 FY09" }),
      // A period that holds a date is that date.
      row("u-date", null, "other", "pdf", { title: "Investor day", period: "2025-06-10" }),
    ]);
    expect(p.load).toEqual(["q3", "q2", "u-sup", "u-date", "q1", "q4", "u-old-pr"]);
    expect(p.counts.left).toEqual({ older: 1, deck: 1, "too-old": 1 });
    expect(p.counts.undated).toBe(3);
  });
  it("uses a 30-day lag until four dated documents name their quarter", () => {
    expect(filingLag([row("a", "2026-10-13", "press-release", "htm", { period: "Q3 FY26" })])).toBe(
      30,
    );
  });
  it("loads a company whose documents carry no filing date at all", () => {
    const p = planDocuments([
      row("a", null, "press-release", "pdf", { title: "Third quarter results", period: "Q3 FY26" }),
      row("b", null, "supplement", "xlsx", { title: "Supplement", period: "Q3 FY26" }),
      row("c", null, "other", "pdf", { title: "Fact sheet" }),
    ]);
    expect(p.load).toEqual(["a", "b", "c"]);
    expect(p.counts).toEqual({ stored: 3, loaded: 3, left: {}, undated: 3 });
  });
  it("an undated copy needs the same kind, period and title", () => {
    const p = planDocuments([
      row("sec", "2026-10-13", "supplement", "htm", {
        title: "3Q26 Financial Supplement",
        period: "Q3 FY26",
        source_url: "https://www.sec.gov/Archives/x.htm",
        extract_facts: 1000,
      }),
      row("copy", null, "supplement", "pdf", {
        title: "3Q26 Financial Supplement",
        period: "Q3 FY26",
      }),
      // The same generic title with no period says nothing: two documents.
      row("pr-1", null, "press-release", "pdf", { title: "Press release" }),
      row("pr-2", null, "press-release", "pdf", { title: "Press release" }),
      // Another title in the same quarter is another document.
      row("other-sup", null, "supplement", "pdf", {
        title: "3Q26 Segment Supplement",
        period: "Q3 FY26",
      }),
    ]);
    expect(p.load).toEqual(["other-sup", "sec", "pr-1", "pr-2"]);
    expect(p.counts.left).toEqual({ copy: 1 });
    expect(p.counts.undated).toBe(3);
  });
});
