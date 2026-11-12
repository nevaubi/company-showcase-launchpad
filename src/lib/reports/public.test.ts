import { describe, expect, it } from "vitest";
import { publicDescription, publicSlice } from "./public";
import { decodeEntities, readableDates } from "./present";
import type { Fact, ReportContent } from "./types";

const sec = (id: string): Fact => ({
  id,
  area: "annual",
  text: `Fact ${id}: $1.00B.`,
  ref: {
    kind: "sec",
    label: id,
    src: {
      accn: "0000000000-25-000001",
      concept: "us-gaap:Revenues",
      end: "2025-09-30",
      value: 1e9,
    },
  },
});

function report(): ReportContent {
  return {
    version: 1,
    ticker: "MMS",
    name: "Maximus",
    kind: "primer",
    title: "Maximus: Margin Resilience",
    subtitle: "Federal mix shift.",
    asOf: "2026-11-12",
    priceAsOf: "2026-11-11",
    dataVersion: "v",
    generatedAt: "2026-11-12",
    model: "m",
    options: {
      length: "standard",
      audience: "internal",
      stance: "balanced",
      sections: [],
      focus: "",
    },
    facts: [
      sec("a"),
      sec("b"),
      sec("c"),
      sec("d"),
      sec("m1"),
      sec("m2"),
      sec("g"),
      sec("plot"),
      sec("lockedPlot"),
      {
        id: "med",
        area: "peers",
        text: "Peer median 13.5%.",
        ref: {
          kind: "composite",
          label: "median",
          formula: "median of peers",
          members: ["m1", "m2"],
        },
      },
    ],
    tables: [
      {
        id: "segments-1",
        title: "Segments",
        columns: ["Revenue"],
        rows: [{ label: "Federal", cells: [{ text: "$3.07B" }] }],
      },
      {
        id: "financials",
        title: "Financials",
        columns: ["FY2025"],
        rows: [{ label: "Revenue", cells: [{ text: "$5.43B" }] }],
      },
    ],
    charts: [
      {
        id: "segment-mix",
        title: "Mix",
        type: "stacked",
        x: ["FY2025"],
        series: [{ name: "Federal", kind: "bar", unit: "usd", points: [{ v: 3.07e9, f: "plot" }] }],
      },
      {
        id: "revenue-annual",
        title: "Revenue",
        type: "combo",
        x: ["FY2025"],
        series: [
          { name: "Revenue", kind: "bar", unit: "usd", points: [{ v: 5.43e9, f: "lockedPlot" }] },
        ],
      },
    ],
    glance: [{ label: "Market cap", value: "$3.42B", f: "g" }],
    sections: [
      {
        id: "summary",
        title: "Investment summary",
        paragraphs: [],
        bullets: [{ text: "One.", factIds: ["a", "med"] }],
        tables: [],
      },
      {
        id: "business",
        title: "Business overview",
        paragraphs: [{ text: "Two.", factIds: ["b"] }],
        bullets: [],
        tables: ["segments-1"],
        charts: ["segment-mix"],
      },
      {
        id: "financials",
        title: "Financial profile",
        paragraphs: [{ text: "Three.", factIds: ["c"] }],
        bullets: [],
        tables: ["financials"],
        charts: ["revenue-annual"],
      },
      {
        id: "risks",
        title: "Risks",
        paragraphs: [],
        bullets: [{ text: "Four.", factIds: ["d"] }],
        tables: [],
      },
    ],
    qa: { claims: 4, citedClaims: 4, numbers: 103, verifiedNumbers: 102, removed: [] },
  };
}

describe("public report slice", () => {
  const out = publicSlice(report());

  it("keeps the first two sections in full and lists the rest by title", () => {
    expect(out.content.sections.map((s) => s.id)).toEqual(["summary", "business"]);
    expect(out.locked).toEqual([
      { id: "financials", title: "Financial profile" },
      { id: "risks", title: "Risks" },
    ]);
  });

  it("never ships tables, charts or facts that belong only to locked sections", () => {
    expect(out.content.tables.map((t) => t.id)).toEqual(["segments-1"]);
    expect((out.content.charts ?? []).map((c) => c.id)).toEqual(["segment-mix"]);
    const ids = out.content.facts.map((f) => f.id);
    expect(ids).not.toContain("c");
    expect(ids).not.toContain("d");
    expect(ids).not.toContain("lockedPlot");
    expect(JSON.stringify(out.content)).not.toContain("Three.");
  });

  it("keeps what the free part can open: cited facts, composite members, headline tiles and plotted values", () => {
    expect(out.content.facts.map((f) => f.id).sort()).toEqual([
      "a",
      "b",
      "g",
      "m1",
      "m2",
      "med",
      "plot",
    ]);
  });

  it("reports totals for the whole report", () => {
    expect(out.totals).toEqual({ sections: 4, sources: 5, charts: 2, tables: 2 });
  });

  it("always shows at least one section", () => {
    expect(publicSlice(report(), 0).content.sections).toHaveLength(1);
  });

  it("builds a search description from the subtitle and the trust line", () => {
    expect(publicDescription(report(), 5)).toBe(
      "Federal mix shift. Maximus (MMS) primer: 102 of 103 figures matched to SEC filings, 5 sources cited.",
    );
  });
});

describe("display text", () => {
  it("decodes XML entities left in stored SEC text", () => {
    expect(decodeEntities("CEO &amp; President")).toBe("CEO & President");
    expect(decodeEntities("O&#39;Brien &#x26; Co")).toBe("O'Brien & Co");
    expect(decodeEntities("R&D spend")).toBe("R&D spend");
  });
  it("decodes entities and formats dates together", () => {
    expect(readableDates("2026-02-10: Bruce Caswell (CEO &amp; President) bought shares.")).toMatch(
      /^Feb 10, 2026: Bruce Caswell \(CEO & President\) bought shares\.$/,
    );
  });
});
