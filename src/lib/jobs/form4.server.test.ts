/**
 * The Form 4 repair pass on an in-memory database shaped like the 20 Nov 2026 gap: a burst of 18
 * same-day Form 4s (THG, 28 Sep) discovered weeks late, one already parsed, one with only a
 * derivative line, one PEG filing, and a filing whose XML fails.
 */
import { describe, expect, it } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import { repairForm4, storeForm4 } from "./form4.server";
import { form4Todo, FORM4_REPAIR_KEY, failReceipt, parseRepairDay } from "./form4-repair";

const nonDerivative = (owner: string, code = "S") => `<?xml version="1.0"?><ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>${owner}</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>1</isDirector></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable><nonDerivativeTransaction><securityTitle><value>Common Stock</value></securityTitle><transactionDate><value>2026-09-25</value></transactionDate><transactionCoding><transactionCode>${code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>100</value></transactionShares><transactionPricePerShare><value>50.5</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>${code === "P" ? "A" : "D"}</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>900</value></sharesOwnedFollowingTransaction></postTransactionAmounts><ownershipNature><directOrIndirectOwnership><value>D</value></directOrIndirectOwnership></ownershipNature></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`;
const derivativeOnly = `<?xml version="1.0"?><ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>DOE JANE</rptOwnerName></reportingOwnerId></reportingOwner><derivativeTable><derivativeTransaction><securityTitle><value>RSU</value></securityTitle></derivativeTransaction></derivativeTable></ownershipDocument>`;

function seed() {
  const filings: Record<string, unknown>[] = [];
  for (let i = 0; i < 18; i++) filings.push({ accn: `0001193125-26-4053${String(i).padStart(2, "0")}`, ticker: "THG", cik: "944695", form: "4", filed: "2026-09-28", report: "2026-09-25", doc: "xslF345X06/ownership.xml", discovered_at: "2026-11-06T22:48:01Z" });
  filings.push({ accn: "0001225208-26-008099", ticker: "PEG", cik: "788784", form: "4", filed: "2026-10-02", report: null, doc: "xslF345X06/doc4.xml", discovered_at: "2026-11-06T09:06:02Z" });
  filings.push({ accn: "0001225208-26-009999", ticker: "PEG", cik: "788784", form: "10-Q", filed: "2026-10-02", report: null, doc: "q.htm" });
  filings.push({ accn: "0001628280-26-074544", ticker: "AXON", cik: "1069183", form: "4", filed: "2026-11-17", report: null, doc: "xslF345X06/wk-form4_1794951638.xml" });
  return fakeSupabase({
    sec_filings: filings,
    insider_trades: [{ accn: "0001193125-26-405300", seq: 0, ticker: "THG" }],
    job_state: [],
  });
}

function fetcher(fail: Set<string> = new Set(), refuse = false) {
  const urls: string[] = [];
  const fetchText = async (url: string) => {
    urls.push(url);
    if (refuse) throw Object.assign(new Error("SEC EDGAR responded 429"), { status: 429 });
    const accn = url.split("/")[7];
    if ([...fail].some((a) => a.replace(/-/g, "") === accn)) throw new Error("Invalid ownership XML");
    if (accn.endsWith("405317")) return derivativeOnly;
    return nonDerivative(`OWNER${accn.slice(-2)} PAT`, accn.endsWith("405301") ? "P" : "S");
  };
  return { fetchText, urls };
}

const run = (db: ReturnType<typeof seed>, f: ReturnType<typeof fetcher>, extra: Partial<Parameters<typeof repairForm4>[1]> = {}) =>
  repairForm4(db.client, { deadline: Date.now() + 60_000, floor: "2026-01-01", sleep: async () => undefined, fetchText: f.fetchText, ...extra });

describe("Form 4 repair pass", () => {
  it("fills every unread Form 4 already in sec_filings, newest day first, without re-reading parsed ones", async () => {
    const db = seed();
    const f = fetcher();
    const r = await run(db, f);
    expect(r).toMatchObject({ stored: 18, empty: 1, failed: 0, wrapped: true, stop: null });
    const traded = new Set((db.tables.insider_trades as { accn: string }[]).map((t) => t.accn));
    expect(traded.size).toBe(19);
    expect(traded.has("0001193125-26-405317")).toBe(false);
    // the derivative-only filing is recorded where both readers look
    expect(db.state("form4-seen:0001193125-26-405317")).toBeTruthy();
    expect(f.urls.some((u) => u.includes("119312526405300"))).toBe(false);
    expect(f.urls[0]).toBe("https://www.sec.gov/Archives/edgar/data/1069183/000162828026074544/wk-form4_1794951638.xml");
    // the 10-Q is not a Form 4
    expect(f.urls.some((u) => u.includes("000122520826009999"))).toBe(false);
    // the purchase also feeds insider_buys
    expect((db.tables.insider_buys ?? []).some((b) => (b as { accn: string }).accn === "0001193125-26-405301")).toBe(true);
  });
  it("is idempotent: a second lap fetches nothing, including the filing known to carry no non-derivative transaction", async () => {
    const db = seed();
    await run(db, fetcher());
    const again = fetcher();
    const r = await run(db, again);
    expect(again.urls).toEqual([]);
    expect(r).toMatchObject({ stored: 0, empty: 0 });
  });
  it("is bounded per run and resumes from the held day", async () => {
    const db = seed();
    const r1 = await run(db, fetcher(), { maxFetch: 5 });
    expect(r1.stored + r1.empty).toBe(5);
    expect(parseRepairDay(db.state(FORM4_REPAIR_KEY)!.paused_reason)).toBe("2026-09-28");
    const r2 = await run(db, fetcher(), { maxFetch: 50 });
    expect(r1.stored + r1.empty + r2.stored + r2.empty).toBe(19);
  });
  it("holds the day on an SEC refusal and charges nothing", async () => {
    const db = seed();
    const r = await run(db, fetcher(new Set(), true));
    expect(r.stop).toMatch(/SEC refused/);
    expect(parseRepairDay(db.state(FORM4_REPAIR_KEY)!.paused_reason)).toBe("2026-11-17");
    expect((db.tables.job_state as { job: string }[]).some((x) => x.job.startsWith("form4-fail:") || x.job.startsWith("form4-seen:"))).toBe(false);
  });
  it("retries a failing filing on later runs, keeps the cursor on its day, and gives up after 3 tries", async () => {
    const db = seed();
    const bad = new Set(["0001225208-26-008099"]);
    for (let i = 1; i <= 3; i++) {
      const r = await run(db, fetcher(bad));
      expect(r.failed).toBe(1);
      expect(db.state("form4-fail:0001225208-26-008099")!.cursor).toBe(i);
      if (i < 3) expect(parseRepairDay(db.state(FORM4_REPAIR_KEY)!.paused_reason)).toBe("2026-10-02");
    }
    expect(db.state("form4-fail:0001225208-26-008099")!.paused_reason).toMatch(/^gave up: Invalid ownership XML/);
    const after = fetcher(bad);
    await run(db, after);
    expect(after.urls).toEqual([]);
  });
});

describe("Form 4 repair decisions", () => {
  it("skips traded, seen and given-up filings", () => {
    const rows = ["b", "a", "c", "d"].map((accn) => ({ accn, ticker: "X", cik: "1", filed: "2026-10-01", report: null, doc: "x.xml" }));
    expect(form4Todo(rows, new Set(["c"]), new Set(["d"]), new Map([["b", 3]])).map((r) => r.accn)).toEqual(["a"]);
    expect(failReceipt("a", 2, "boom", 0)).toMatchObject({ cursor: 3, paused_reason: "gave up: boom" });
  });
  it("the walk and the repair pass share one reader", async () => {
    const db = seed();
    const f = fetcher();
    const r = await storeForm4(db.client, { accn: "0001225208-26-008099", ticker: "PEG", cik: "788784", filed: "2026-10-02", report: null, doc: "xslF345X06/doc4.xml" }, { fetchText: f.fetchText });
    expect(r).toEqual({ trades: 1, empty: false });
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/jobs/jobs.server.ts", "utf8")).toMatch(/await storeForm4\(supabaseAdmin, \{ accn: f\.accn, ticker: c\.ticker, cik: f\.cik/);
  });
});
