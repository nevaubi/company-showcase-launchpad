import { afterEach, describe, expect, it, vi } from "vitest";
import { ADAPTERS } from "./collect.server";

const co = (ticker: string, fdic?: number) => ({ ticker, name: ticker, cik: "1", sector: "Financials", industry: "Banks", reg: fdic ? { fdic } : {} });

describe("FDIC call-report collector", () => {
  afterEach(() => vi.unstubAllGlobals());
  const asked = () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify({ data: [{ data: { REPDTE: "20260930", ASSET: 21245166 } }] }), { status: 200 });
    }));
    return urls;
  };
  it("reads the proven bank, never the name-matched one, for a company the mapping covers", async () => {
    const urls = asked();
    const rows = await ADAPTERS.bank(co("MCHB", 29011));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("filters=CERT:1768&");
    expect(rows[0]).toMatchObject({ uid: "fdic:MCHB:ASSET:20260930", meta: { field: "ASSET", cert: 1768 }, value: 21245166000 });
  });
  it("keeps a proven certificate and leaves unmapped companies to the registry", async () => {
    const urls = asked();
    await ADAPTERS.bank(co("JPM"));
    await ADAPTERS.bank(co("MS"));
    expect(urls[0]).toContain("filters=CERT:628&");
    expect(urls[1]).toContain("filters=CERT:32992&");
    expect(await ADAPTERS.bank(co("AAPL"))).toEqual([]);
  });
});
