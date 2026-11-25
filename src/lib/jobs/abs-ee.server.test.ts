import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ABS_WATCH } from "@/lib/abs/watch";
import { ABS_JOB_FILE_LIMIT, runAbsEe, type AbsJobIo } from "./abs-ee.server";

const HEADER = readFileSync("src/test/fixtures/abs/abs-ee.hdr.sgml", "utf8");
const INDEX = readFileSync("src/test/fixtures/abs/abs-ee-index.htm", "utf8");
const XML = readFileSync("src/test/fixtures/abs/cmbs-ex102-excerpt.xml", "utf8");
const SUBMISSIONS = readFileSync("src/test/fixtures/abs/submissions.json", "utf8");
const A = "0001888524-24-009544";
const FOLDER = "https://www.sec.gov/Archives/edgar/data/2017898/000188852424009544/";
const WATCH = [
  { cik: 2017898, name: "BANK5 Trust 2024-5YR6", from: "2024-06-01" },
  { cik: 1752363, name: "DBGS 2018-C1 Mortgage Trust" },
];

type Call = { fn: string; args: Record<string, unknown> };
class SecError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function io(
  o: {
    claim?: unknown;
    files?: Record<string, string | Error>;
    rpcError?: string;
    cursor?: number;
    left?: number;
  } = {},
) {
  const calls: Call[] = [];
  const gets: string[] = [];
  let cursor = o.cursor ?? 0;
  const files: Record<string, string | Error> = {
    [`${FOLDER}${A}.hdr.sgml`]: HEADER,
    [`${FOLDER}${A}-index.htm`]: INDEX,
    [`${FOLDER}exh_102.xml`]: XML,
    "https://data.sec.gov/submissions/CIK0002017898.json": SUBMISSIONS,
    ...o.files,
  };
  const it: AbsJobIo = {
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      calls.push({ fn, args });
      if (o.rpcError && fn === o.rpcError) throw new Error(`${fn}: connection refused`);
      if (fn === "abs_claim_next") return (o.claim ?? null) as T;
      if (fn === "abs_register_filings")
        return { listed: (args._rows as unknown[]).length, known: 0 } as T;
      if (fn === "abs_store_filing") return { skip: false, current: true } as T;
      return null as T;
    },
    async get(url) {
      gets.push(url);
      const f = files[url];
      if (f instanceof Error) throw f;
      if (f == null) throw new SecError(`SEC EDGAR responded 404 for ${url}`, 404);
      return new TextEncoder().encode(f);
    },
    cursor: async () => cursor,
    setCursor: async (n) => void (cursor = n),
    sha256: async (bytes) => `sha-of-${bytes.length}`,
    now: () => "2026-11-25T00:00:00.000Z",
    left: () => o.left ?? 3000,
  };
  return { io: it, calls, gets, cursor: () => cursor };
}
const CLAIM = { accession: A, list_cik: 2017898, attempt: 1 };

describe("abs-ee scheduled run", () => {
  it("asks for the next filing of the watched CIKs, with each CIK's first wanted day", async () => {
    const t = io();
    await runAbsEe(t.io, WATCH);
    expect(t.calls[0]).toEqual({
      fn: "abs_claim_next",
      args: {
        _watch: [
          { cik: 2017898, from: "2024-06-01" },
          { cik: 1752363, from: null },
        ],
        _max_attempts: 3,
      },
    });
  });

  it("stores a claimed filing in one call: header, document list and asset file read from SEC", async () => {
    const t = io({ claim: CLAIM });
    const r = await runAbsEe(t.io, WATCH);
    expect(t.gets).toEqual([
      `${FOLDER}${A}.hdr.sgml`,
      `${FOLDER}${A}-index.htm`,
      `${FOLDER}exh_102.xml`,
    ]);
    expect(t.calls.map((c) => c.fn)).toEqual(["abs_claim_next", "abs_store_filing"]);
    const a = t.calls[1].args;
    expect(a).toMatchObject({
      _accession: A,
      _parser: "abs-1",
      _sha256: `sha-of-${new TextEncoder().encode(XML).length}`,
      _bytes: new TextEncoder().encode(XML).length,
    });
    expect(a._filing).toMatchObject({
      deal_id: "0002017898",
      family: "cmbs",
      period_end: "2024-06-17",
      asset_class: "Commercial mortgages",
      header_sha256: `sha-of-${new TextEncoder().encode(HEADER).length}`,
    });
    const rows = a._rows as Record<string, unknown[]>;
    expect([rows.cmbs_assets.length, rows.cmbs_properties.length]).toEqual([6, 6]);
    expect(a._expect).toMatchObject({
      cmbs_assets: 6,
      cmbs_properties: 6,
      records: 6,
      metrics: rows.metrics.length,
    });
    expect(
      (a._documents as { doc_type: string; sha256?: string; retrieved_at?: string }[]).find(
        (d) => d.doc_type === "EX-102",
      ),
    ).toMatchObject({ records: 6, retrieved_at: "2026-11-25T00:00:00.000Z" });
    expect(r).toEqual({
      ok: true,
      items: 1,
      detail: {
        accession: A,
        cik: 2017898,
        attempt: 1,
        outcome: "stored",
        period: "2024-06-17",
        records: 6,
        bytes: new TextEncoder().encode(XML).length,
      },
    });
  });

  it("notes on the filing why there is nothing to store, and the run is fine", async () => {
    const t = io({
      claim: CLAIM,
      files: { [`${FOLDER}${A}-index.htm`]: INDEX.replace("EX-102", "EX-99") },
    });
    const r = await runAbsEe(t.io, WATCH);
    expect(t.calls.at(-1)).toEqual({
      fn: "abs_mark_filing",
      args: { _accession: A, _status: "skipped", _detail: "no EX-102 asset data file" },
    });
    expect(r).toMatchObject({
      ok: true,
      items: 0,
      detail: { skipped: "no EX-102 asset data file" },
    });
    expect(t.gets.length).toBe(2);
  });

  it("does not fetch an asset file over its size limit; the filing is left for the script", async () => {
    const big = String(ABS_JOB_FILE_LIMIT + 1);
    const t = io({
      claim: CLAIM,
      files: { [`${FOLDER}${A}-index.htm`]: INDEX.replace(">345077<", `>${big}<`) },
    });
    const r = await runAbsEe(t.io, WATCH);
    expect(t.gets.length).toBe(2);
    expect(t.calls.at(-1)).toMatchObject({ fn: "abs_mark_filing", args: { _status: "failed" } });
    expect(String(t.calls.at(-1)?.args._detail)).toMatch(
      /over the scheduled run's limit; store it with scripts\/abs-ee\.ts/,
    );
    expect(r.ok).toBe(true);
  });

  it("records a filing it cannot read as failed on the filing, not as a failed run", async () => {
    const t = io({ claim: CLAIM, files: { [`${FOLDER}exh_102.xml`]: XML.slice(0, 5000) } });
    const r = await runAbsEe(t.io, WATCH);
    expect(t.calls.at(-1)).toMatchObject({
      fn: "abs_mark_filing",
      args: { _accession: A, _status: "failed" },
    });
    expect(String(t.calls.at(-1)?.args._detail)).toMatch(/not well-formed XML/);
    expect(r).toMatchObject({ ok: true, items: 0, detail: { outcome: "filing failed" } });
    expect(t.calls.some((c) => c.fn === "abs_store_filing")).toBe(false);
    // a missing file on SEC is the filing's problem too
    const gone = io({
      claim: CLAIM,
      files: { [`${FOLDER}exh_102.xml`]: new SecError("SEC EDGAR responded 404 for x", 404) },
    });
    expect(await runAbsEe(gone.io, WATCH)).toMatchObject({
      ok: true,
      detail: { outcome: "filing failed" },
    });
  });

  it("gives the attempt back when SEC throttles or is down, and stops quietly when the run is out of time", async () => {
    for (const status of [403, 429, 503]) {
      const t = io({
        claim: CLAIM,
        files: {
          [`${FOLDER}${A}.hdr.sgml`]: new SecError(`SEC EDGAR responded ${status} for x`, status),
        },
      });
      const r = await runAbsEe(t.io, WATCH);
      expect(t.calls.at(-1), String(status)).toMatchObject({
        fn: "abs_release_filing",
        args: { _accession: A },
      });
      expect(r).toMatchObject({
        ok: true,
        items: 0,
        detail: { outcome: "SEC unavailable", status },
      });
    }
    const cut = io({
      claim: CLAIM,
      files: {
        [`${FOLDER}exh_102.xml`]: new SecError(
          "SEC EDGAR responded with an error (run budget spent) for x",
          0,
        ),
      },
    });
    const r = await runAbsEe(cut.io, WATCH);
    expect(r).toMatchObject({ ok: true, items: 0, detail: { outcome: "cut" } });
    // the attempt stays counted: nothing is marked or released
    expect(cut.calls.map((c) => c.fn)).toEqual(["abs_claim_next"]);
  });

  it("does not start storing with too little of the run left", async () => {
    const t = io({ claim: CLAIM, left: 500 });
    const r = await runAbsEe(t.io, WATCH);
    expect(r).toMatchObject({ ok: true, items: 0, detail: { outcome: "cut" } });
    expect(t.calls.map((c) => c.fn)).toEqual(["abs_claim_next"]);
  });

  it("fails the run when the database fails, whatever it was doing", async () => {
    await expect(runAbsEe(io({ rpcError: "abs_claim_next" }).io, WATCH)).rejects.toThrow(
      /abs_claim_next: connection refused/,
    );
    await expect(
      runAbsEe(io({ claim: CLAIM, rpcError: "abs_store_filing" }).io, WATCH),
    ).rejects.toThrow(/abs_store_filing: connection refused/);
    const t = io({ claim: CLAIM, rpcError: "abs_store_filing" });
    await runAbsEe(t.io, WATCH).catch(() => undefined);
    expect(t.calls.some((c) => c.fn === "abs_mark_filing")).toBe(false);
    await expect(runAbsEe(io({ rpcError: "abs_register_filings" }).io, WATCH)).rejects.toThrow(
      /connection refused/,
    );
  });

  it("with nothing waiting, lists one watched CIK and moves on only after the listing is stored", async () => {
    const t = io();
    const r = await runAbsEe(t.io, WATCH);
    expect(t.gets).toEqual(["https://data.sec.gov/submissions/CIK0002017898.json"]);
    const reg = t.calls.find((c) => c.fn === "abs_register_filings");
    const rows = reg?.args._rows as { accession: string; filed: string; form: string }[];
    // the fixture lists four ABS-EE filings; the watch entry wants those from 2024-06-01 on
    expect(rows.every((x) => x.form === "ABS-EE" && x.filed >= "2024-06-01")).toBe(true);
    expect(r).toMatchObject({
      ok: true,
      items: rows.length,
      detail: { listing: 2017898, at: 0, of: 2, new: rows.length },
    });
    expect(t.cursor()).toBe(1);
    const failed = io({ rpcError: "abs_register_filings" });
    await runAbsEe(failed.io, WATCH).catch(() => undefined);
    expect(failed.cursor()).toBe(0);
    // SEC down: same CIK next time, run is fine
    const down = io({
      files: {
        "https://data.sec.gov/submissions/CIK0002017898.json": new SecError(
          "SEC EDGAR responded 503 for x",
          503,
        ),
      },
    });
    expect(await runAbsEe(down.io, WATCH)).toMatchObject({
      ok: true,
      detail: { outcome: "SEC unavailable" },
    });
    expect(down.cursor()).toBe(0);
  });

  it("rotates through the watch list from any cursor", async () => {
    const t = io({
      cursor: 7,
      files: { "https://data.sec.gov/submissions/CIK0001752363.json": SUBMISSIONS },
    });
    const r = await runAbsEe(t.io, WATCH);
    expect(r.detail).toMatchObject({ listing: 1752363, at: 1 });
    expect(t.cursor()).toBe(2);
    expect(await runAbsEe(io().io, [])).toEqual({
      ok: true,
      items: 0,
      detail: { note: "nothing is watched" },
    });
  });

  it("watches real CIKs once each, with a first day where history is not wanted", () => {
    expect(new Set(ABS_WATCH.map((w) => w.cik)).size).toBe(ABS_WATCH.length);
    expect(ABS_WATCH.length).toBeGreaterThan(30);
    for (const w of ABS_WATCH) {
      expect(Number.isInteger(w.cik) && w.cik > 0, String(w.cik)).toBe(true);
      expect(w.name.length).toBeGreaterThan(3);
      if (w.from) expect(w.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(ABS_WATCH.filter((w) => !w.from).map((w) => w.cik)).toEqual([1752363]);
  });
});
