import { describe, expect, it } from "vitest";
import { AbsReadError, answerOf, PAGE, readDeal, readMonitor, readPages, type AbsQuery, type AbsReadClient } from "../read.server";

type Row = Record<string, unknown>;
type Call = { table: string; columns: string; filters: string[]; range: [number, number] | null; limit: number | null; head: boolean };

/** An in-memory stand-in for the PostgREST builder that records every query it answers. */
function memoryClient(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  const client: AbsReadClient = {
    from(table) {
      return {
        select(columns, options) {
          const call: Call = { table, columns, filters: [], range: null, limit: null, head: !!options?.head };
          let rows = [...(tables[table] ?? [])];
          const orders: [string, boolean][] = [];
          const q: AbsQuery<unknown> = {
            eq(c, v) {
              call.filters.push(`${c}=eq`);
              rows = rows.filter((r) => r[c] === v);
              return q;
            },
            in(c, vs) {
              call.filters.push(`${c}=in`);
              rows = rows.filter((r) => vs.includes(r[c] as never));
              return q;
            },
            not(c, op) {
              call.filters.push(`${c}=not.${op}`);
              if (!c.includes(".")) rows = rows.filter((r) => r[c] != null);
              return q;
            },
            order(c, o) {
              orders.push([c, o?.ascending !== false]);
              return q;
            },
            range(a, b) {
              call.range = [a, b];
              return q;
            },
            limit(n) {
              call.limit = n;
              return q;
            },
            then(ok, fail) {
              calls.push(call);
              const sorted = [...rows].sort((x, y) => {
                for (const [c, asc] of orders) {
                  const a = x[c] as string | number;
                  const b = y[c] as string | number;
                  if (a !== b) return (a < b ? -1 : 1) * (asc ? 1 : -1);
                }
                return 0;
              });
              const win = call.range ? sorted.slice(call.range[0], call.range[1] + 1) : sorted.slice(0, call.limit ?? undefined);
              const value = call.head
                ? { data: null, error: null, count: rows.length }
                : { data: win, error: null, count: null };
              return Promise.resolve(value).then(ok, fail);
            },
          };
          return q;
        },
      };
    },
  };
  return { client, calls };
}

const INDEXED = ["deal_id", "load_id", "status", "list_cik"];

function expectBounded(calls: Call[]) {
  for (const c of calls) {
    expect(c.columns).not.toContain("*");
    if (c.table !== "abs_deals") expect(c.filters.some((f) => INDEXED.includes(f.split("=")[0]))).toBe(true);
    if (!c.head) {
      expect(c.range != null || c.limit != null).toBe(true);
      if (c.range) expect(c.range[1] - c.range[0] + 1).toBeLessThanOrEqual(PAGE);
      if (c.limit != null) expect(c.limit).toBeLessThanOrEqual(PAGE);
    }
  }
}

/** Two auto loan deals: one with three monthly files, one with an offering-stage file and one monthly file. */
function data() {
  const deals: Row[] = [
    { deal_id: "0000000011", issuer_cik: 11, issuer_name: "Alpha Auto Trust 2026-1", file_number: "333-1-01", family: "auto_loan", depositor_cik: 9, sponsor_cik: 8, updated_at: null },
    { deal_id: "0000000012", issuer_cik: 12, issuer_name: "Beta Auto Trust 2026-1", file_number: "333-1-02", family: "auto_loan", depositor_cik: 9, sponsor_cik: 8, updated_at: null },
    { deal_id: "0000000013", issuer_cik: 13, issuer_name: "Gamma CMBS 2026", file_number: null, family: "cmbs", depositor_cik: 7, sponsor_cik: null, updated_at: null },
  ];
  const f = (accession: string, deal: string, load: number, filed: string, end: string, extra: Row = {}): Row => ({
    accession, deal_id: deal, list_cik: 9, form: "ABS-EE", filed, accepted_at: `${filed}T16:00:00+00:00`,
    period_start: null, period_end: end, is_current: true, superseded_by: null, load_id: load, status: "loaded",
    loaded_at: "2026-11-25T10:00:00+00:00", asset_class: "Auto loans", issuer_name: null, depositor_cik: 9, sponsor_cik: 8,
    file_number: null, abs_documents: [{ seq: 2, name: "ex102.xml", url: "https://www.sec.gov/x", bytes: 10, sha256: "a".repeat(64), records: 3, retrieved_at: null }],
    ...extra,
  });
  const filings: Row[] = [
    f("0000000009-26-000001", "0000000011", 1, "2026-08-25", "2026-07-31"),
    f("0000000009-26-000002", "0000000011", 2, "2026-09-25", "2026-08-31"),
    f("0000000009-26-000003", "0000000011", 3, "2026-10-25", "2026-09-30"),
    f("0000000009-26-000004", "0000000012", 4, "2026-09-10", "2026-09-30"),
    f("0000000009-26-000005", "0000000012", 5, "2026-10-25", "2026-09-30"),
    { accession: "0000000009-26-000006", status: "listed", list_cik: 11, deal_id: null },
  ];
  const m = (load: number, metric: string, dim: string, bucket: string, value: string | null, n = 1, n_missing = 0): Row => ({
    load_id: load, accession: `0000000009-26-00000${load}`, deal_id: load <= 3 ? "0000000011" : "0000000012",
    filed: filings.find((x) => x.load_id === load)!.filed, metric, dim, bucket, value, n, n_missing,
  });
  const metrics: Row[] = [];
  for (const [load, end] of [[1, "2026-07-31"], [2, "2026-08-31"], [3, "2026-09-30"], [4, "2026-08-31"], [5, "2026-09-30"]] as const) {
    metrics.push(m(load, "records", "period_end", end, "3", 3));
    metrics.push(m(load, "records", "", "", "3", 3));
    metrics.push(m(load, "end_balance", "", "", "1000"));
    metrics.push(m(load, "end_balance", "delinquency", "current", "900"));
    metrics.push(m(load, "end_balance", "delinquency", "60 to 89 days", String(10 * load)));
    metrics.push(m(load, "end_balance", "delinquency", "30 to 59 days", String(100 - 10 * load)));
    metrics.push(m(load, "charge_offs", "", "", "5"));
    metrics.push(m(load, "end_balance", "state", "CA", "600"));
    metrics.push(m(load, "end_balance", "state", "TX", "400"));
    metrics.push(m(load, "records", "state", "CA", "2"));
    metrics.push(m(load, "payment_to_income", "quantile", "p50", "0.0873"));
  }
  return { abs_deals: deals, abs_filings: filings, abs_pool_metrics_live: metrics };
}

describe("monitor read", () => {
  it("reads in bounded selects and keeps the offering-stage file out of the trend", async () => {
    const { client, calls } = memoryClient(data());
    const p = await readMonitor(client, "auto_loan");
    expectBounded(calls);
    expect(p.deals.map((d) => d.deal_id)).toEqual(["0000000011", "0000000012"]);
    const beta = p.deals[1];
    // 0000000009-26-000004 was filed on 10 Sep for a cover period ending 30 Sep: a pool at cut-off
    expect(beta.offering?.accession).toBe("0000000009-26-000004");
    expect(beta.trend.map(([, a]) => a)).toEqual(["0000000009-26-000005"]);
    const alpha = p.deals[0];
    expect(alpha.trend.map(([end]) => end)).toEqual(["2026-07-31", "2026-08-31", "2026-09-30"]);
    expect(alpha.latest?.split["60 to 89 days"]).toEqual(["30", 1, 0]);
    expect(p.coverage.families.find((f) => f.family === "auto_loan")).toEqual({ family: "auto_loan", deals: 2, filings: 5 });
    expect(p.coverage.listed).toBe(1);
    expect(p.limits).toEqual({ filings_read: 5, filings_total: 5, stage_unread: 0, trend_cut: false });
  });
});

describe("deal read", () => {
  it("reads one deal in bounded selects, the newest monthly file detailed", async () => {
    const { client, calls } = memoryClient(data());
    const p = (await readDeal(client, "0000000012"))!;
    expectBounded(calls);
    expect(p.filings.map((f) => f.accession)).toEqual(["0000000009-26-000005", "0000000009-26-000004"]);
    expect(p.shown).toEqual({ accession: "0000000009-26-000005", offering: false, records_end: "2026-09-30" });
    expect(p.breakdowns.filter((r) => r[1] === "state")).toHaveLength(3);
    expect(p.filings[0].figures?.some((r) => r[0] === "payment_to_income")).toBe(true);
    expect(p.filings[0].file?.sha256).toBe("a".repeat(64));
    expect(await readDeal(client, "0000000099")).toBeNull();
  });
});

describe("paging", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ load_id: i, metric: "m", dim: "", bucket: "" }));
  it("reads every row under the cap and says so", async () => {
    const { client } = memoryClient({ t: rows(2500) });
    const p = await readPages("t", (a, b) => client.from("t").select("load_id").order("load_id").range(a, b), 3000);
    expect(p.rows).toHaveLength(2500);
    expect(p.complete).toBe(true);
  });
  it("stops at the cap and says rows were left", async () => {
    const { client } = memoryClient({ t: rows(3001) });
    const p = await readPages("t", (a, b) => client.from("t").select("load_id").order("load_id").range(a, b), 3000);
    expect(p.rows).toHaveLength(3000);
    expect(p.complete).toBe(false);
  });
  it("knows a read that ends exactly at the cap is whole", async () => {
    const { client } = memoryClient({ t: rows(3000) });
    const p = await readPages("t", (a, b) => client.from("t").select("load_id").order("load_id").range(a, b), 3000);
    expect(p.complete).toBe(true);
  });
});

describe("answers (review int-code N6)", () => {
  it("answers a value, never the database's own text, and names a timeout", async () => {
    expect(await answerOf(async () => 7)).toEqual({ ok: true, data: 7 });
    expect(await answerOf(async () => { throw new AbsReadError("the deal list", { code: "57014", message: "canceling statement due to statement timeout" }); }))
      .toEqual({ ok: false, reason: "timeout", message: "The database stopped the read of the deal list after its time limit." });
    expect(await answerOf(async () => { throw new AbsReadError("the newest load", { code: "42501", message: "permission denied for table abs_loads" }); }))
      .toEqual({ ok: false, reason: "error", message: "The stored filings could not be read (the newest load)." });
    expect(await answerOf(async () => { throw new TypeError("fetch failed"); })).toEqual({ ok: false, reason: "error", message: "The stored filings could not be read." });
  });
});
