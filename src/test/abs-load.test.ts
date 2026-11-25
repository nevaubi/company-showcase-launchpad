// One CIK's batch in scripts/abs-ee.ts (scripts/lib/abs-load.ts) with a fake SEC source and a fake
// store. The case is production's (review rev-workers M3): SEC answered 504 three times in 3.5 minutes,
// each answer was counted as an attempt, and filing 0001104659-26-083795 was given up for good.
import { describe, expect, it } from "vitest";
import { SecFetchError } from "@/lib/sec.server";
import type { FilingPayload } from "@/lib/abs/filing";
import { loadFilings, secUnavailable, type LoadIo } from "../../scripts/lib/abs-load";

type Stored = Exclude<FilingPayload, { skip: string }>;
const payload = { filing: { family: "auto_loan" }, counts: { records: 10, metrics: 40 }, bytes: 1000 } as unknown as Stored;
const A = ["0001104659-26-083794", "0001104659-26-083795", "0001104659-26-083796"];

function fakeIo(answers: Record<string, FilingPayload | Error>) {
  const marks: [string, string, string][] = [];
  const read: string[] = [];
  const stored: string[] = [];
  const io: LoadIo = {
    async read(accession) {
      read.push(accession);
      const a = answers[accession] ?? payload;
      if (a instanceof Error) throw a;
      return a;
    },
    async store(accession) {
      stored.push(accession);
      return "stored";
    },
    async mark(accession, status, detail) {
      marks.push([accession, status, detail]);
    },
    log: () => undefined,
  };
  return { io, marks, read, stored };
}
const sec = (status: number) => new SecFetchError(`SEC EDGAR responded ${status || "with an error"} for https://www.sec.gov/Archives/edgar/data/1974820/000110465926083795/exh_102.xml`, status);

describe("an SEC outage is nobody's filing", () => {
  it("does not mark the filing, counts no attempt and stops the batch", async () => {
    const f = fakeIo({ [A[1]]: sec(504) });
    const t = await loadFilings(A, 31, f.io);
    expect(f.stored).toEqual([A[0]]);
    expect(f.read).toEqual([A[0], A[1]]);
    expect(f.marks).toEqual([]);
    expect(t).toMatchObject({ stored: 1, failed: 0, left: 33, sec_unavailable: { status: 504, accession: A[1] } });
  });

  it("treats no answer, 403, 429 and every 5xx alike", () => {
    for (const status of [0, 403, 429, 500, 502, 503, 504]) expect(secUnavailable(sec(status)), String(status)).toBe(status);
    for (const status of [400, 404, 410]) expect(secUnavailable(sec(status)), String(status)).toBeNull();
    expect(secUnavailable(new Error("SEC EDGAR responded 504"))).toBeNull();
    expect(secUnavailable(null)).toBeNull();
  });

  it("still counts what is wrong with a filing: a missing file, a reader error", async () => {
    const f = fakeIo({ [A[0]]: sec(404), [A[1]]: new Error("asset file is not well-formed XML at line 3") });
    const t = await loadFilings(A, 0, f.io);
    expect(f.marks.map(([a, s]) => [a, s])).toEqual([[A[0], "failed"], [A[1], "failed"]]);
    expect(f.stored).toEqual([A[2]]);
    expect(t).toMatchObject({ stored: 1, failed: 2, left: 0 });
    expect(t.sec_unavailable).toBeUndefined();
  });

  it("marks a filing the reader skips with its reason, which counts no attempt", async () => {
    const f = fakeIo({ [A[0]]: { skip: "no EX-102 asset data file" } as FilingPayload });
    const t = await loadFilings([A[0]], 0, f.io);
    expect(f.marks).toEqual([[A[0], "skipped", "no EX-102 asset data file"]]);
    expect(t).toMatchObject({ skipped: 1, stored: 0 });
  });
});
