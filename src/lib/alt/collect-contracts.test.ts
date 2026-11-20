import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADAPTERS, altFetch, contractKeywords, MAX_COMPANY_FY_USD, type Co } from "./collect.server";
import { REFRESH_DATASET, refreshOf } from "./contracts";

// KBR as USAspending lists it on 2026-11-20: KBR, INC. and its own-parent units KBR Wyle Services and
// KBR Diego Garcia (names, UEIs and amounts recorded from api.usaspending.gov/api/v2/recipient/).
const P = (name: string, uei: string, amount: number) => ({ id: `${uei}-P`, name, uei, recipient_level: "P", amount });
const SEARCH: Record<string, unknown[]> = {
  KBR: [P("KBR WYLE SERVICES, LLC", "TGPKTMN8YL31", 1302e6), P("KBR, INC.", "VJ3XVZC76HT9", 975e6), { id: "HYBLSJAMM2F4-C", name: "KBR WYLE SERVICES, LLC", uei: "HYBLSJAMM2F4", recipient_level: "C", amount: 807e6 }, P("KBR DIEGO GARCIA, LLC", "F6U3MGTBLM69", 37e6), P("KBRWYLE FAKE LOOKALIKE LLC", "ZZZZKBRZZZZZ", 1e6)],
  TGPKTMN8YL31: [P("KBR WYLE SERVICES, LLC", "TGPKTMN8YL31", 1302e6)],
  F6U3MGTBLM69: [P("KBR DIEGO GARCIA, LLC", "F6U3MGTBLM69", 37e6)],
};
const CHILDREN: Record<string, unknown[]> = {
  TGPKTMN8YL31: [{ recipient_id: "wyle-c1", uei: "HYBLSJAMM2F4", name: "KBR WYLE SERVICES, LLC" }],
  // child lists trimmed to what the test needs (the recorded lists are longer)
  VJ3XVZC76HT9: [{ recipient_id: "svc-c1", uei: "YSQMHRS4HSC5", name: "KBR SERVICES, LLC" }, { recipient_id: "wyle-labs", uei: "WYLELABS0001", name: "WYLE LABORATORIES, INC." }],
  F6U3MGTBLM69: [],
};
const KBR: Co = { ticker: "KBR", name: "KBR", cik: "1357615", sector: "Industrials", industry: "IT Services", reg: { legal: "KBR, INC." } as Co["reg"] };

type Over = (parentId: string) => { status?: number; body?: unknown };
let over: Over;
let failChildren = false;
let calls: string[] = [];

function install() {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    calls.push(url.replace("https://api.usaspending.gov/api/v2/", ""));
    if (url.endsWith("/recipient/")) return json({ results: SEARCH[body.keyword] ?? [] });
    const kids = url.match(/children\/([A-Z0-9]+)\//);
    if (kids) return failChildren ? new Response("", { status: 503 }) : json(CHILDREN[kids[1]] ?? []);
    if (url.includes("spending_over_time")) {
      const r = over(body.filters.recipient_id);
      return r.status ? new Response("", { status: r.status }) : json(r.body);
    }
    if (url.includes("spending_by_award")) return json({ results: [], messages: [] });
    if (url.includes("spending_by_transaction")) {
      const id = body.filters.recipient_id;
      const tx = (n: number, recipient: string, rid: string, uei: string) => ({ "Award ID": `A${n}`, Mod: "0", "Recipient Name": recipient, "Recipient UEI": uei, recipient_id: rid, "Action Date": "2026-10-01", "Transaction Amount": 5e6, "Awarding Agency": "Department of Defense", "Awarding Sub Agency": "Department of the Army", "Transaction Description": "Support", generated_internal_id: `CONT_AWD_${n}`, internal_id: n });
      const results = id === "VJ3XVZC76HT9-P" ? [tx(1, "KBR SERVICES, LLC", "svc-c1", "YSQMHRS4HSC5"), tx(2, "ACME LOGISTICS LLC", "acme", "ACME00000000"), tx(4, "WYLE LABORATORIES, INC.", "wyle-labs", "WYLELABS0001")] : id === "TGPKTMN8YL31-P" ? [tx(3, "KBR WYLE SERVICES, LLC", "wyle-c1", "HYBLSJAMM2F4")] : [];
      return json({ results, page_metadata: { hasNext: false } });
    }
    return new Response("", { status: 404 });
  });
}

const years = (fy: Record<number, number>, messages: string[] = []) => ({ body: { results: Object.entries(fy).map(([y, v]) => ({ time_period: { fiscal_year: y }, aggregated_amount: v })), messages } });

beforeEach(() => {
  altFetch.tries = 1;
  altFetch.timeoutMs = 2000;
  failChildren = false;
  calls = [];
  over = (id) => years(id === "TGPKTMN8YL31-P" ? { 2025: 1.2e9 } : id === "VJ3XVZC76HT9-P" ? { 2025: 0.9e9 } : { 2025: 0.03e9 });
  install();
});
afterEach(() => {
  vi.unstubAllGlobals();
  altFetch.tries = 4;
  altFetch.timeoutMs = 45_000;
});

describe("contracts collector (recorded KBR family, mocked USAspending)", () => {
  it("searches by name and alias UEIs, ties rows to the family and writes a refresh record", async () => {
    expect(contractKeywords(KBR)).toEqual(["KBR"]);
    const rows = await ADAPTERS.contracts(KBR);
    expect(calls.filter((c) => c === "recipient/")).toHaveLength(3);
    const tx = rows.filter((r) => r.uid.startsWith("usatx:"));
    // by name or alias, or as a child the source lists under a parent; ACME (not in the family) is refused
    expect(tx.map((r) => [r.meta!.recipient, r.meta!.tie, r.meta!.parent_uei])).toEqual([
      ["KBR WYLE SERVICES, LLC", "name", "TGPKTMN8YL31"],
      ["KBR SERVICES, LLC", "name", "VJ3XVZC76HT9"],
      ["WYLE LABORATORIES, INC.", "child", "VJ3XVZC76HT9"],
    ]);
    const fy = rows.find((r) => r.uid === "usa:KBR:fy2025")!;
    expect(fy.value).toBeCloseTo(2.13e9);
    expect(fy.meta!.recipients).toEqual(["KBR WYLE SERVICES, LLC", "KBR, INC.", "KBR DIEGO GARCIA, LLC"]);
    const run = refreshOf(rows.find((r) => r.dataset === REFRESH_DATASET)!);
    expect(run?.family).toEqual(["KBR WYLE SERVICES, LLC", "KBR, INC.", "KBR SERVICES, LLC", "WYLE LABORATORIES, INC.", "KBR DIEGO GARCIA, LLC"]);
    expect(run?.parents.map((p) => p.uei)).toEqual(["TGPKTMN8YL31", "VJ3XVZC76HT9", "F6U3MGTBLM69"]);
  });

  it("writes no yearly totals and no refresh record when one parent's totals ignored the filter", async () => {
    over = (id) => (id === "F6U3MGTBLM69-P" ? years({ 2025: 7e11 }, ["The following filters from the request were not used: {'recipient_id'}. See https://api.usaspending.gov/docs/endpoints"]) : years({ 2025: 1e9 }));
    const rows = await ADAPTERS.contracts(KBR);
    expect(rows.filter((r) => r.kind === "series")).toEqual([]);
    expect(rows.some((r) => r.dataset === REFRESH_DATASET)).toBe(false);
    expect(rows.filter((r) => r.uid.startsWith("usatx:"))).toHaveLength(3);
  });

  it("refuses totals no company can reach even when the source does not warn", async () => {
    over = (id) => (id === "VJ3XVZC76HT9-P" ? years({ 2025: 7e11 }) : years({ 2025: 1e9 }));
    const rows = await ADAPTERS.contracts(KBR);
    expect(7e11).toBeGreaterThan(MAX_COMPANY_FY_USD);
    expect(rows.filter((r) => r.kind === "series")).toEqual([]);
    // every call answered, so the collection still counts as a refresh
    expect(rows.some((r) => r.dataset === REFRESH_DATASET)).toBe(true);
  });

  it("does not write a partial year when one parent's call fails", async () => {
    over = (id) => (id === "TGPKTMN8YL31-P" ? { status: 503 } : years({ 2025: 1e9 }));
    const rows = await ADAPTERS.contracts(KBR);
    expect(rows.filter((r) => r.kind === "series")).toEqual([]);
    expect(rows.some((r) => r.dataset === REFRESH_DATASET)).toBe(false);
  });

  it("writes nothing when a children list does not answer", async () => {
    failChildren = true;
    await expect(ADAPTERS.contracts(KBR)).rejects.toThrow(/children list did not answer/);
  });

  it("records a refresh with no parents for a company USAspending does not list", async () => {
    const rows = await ADAPTERS.contracts({ ...KBR, ticker: "ROG", name: "Rogers", reg: { legal: "ROGERS CORP" } as Co["reg"] });
    expect(rows.map((r) => r.dataset)).toEqual([REFRESH_DATASET]);
    expect(refreshOf(rows[0])?.parents).toEqual([]);
  });
});
