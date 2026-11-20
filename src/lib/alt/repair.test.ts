import { describe, expect, it } from "vitest";
import { coverageOf } from "@/lib/coverage";
import { CONTRACTS_RULE, REFRESH_DATASET, tickerKeys, type RefreshMeta } from "./contracts";
import { CONTRACTOR_NAMES, CONTRACTOR_ROWS, COPY_RECIPIENTS, RECORDED_FAMILY } from "./contracts-real.fixture";
import { FDA_FIRMS, SHORT_NAMES, TRIAL_SPONSORS } from "./firms.fixture";
import { firmCheck } from "./firms";
import { COPY_MIN_TICKERS, HELD, KNOWN_OTHER, planRepair, type RepairRow } from "./repair";

// SEC names (submissions files) of the other companies the tests touch
const SEC: Record<string, string> = { PFE: "PFIZER INC", CNC: "CENTENE CORP", WGO: "WINNEBAGO INDUSTRIES INC", GGG: "GRACO INC" };
const keysOf = (t: string) => (CONTRACTOR_NAMES[t] ? tickerKeys(t, CONTRACTOR_NAMES[t].short, CONTRACTOR_NAMES[t].sec) : coverageOf(t) ? tickerKeys(t, coverageOf(t)!.shortName, SEC[t] ?? null) : null);

/** Stored legacy rows of the fixture, one row per stored row. */
function legacyRows(tickers: string[]): RepairRow[] {
  const out: RepairRow[] = [];
  for (const r of CONTRACTOR_ROWS.filter((x) => tickers.includes(x.ticker)))
    for (let i = 0; i < r.n; i++)
      out.push(
        r.kind === "series"
          ? { uid: `usa:${r.ticker}:fy${2008 + i}:${r.recipient.length}`, ticker: r.ticker, dataset: "contracts", kind: "series", meta: { fiscal_year: 2008 + i, recipients: r.recipient.split(";") } }
          : { uid: `usatx:${r.ticker}:${r.recipient}:${i}`, ticker: r.ticker, dataset: "contracts", kind: "event", meta: { recipient: r.recipient } },
      );
  return out;
}

const refreshRecord = (ticker: string, family: string[], asOf = "2026-11-22T04:00:00Z", rule = CONTRACTS_RULE): RepairRow => ({
  uid: `usarun:${ticker}`, ticker, dataset: REFRESH_DATASET, kind: "event",
  meta: { refresh: true, rule, as_of: asOf, parents: [], family } satisfies RefreshMeta as unknown as Record<string, unknown>,
});

// The copied government-wide awards: each of these recipients' awards stored under many companies.
const COPY_TICKERS = ["AAPL", "BA", "LMT", "PFE", "HUM", "CNC", "ROG", "TGT", "GD", "HON"];
function copiedRows(): RepairRow[] {
  return COPY_RECIPIENTS.flatMap((r, i) =>
    Array.from({ length: COPY_MIN_TICKERS + 5 }, (_, j) => (j < COPY_TICKERS.length ? COPY_TICKERS[j] : `ZZ${j}`)).map((t) => ({
      uid: `usa:${t}:CONT_AWD_${i}`, ticker: t, dataset: "contracts", kind: "event", meta: { award_id: `A${i}`, recipient: r.name },
    })),
  );
}

describe("repair part 'copies' (safe at once)", () => {
  it("deletes every copied award except the copy under the company that received it", () => {
    const rows = copiedRows();
    const plan = planRepair(rows, [], keysOf, "2026-11-20");
    const kept = rows.filter((r) => !plan.copies.includes(r)).map((r) => `${r.ticker} ${r.meta!.recipient}`);
    expect(kept.sort()).toEqual([
      "BA THE BOEING COMPANY",
      "CNC HEALTH NET FEDERAL SERVICES, LLC",
      "HUM HUMANA GOVERNMENT BUSINESS INC",
      "LMT LOCKHEED MARTIN CORP",
      "LMT LOCKHEED MARTIN CORPORATION",
      "PFE PFIZER INC",
    ]);
    expect(plan.refreshed).toEqual([]);
  });

  it("leaves an award stored under a few companies and rows the fixed collector tied", () => {
    const few = ["GD", "HON"].map((t) => ({ uid: `usa:${t}:X`, ticker: t, dataset: "contracts", kind: "event", meta: { recipient: "ELECTRIC BOAT CORPORATION" } }));
    const tied = copiedRows().map((r) => ({ ...r, meta: { ...r.meta, tie: "child", as_of: "2026-11-22T00:00:00Z" } }));
    expect(planRepair([...few, ...tied], [], keysOf, "2026-11-20").copies).toEqual([]);
  });

  it("deletes only firms hand-checked as another business, never a refused firm that may be the company's", () => {
    const fda = FDA_FIRMS.map((r) => ({ uid: `fda:${r.ticker}:${r.firm}`, ticker: r.ticker, dataset: "fda", kind: "event", meta: { kind: "device recall", firm: r.firm }, n: r.n }));
    const trials = TRIAL_SPONSORS.map((r) => ({ uid: `ct:${r.ticker}:${r.firm}`, ticker: r.ticker, dataset: "trials", kind: "event", meta: { sponsor: r.firm }, n: r.n }));
    const plan = planRepair([...fda, ...trials], [], keysOf, "2026-11-20");
    const rows = (d: string) => plan.copies.filter((r) => r.dataset === d).reduce((a, r) => a + (r as unknown as { n: number }).n, 0);
    expect(rows("fda")).toBe(64);
    expect(rows("trials")).toBe(109);
    // every listed firm is refused by the rule too, so the screen and the repair agree
    for (const [t, firms] of Object.entries(KNOWN_OTHER.fda)) for (const f of firms) expect(firmCheck(t, tickerKeys(t, SHORT_NAMES[t], null))(f), `${t} ${f}`).toBe(false);
    // refused but not proven another business: hidden, kept
    for (const f of ["Otsuka ICU Medical LLC", "Wipro GE Healthcare Private Ltd.", "Casey's Bakery, Inc"]) expect(plan.copies.some((r) => r.meta!.firm === f)).toBe(false);
    expect(plan.copies.some((r) => r.meta!.sponsor === "Johnson & Johnson Healthcare Products Division of McNEIL-PPC, Inc.")).toBe(false);
  });

  it("keeps Winnebago's own NHTSA campaigns that NHTSA files under a duplicate maker record", () => {
    const wgo = ["13V318000", "12V049000"].map((n) => ({ uid: `nhtsa:WGO:${n}`, ticker: "WGO", dataset: "recalls", kind: "event", meta: {} }));
    const ggg = { uid: "nhtsa:GGG:26C003000", ticker: "GGG", dataset: "recalls", kind: "event", meta: {} };
    expect(planRepair([...wgo, ggg], [], keysOf, "2026-11-20").copies.map((r) => r.uid)).toEqual(["nhtsa:GGG:26C003000"]);
    expect(firmCheck("WGO", tickerKeys("WGO", "Winnebago Industries", null))("redundant Winnebago Industries Inc.")).toBe(true);
  });
});

describe("repair part 'refreshed' (per company, after the fixed collector ran)", () => {
  const tickers = ["GD", "NOC", "HII", "RTX", "ROG", "GOOGL", "AMZN"];
  const rows = legacyRows(tickers);

  it("deletes nothing for a company the fixed collector has not refreshed", () => {
    const plan = planRepair(rows, [], keysOf, "2026-11-20");
    expect(plan.refreshed).toEqual([]);
    expect([...plan.waiting.keys()].sort()).toEqual(["GD", "GOOGL", "HII", "NOC", "ROG", "RTX"]);
  });

  it("ignores refresh records of an older rule or older than --since", () => {
    const recs = [refreshRecord("ROG", [], "2026-11-22T00:00:00Z", 1), refreshRecord("GD", [], "2026-11-19T00:00:00Z")];
    expect(planRepair(rows, recs, keysOf, "2026-11-20").refreshed).toEqual([]);
  });

  it("keeps subsidiaries the refreshed family lists and deletes what nothing ties to the company", () => {
    const recs = ["GD", "NOC", "HII", "RTX", "ROG"].map((t) => refreshRecord(t, RECORDED_FAMILY[t].stored_in_family));
    const plan = planRepair(rows, [...recs, refreshRecord("GOOGL", []), refreshRecord("AMZN", [])], keysOf, "2026-11-20");
    const gone = (t: string) => plan.refreshed.filter((r) => r.ticker === t).length;
    const stored = (t: string) => rows.filter((r) => r.ticker === t).length;
    // GD's GDIT, Electric Boat-era units, NOC's Systems Corporation, HII's units: all kept
    expect([gone("GD"), gone("NOC"), gone("HII")]).toEqual([0, 0, 0]);
    expect([stored("GD"), stored("NOC"), stored("HII")]).toEqual([158, 65, 60]);
    // RTX: the Javelin JV transactions are in RTX's family; the JV's yearly totals are not RTX's
    expect(gone("RTX")).toBe(3);
    // ROG: no Rogers Corporation recipient exists, every stored row is another firm's
    expect(gone("ROG")).toBe(stored("ROG"));
    // AWS rows are AMZN's by alias; Google Public Sector rows are held until checked
    expect(gone("AMZN")).toBe(0);
    expect(gone("GOOGL")).toBe(0);
    expect(HELD.GOOGL).toContain("GOOGLE PUBLIC SECTOR LLC");
  });

  it("never touches a row the fixed collector wrote", () => {
    const fresh = rows.filter((r) => r.ticker === "ROG").map((r) => ({ ...r, meta: { ...r.meta, as_of: "2026-11-22T04:00:00Z", tie: "name" } }));
    expect(planRepair(fresh, [refreshRecord("ROG", [])], keysOf, "2026-11-20").refreshed).toEqual([]);
  });
});
