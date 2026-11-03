import { describe, expect, it } from "vitest";
import { parseTranscript, transcriptMatches, transcriptRef } from "./parse";
import { questionIndex, talkShare } from "./analyze";

// Current layout: inline "**Name:** text" turns with a participants list.
const INLINE = `
## CALL PARTICIPANTS

- Chief Executive Officer - Jane Doe
- Chief Financial Officer - Raj Patel

## Full Conference Call Transcript

**Operator:** Good afternoon and welcome to the Example Corp third quarter call.

**Jane Doe:** Thanks everyone. Revenue grew 12% to $4.2 billion.

We raised our full-year outlook.

**Raj Patel:** Gross margin was 46.1%.

**Operator:** Our first question is from Sam Lee of Goldman Sachs. Your line is open.

**Sam Lee:** Thanks for taking my question. How durable is the margin expansion?

**Raj Patel:** We think most of it is structural.

**Sam Lee:** And on capex?

**Jane Doe:** Capex stays near $1 billion.

**Operator:** Our next question comes from Ana Ruiz with J.P. Morgan. Please go ahead.

**Ana Ruiz:** What drove the outlook raise?

**Jane Doe:** Demand in data centers.

## Read Next

**Bob:** This is not part of the call.
`;

// Older layout: "**Name** -- _Role_" headers, paragraphs below, explicit Q&A heading.
const HEADERS = `
## Prepared Remarks:

**Operator**

Welcome to the call.

**Jim Chapman** \\-\\- _Vice President, Investor Relations_

Thanks, operator.

## Questions & Answers:

**Operator**

The first question comes from Neil Mehta of Goldman Sachs.

**Neil Mehta** \\-\\- _Goldman Sachs -- Analyst_

How is the Permian performing?

**Jim Chapman** \\-\\- _Vice President, Investor Relations_

Ahead of plan.

**Duration: 0 minutes**
`;

describe("transcript parsing", () => {
  const a = parseTranscript(INLINE);
  it("splits inline turns and joins continuation paragraphs", () => {
    expect(a.turns.map((t) => t.speaker)).toEqual(["Operator", "Jane Doe", "Raj Patel", "Operator", "Sam Lee", "Raj Patel", "Sam Lee", "Jane Doe", "Operator", "Ana Ruiz", "Jane Doe"]);
    expect(a.turns[1].text).toBe("Thanks everyone. Revenue grew 12% to $4.2 billion.\n\nWe raised our full-year outlook.");
  });
  it("stops at the first heading after the transcript", () => {
    expect(a.turns.some((t) => t.speaker === "Bob")).toBe(false);
  });
  it("classifies management from the participants list and analysts from operator intros", () => {
    const kind = Object.fromEntries(a.speakers.map((s) => [s.name, s.kind]));
    expect(kind).toMatchObject({ "Jane Doe": "management", "Raj Patel": "management", "Sam Lee": "analyst", "Ana Ruiz": "analyst", Operator: "operator" });
    expect(a.speakers.find((s) => s.name === "Sam Lee")?.firm).toBe("Goldman Sachs");
    expect(a.speakers.find((s) => s.name === "Ana Ruiz")?.firm).toBe("J.P. Morgan");
  });
  it("starts Q&A at the operator's first analyst introduction", () => {
    expect(a.qaStart).toBe(3);
    expect(a.turns[2].section).toBe("prepared");
    expect(a.turns[3].section).toBe("qa");
  });

  const b = parseTranscript(HEADERS);
  it("reads header-style turns, roles and the explicit Q&A heading", () => {
    expect(b.turns.map((t) => t.speaker)).toEqual(["Operator", "Jim Chapman", "Operator", "Neil Mehta", "Jim Chapman"]);
    expect(b.qaStart).toBe(2);
    const neil = b.speakers.find((s) => s.name === "Neil Mehta")!;
    expect(neil.kind).toBe("analyst");
    expect(neil.firm).toBe("Goldman Sachs");
    expect(b.speakers.find((s) => s.name === "Jim Chapman")?.role).toBe("Vice President, Investor Relations");
    expect(b.turns.at(-1)!.text).toBe("Ahead of plan.");
  });
});

describe("transcript analytics", () => {
  const a = parseTranscript(INLINE);
  it("indexes one question per analyst exchange, skipping pleasantries", () => {
    const q = questionIndex(a);
    expect(q.map((x) => x.speaker)).toEqual(["Sam Lee", "Ana Ruiz"]);
    expect(q[0].gist).toBe("How durable is the margin expansion?");
  });
  it("splits talk time by group", () => {
    const s = talkShare(a);
    expect(s.management + s.analyst + s.operator).toBeCloseTo(1);
    expect(s.analyst).toBeGreaterThan(0);
  });
});

describe("transcript URLs", () => {
  const url = "https://www.fool.com/earnings/call-transcripts/2026/10/13/jpmorgan-chase-jpm-q3-2026-earnings-call-transcript";
  it("reads quarter and call date from the URL", () => {
    expect(transcriptRef(url)).toMatchObject({ quarter: "Q3 2026", fq: 3, fy: 2026, date: "2026-10-13" });
  });
  it("matches the company by ticker token or name, not other companies", () => {
    expect(transcriptMatches(url, "JPM", "JPMorgan Chase")).toBe(true);
    expect(transcriptMatches("https://www.fool.com/earnings/call-transcripts/2025/10/31/apple-q4-2025-earnings-call-transcript", "AAPL", "Apple")).toBe(true);
    expect(transcriptMatches("https://www.fool.com/earnings/call-transcripts/2026/10/14/bofa-bac-q3-2026-earnings-call-transcript", "JPM", "JPMorgan Chase")).toBe(false);
    expect(transcriptMatches("https://www.fool.com/investing/2026/11/02/apple-sales-rise", "AAPL", "Apple")).toBe(false);
  });
});
