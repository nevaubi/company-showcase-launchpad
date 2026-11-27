import { describe, expect, it } from "vitest";
import { coverageLine, coverageText } from "./assistant-text";
import type { CoverageRow } from "./corpora";

const row = (corpus: string, state: CoverageRow["state"], items: number, newest: string | null, why: string): CoverageRow => ({ ticker: "AA", corpus, state, items, newest, why });
const rows = [
  row("statements", "partial", 1, "2026-11-27", "Statements are stored through the quarter ended 30 Sep 2026; empty headline value: operating margin."),
  row("calls", "none", 0, null, "No call is stored, and none has been searched for yet."),
  row("promises", "not_applicable", 0, null, "Commitments are tracked across at least two stored calls; this company has none."),
  row("concentration", "full", 0, null, "The tagged detail of the company's filings was read: no customer or supplier share is tagged."),
  row("supply_links", "full", 40, "2026-10-29", "40 current links, from filings through 29 Oct 2026."),
];

describe("the coverage ledger for the assistant", () => {
  it("lists each kind of data in the order of the rules, with state, count, date and reason", () => {
    const t = coverageText("AA", "Alcoa", rows, "2026-11-27T14:10:47Z");
    const lines = t.output.split("\n");
    expect(lines[0]).toBe("What FiledUnder holds for Alcoa (AA), checked 27 Nov 2026: 2 complete, 1 partial, 1 not stored, 0 stopped, 1 not applicable.");
    expect(lines[1]).toBe("- Statements [Partial, 1 item, newest 27 Nov 2026]: Statements are stored through the quarter ended 30 Sep 2026; empty headline value: operating margin.");
    expect(lines[2]).toBe("- Call transcripts [Not stored]: No call is stored, and none has been searched for yet.");
    expect(lines[3]).toBe("- Commitments [Does not apply]: Commitments are tracked across at least two stored calls; this company has none.");
    expect(lines[4]).toBe("- Supply links [Complete, 40 items, newest 29 Oct 2026]: 40 current links, from filings through 29 Oct 2026.");
    expect(lines[5]).toContain("- Tagged customer shares [Complete]:");
    expect(t.summary).toBe("2 complete, 1 partial, 1 not stored");
  });
  it("ends with the rule that a gap in the app is not a fact about the company", () => {
    const last = coverageText("AA", "Alcoa", rows, null).output.split("\n").pop()!;
    expect(last).toContain('never "the company has none"');
    expect(last).toContain('"Complete" with no items means the source was read and holds none');
  });
  it("says so when the ledger has no row for the company", () => {
    const t = coverageText("ZZZZ", undefined, [], null);
    expect(t.output).toContain("holds no row for ZZZZ");
    expect(t.summary).toBe("no ledger rows");
  });
  it("gives one kind of data's line for a tool that found nothing", () => {
    expect(coverageLine(rows, "calls")).toBe("Call transcripts: Not stored. No call is stored, and none has been searched for yet.");
    expect(coverageLine(rows, "options")).toBeNull();
  });
});
