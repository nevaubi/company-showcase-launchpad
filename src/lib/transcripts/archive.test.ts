import { describe, expect, it } from "vitest";
import { archivedCalls, fromArchive, mergeCalls, type CallBundle } from "./archive";
import { datedTranscriptRef, transcriptRef, upgradeLegacyTranscript } from "./parse";

const url = "https://ir.example.com/releases/2026-q3.pdf";
const id = "JPM-2026-10-13-abc123";
const bundle: CallBundle = {
  ticker: "JPM",
  generated: "2026-10-14T00:00:00Z",
  docs: { one: { url, fiscal_label: "Q3 FY26" } },
  calls: [
    {
      call_id: id,
      ticker: "JPM",
      doc: "one",
      date: "2026-10-13",
      kind: "transcript",
      event_type: "earnings",
      label: null,
      sha: "v1",
      speakers: [
        {
          idx: 8,
          name: "Jane Doe",
          role: "CEO",
          firm: null,
          kind: "management",
          turns: 1,
          words: 3,
        },
        {
          idx: 2,
          name: "Sam Analyst",
          role: null,
          firm: "Research",
          kind: "analyst",
          turns: 1,
          words: 2,
        },
      ],
    },
  ],
};
describe("stored earnings calls", () => {
  it("dates the call from its explicit date section instead of a later publication", () => {
    const url =
      "https://www.fool.com/earnings/call-transcripts/2026/07/22/jpmorgan-chase-jpm-q2-2026-earnings-call-transcript";
    expect(
      datedTranscriptRef(url, "## DATE\n\nTuesday, July 14, 2026 at 8:30 a.m. ET"),
    ).toMatchObject({ date: "2026-07-14", publishedDate: "2026-07-22", dateBasis: "event" });
    expect(datedTranscriptRef(url, "## DATE\n\nAugust 14, 2026")).toMatchObject({
      date: "2026-07-22",
      dateBasis: "published",
    });
  });
  it("only accepts the issuer, event, document and call ID recorded in the index", () => {
    const c = bundle.calls[0];
    for (const change of [
      { ticker: "BAC" },
      { event_type: "conference" },
      { doc: "missing" },
      { call_id: "BAC-2026-10-13-abc123" },
      { call_id: id + "/x" },
      { date: "2025-01-01" },
    ]) {
      expect(archivedCalls({ ...bundle, calls: [{ ...c, ...change }] }, "JPM")).toEqual([]);
    }
    expect(archivedCalls(bundle, "BAC")).toEqual([]);
  });
  it("skips an event date contradicted by both the filed quarter and the dated 8-K exhibit", () => {
    const c = {
      ...bundle.calls[0],
      date: "2025-04-09",
      call_id: "JPM-2025-04-09-abc123",
      label: "Q4 FY25",
      title: "8-K 2025-05-28 q1fy26cfocommentary.htm",
    };
    expect(
      archivedCalls(
        { ...bundle, docs: { one: { url, fiscal_label: "Q1 FY26" } }, calls: [c] },
        "JPM",
      ),
    ).toEqual([]);
  });
  it("restores exact text and actual speaker indexes, refuses cross-call or incomplete turn files", () => {
    const [r] = archivedCalls(bundle, "JPM");
    const file = {
      call_id: id,
      turns: [
        { i: 0, sp: 8, sec: "prepared", x: "Revenue rose today.", w: 3 },
        { i: 1, sp: 2, sec: "qa", x: "By how much?", w: 3 },
      ],
    };
    const t = fromArchive("JPM", "JPMorgan", r, file)!;
    expect([t.date, t.fq, t.fy, t.words, t.qaStart, t.turns[0].text, t.turns[1].speaker]).toEqual([
      "2026-10-13",
      3,
      2026,
      6,
      1,
      "Revenue rose today.",
      "Sam Analyst",
    ]);
    expect(fromArchive("JPM", "JPMorgan", r, { ...file, call_id: "other" })).toBeNull();
    expect(
      fromArchive("JPM", "JPMorgan", r, { ...file, turns: [{ ...file.turns[0], sp: 90 }] }),
    ).toBeNull();
  });
  it("prefers a complete transcript over remarks from the same quarter", () => {
    const [r] = archivedCalls(bundle, "JPM");
    const published = transcriptRef(
      "https://www.fool.com/earnings/call-transcripts/2026/10/14/jpmorgan-chase-jpm-q3-2026-earnings-call-transcript",
    );
    expect(mergeCalls([r], [published])[0].url).toBe(url);
    expect(mergeCalls([{ ...r, archiveKind: "remarks" }], [published])[0].url).toBe(published.url);
  });
  it("treats formerly guessed roles as unverified and preserves the exact stored text", () => {
    const [r] = archivedCalls(bundle, "JPM");
    const old = fromArchive("JPM", "JPMorgan", r, {
      call_id: id,
      turns: [
        { i: 0, sp: 8, sec: "prepared", x: "Our quarterly revenue was unchanged.", w: 5 },
        { i: 1, sp: 2, sec: "qa", x: "When will inventory decline?", w: 4 },
      ],
    })!;
    old.speakers[1].role = "Analyst";
    old.turns[1].kind = "management";
    const t = upgradeLegacyTranscript(old);
    expect(t.turns[1].kind).toBe("analyst");
    expect(t.turns.map((x) => x.text)).toEqual(old.turns.map((x) => x.text));
  });
});
