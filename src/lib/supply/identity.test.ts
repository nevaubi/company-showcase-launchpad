import { describe, expect, it } from "vitest";
import type { SupplyLink } from "./core";
import { counterpartyKey, dedupeCurrent, linkKey, makeLinkKey, nameTickers } from "./identity";

let n = 0;
const link = (p: Partial<SupplyLink> & { amount_usd?: number | null }): SupplyLink & { amount_usd?: number | null } => ({
  id: `l${++n}`,
  ticker: "SNDK",
  counterparty: "Kioxia",
  counterparty_ticker: null,
  counterparty_domain: null,
  relation: "supplier",
  detail: "",
  share_pct: null,
  quote: "",
  accn: "k1",
  doc: "d.htm",
  form: "10-K",
  filed: "2026-02-20",
  ...p,
});

describe("linkKey", () => {
  it("merges corporate suffixes and known aliases", () => {
    expect(linkKey(link({ counterparty: "Kioxia" }))).toBe(linkKey(link({ counterparty: "Kioxia Corporation" })));
    expect(linkKey(link({ counterparty: "TSMC" }))).toBe(linkKey(link({ counterparty: "Taiwan Semiconductor Manufacturing Company Limited" })));
  });
  it("keeps relation and filer apart", () => {
    expect(linkKey(link({ relation: "supplier" }))).not.toBe(linkKey(link({ relation: "customer" })));
    expect(linkKey(link({ ticker: "WDC" }))).not.toBe(linkKey(link({ ticker: "SNDK" })));
  });
  it("gives a name the ticker another row of the same filer gives it", () => {
    const rows = [link({ ticker: "AN", counterparty: "Volkswagen", relation: "partner" }), link({ ticker: "AN", counterparty: "Volkswagen AG", counterparty_ticker: "VWAGY", relation: "partner" })];
    const key = makeLinkKey(rows);
    expect(key(rows[0])).toBe(key(rows[1]));
    expect(key(rows[0])).toBe("AN|partner|VWAGY");
  });
  it("uses another filer's ticker only when every row agrees", () => {
    const agree = nameTickers([link({ ticker: "A", counterparty: "Acme", counterparty_ticker: "ACME" }), link({ ticker: "B", counterparty: "Acme Inc.", counterparty_ticker: "ACME" })]);
    expect(counterpartyKey(link({ ticker: "C", counterparty: "Acme" }), agree)).toBe("ACME");
    const clash = nameTickers([link({ ticker: "A", counterparty: "Acme", counterparty_ticker: "ACME" }), link({ ticker: "B", counterparty: "Acme", counterparty_ticker: "ACMX" })]);
    expect(counterpartyKey(link({ ticker: "C", counterparty: "Acme" }), clash)).toBe("acme");
    // the filer's own rows win over a clash elsewhere
    const own = nameTickers([link({ ticker: "C", counterparty: "Acme", counterparty_ticker: "ACMX" }), link({ ticker: "A", counterparty: "Acme", counterparty_ticker: "ACME" })]);
    expect(counterpartyKey(link({ ticker: "C", counterparty: "Acme" }), own)).toBe("ACMX");
  });
});

describe("dedupeCurrent", () => {
  it("counts a link stated in both the 10-K and the 10-Q once, keeping the newest filing", () => {
    const k = link({ accn: "k1", form: "10-K", filed: "2026-02-20", amount_usd: 1.2e9 });
    const q = link({ accn: "q1", form: "10-Q", filed: "2026-05-01", counterparty: "Kioxia Corporation" });
    const other = link({ counterparty: "Western Digital", accn: "k1" });
    const out = dedupeCurrent([k, other, q]);
    expect(out).toHaveLength(2);
    expect(out[0].id).toBe(q.id);
    expect(out[0].corroboration.map((c) => c.id)).toEqual([k.id]);
    expect(out[1]).toMatchObject({ id: other.id, corroboration: [] });
  });
  it("on the same date keeps the row that states more, then the lower id", () => {
    const a = link({ id: "b", filed: "2026-05-01", accn: "q1", form: "10-Q" });
    const b = link({ id: "c", filed: "2026-05-01", accn: "k2", form: "10-K", share_pct: 14 });
    expect(dedupeCurrent([a, b])[0].id).toBe("c");
    const c = link({ id: "z", filed: "2026-05-01", accn: "q1" });
    const d = link({ id: "a", filed: "2026-05-01", accn: "k2" });
    expect(dedupeCurrent([c, d])[0].id).toBe("a");
  });
  it("leaves distinct links alone", () => {
    const rows = [link({ counterparty: "Kioxia" }), link({ counterparty: "Kioxia", relation: "partner" }), link({ counterparty: "Micron" })];
    expect(dedupeCurrent(rows).map((r) => r.id)).toEqual(rows.map((r) => r.id));
  });
});

describe("dedupeCurrent carries figures only an older copy states (review C8)", () => {
  it("keeps the newest row and lends it the 10-K's share, amount and flag with their source", () => {
    const k = { ...link({ id: "k", accn: "k1", form: "10-K", filed: "2026-02-10", ticker: "MAS", relation: "customer", counterparty: "The Home Depot", counterparty_ticker: "HD", share_pct: 38, quote: "Sales to The Home Depot were $2.9 billion, 38% of net sales" }), amount_usd: 2.9e9, flow_usd: 2.9e9, amount_kind: "revenue" };
    const q = { ...link({ id: "q", accn: "q1", form: "10-Q", filed: "2026-10-30", ticker: "MAS", relation: "customer", counterparty: "Home Depot", counterparty_ticker: "HD", quote: "Home Depot remains our largest customer" }), amount_usd: null };
    const [out] = dedupeCurrent([k, q]);
    expect(out).toMatchObject({ id: "q", share_pct: 38, amount_usd: 2.9e9, flow_usd: 2.9e9, amount_kind: "revenue" });
    expect(out.figure_from).toEqual({ share: expect.objectContaining({ id: "k", form: "10-K", filed: "2026-02-10" }), amount: expect.objectContaining({ id: "k", quote: k.quote }) });
    // each filing's row still reads as that filing states it
    expect(out.own).toMatchObject({ id: "q", share_pct: null, amount_usd: null });
  });
  it("changes nothing when the newest row states its own figures", () => {
    const k = link({ id: "k2", accn: "k1", form: "10-K", filed: "2026-02-10", share_pct: 20 });
    const q = link({ id: "q2", accn: "q1", form: "10-Q", filed: "2026-10-30", share_pct: 22 });
    const [out] = dedupeCurrent([k, q]);
    expect(out.share_pct).toBe(22);
    expect(out.figure_from).toBeUndefined();
  });
  it("does not resolve a name from a single row elsewhere (review C9)", () => {
    const one = nameTickers([link({ ticker: "AAA", counterparty: "Apex", counterparty_ticker: "APEX" })]);
    expect(counterpartyKey(link({ ticker: "BBB", counterparty: "Apex" }), one)).toBe("apex");
  });
});
