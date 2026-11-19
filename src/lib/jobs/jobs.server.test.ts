import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ from: vi.fn(), fetchYahoo: vi.fn(), pool: vi.fn(), fetchSec: vi.fn() }));
vi.mock("@/lib/sec.server", () => ({ fetchSec: mocks.fetchSec, archiveUrl: (_cik: string, accn: string, doc: string) => `${accn}/${doc}` }));
vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: mocks.from } }));
vi.mock("@/lib/market-data.server", () => ({
  fetchYahoo: mocks.fetchYahoo, pool: mocks.pool, toBars: () => [],
  fetchCboeDaily: vi.fn(), fetchFred: vi.fn(), fetchNasdaqDaily: vi.fn(), fetchTreasury: vi.fn(),
  isCboeIndex: () => false, isTreasurySeries: () => false,
}));
import { runJob } from "./jobs.server";

describe("scheduled job ledger retention", () => {
  beforeEach(() => vi.clearAllMocks());
  it("never deletes job_runs when the prices cursor wraps", async () => {
    const deletes: string[] = [];
    mocks.from.mockImplementation((table: string) => {
      const q: Record<string, unknown> = {};
      for (const method of ["insert", "select", "eq", "update", "upsert", "lt"]) q[method] = vi.fn(() => q);
      q.delete = vi.fn(() => { deletes.push(table); return q; });
      q.single = async () => ({ data: { id: 1 } });
      q.maybeSingle = async () => ({ data: { cursor: 1860 } });
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve);
      return q;
    });
    mocks.pool.mockImplementation(async (batch: unknown[]) => batch.map(() => ({ status: "fulfilled", value: 0 })));
    expect((await runJob("prices")).ok).toBe(true);
    expect(deletes).toEqual(["market_bars"]);
    expect(deletes).not.toContain("job_runs");
  });
});

describe("Form 4 scheduled parsing", () => {
  beforeEach(() => vi.clearAllMocks());
  async function pass(forms: string[], documents: string[], knownReceipts: string[] = []) {
    const writes: { table: string; value: unknown }[] = [];
    mocks.from.mockImplementation((table: string) => {
      const q: Record<string, unknown> = {};
      for (const method of ["insert", "select", "eq", "update", "gte", "in"]) q[method] = vi.fn(() => q);
      q.upsert = vi.fn((value: unknown) => { writes.push({ table, value }); return q; });
      q.single = async () => ({ data: { id: 1 } });
      q.maybeSingle = async () => ({ data: { cursor: 0 } });
      q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null, data: table === "job_state" ? knownReceipts.map(job => ({ job })) : [] }).then(resolve);
      return q;
    });
    let company = 0;
    mocks.fetchSec.mockImplementation(async (url: string) => {
      if (url.includes("submissions")) {
        const active = company++ === 0;
        return { json: async () => ({ filings: { recent: {
          accessionNumber: active ? forms.map((_, i) => `accn-${i}`) : [], form: forms,
          filingDate: forms.map(() => new Date().toISOString().slice(0, 10)), reportDate: [],
          primaryDocument: forms.map((_, i) => `file-${i}.xml`), primaryDocDescription: [], items: [], isInlineXBRL: [], size: [],
        } } }) };
      }
      const index = Number(url.match(/file-(\d+)/)?.[1]);
      if (documents[index] === "error") throw new Error("bad filing");
      return { text: async () => documents[index] };
    });
    const result = await runJob("sec");
    return { writes, result };
  }
  const common = '<ownershipDocument><nonDerivativeTransaction><transactionAmounts><transactionShares><value>25</value></transactionShares></transactionAmounts></nonDerivativeTransaction></ownershipDocument>';
  const derivative = '<ownershipDocument><derivativeTransaction></derivativeTransaction></ownershipDocument>';
  it("includes 4/A amendments", async () => {
    const { writes } = await pass(["4/A"], [common]);
    expect(writes.find(x => x.table === "insider_trades")?.value).toMatchObject([{ accn: "accn-0", shares: 25 }]);
  });
  it("receipts derivative-only filings without inventing insider trades", async () => {
    const { writes } = await pass(["4"], [derivative]);
    expect(writes).toContainEqual({ table: "job_state", value: expect.objectContaining({ job: "form4-seen:accn-0", cursor: 0 }) });
    expect(writes.some(x => x.table === "insider_trades")).toBe(false);
  });
  it("already-receipted filings do not occupy the two parsing slots", async () => {
    const { writes } = await pass(["4", "4", "4/A"], [derivative, derivative, common], ["form4-seen:accn-0", "form4-seen:accn-1"]);
    expect(writes.find(x => x.table === "insider_trades")?.value).toMatchObject([{ accn: "accn-2" }]);
  });
  it("continues after one filing fails and leaves it unreceipted for retry", async () => {
    const { writes, result } = await pass(["4", "4/A"], ["error", common]);
    expect(writes.find(x => x.table === "insider_trades")?.value).toMatchObject([{ accn: "accn-1" }]);
    expect(result.detail.errors).toEqual([expect.stringContaining("accn-0: bad filing")]);
    expect(writes.some(x => x.table === "job_state" && (x.value as { job: string }).job === "form4-seen:accn-0")).toBe(false);
  });
  it("does not mark malformed XML as a successfully parsed empty filing", async () => {
    const { writes, result } = await pass(["4"], ["<html>Error</html>"]);
    expect(result.detail.errors).toEqual([expect.stringContaining("Invalid ownership XML")]);
    expect(writes.some(x => x.table === "job_state" && (x.value as { job: string }).job === "form4-seen:accn-0")).toBe(false);
  });
});