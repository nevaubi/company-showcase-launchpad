import { describe, expect, it } from "vitest";
import { completeIssuerTurns, verifiedIssuerCall } from "./issuer-mirror.server";
import type { ArchiveCall, CallBundle, TurnFile } from "./archive";

const call: ArchiveCall = {
  ticker: "C",
  date: "2026-10-13",
  call_id: "C-2026-10-13-abc123",
  doc: "aa",
  sha: "a".repeat(64),
  kind: "remarks",
  event_type: "earnings",
  label: "Q3 FY26",
  n_turns: 2,
  words: 4,
  speakers: [
    {
      idx: 0,
      name: "Management remarks",
      kind: "management",
      firm: null,
      role: null,
      turns: 2,
      words: 4,
    },
  ],
};
const bundle: CallBundle = {
  ticker: "C",
  generated: "2026-10-14",
  docs: { aa: { url: "https://www.citigroup.com/remarks.pdf" } },
  calls: [call],
};
const file: TurnFile = {
  call_id: call.call_id,
  turns: [
    { i: 0, sp: 0, sec: "prepared", x: "Deposits increased.", w: 2 },
    { i: 1, sp: 0, sec: "prepared", x: "Funding improved.", w: 2 },
  ],
};
describe("native issuer archive import", () => {
  it("requires a company match, original URL, and complete source text hash", () => {
    expect(verifiedIssuerCall(call, bundle)).toBe(true);
    expect(verifiedIssuerCall({ ...call, ticker: "BAC" }, bundle)).toBe(false);
    expect(verifiedIssuerCall({ ...call, sha: "not-a-hash" }, bundle)).toBe(false);
    expect(verifiedIssuerCall({ ...call, doc: "missing" }, bundle)).toBe(false);
  });
  it("rejects a cross-call file, a missing turn and a speaker outside the recorded roster", () => {
    expect(completeIssuerTurns(call, file)).toBe(true);
    expect(completeIssuerTurns(call, { ...file, call_id: "WFC-2026-10-13-abc123" })).toBe(false);
    expect(completeIssuerTurns(call, { ...file, turns: file.turns.slice(1) })).toBe(false);
    expect(
      completeIssuerTurns(call, { ...file, turns: [{ ...file.turns[0], sp: 5 }, file.turns[1]] }),
    ).toBe(false);
  });
  it("accepts a prepared script undercount only when every speaker's turns and words and the total reconcile", () => {
    const undercount = { ...call, n_turns: 1 };
    expect(completeIssuerTurns(undercount, file)).toBe(true);
    expect(completeIssuerTurns({ ...undercount, words: 5 }, file)).toBe(false);
    expect(completeIssuerTurns({ ...undercount, kind: "transcript" }, file)).toBe(false);
    expect(
      completeIssuerTurns({ ...undercount, speakers: [{ ...call.speakers[0], words: 3 }] }, file),
    ).toBe(false);
  });
});
