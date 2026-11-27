import { describe, expect, it, vi } from "vitest";
import { aboutFields } from "./details";
import { issuerLink, reviewedLinks } from "./issuer-directory";
import { snapshotIssuerLinks, snapshotProfileLinks } from "./issuer-directory.seed";

const response = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: () => ({ select: () => ({ eq: (_: string, ticker: string) => ({ eq: (_: string, cik: string) => response.run(ticker, cik) }) }) }) },
}));

import { issuerDirectory, reviewedCompanyDetails } from "./issuer-directory.server";

describe("reviewed issuer links", () => {
  it("withholds the successor's links when ingesting a predecessor's financial history", () => {
    const successor = { ticker: "XOM", cik: "2115436" };
    expect(snapshotProfileLinks(successor, "0000034088")).toEqual({ website: null, ir: null });
    expect(snapshotProfileLinks(successor, "0002115436")).toEqual(snapshotIssuerLinks("XOM", successor.cik));
  });

  it("selects each reviewed field independently and withholds a known wrong link even when the profile contains it", () => {
    const directory = reviewedLinks([{ kind: "ir", status: "withheld", url: null }]);
    const p = { ticker: "EXAMPLE", website: "https://issuer.example/", investorRelations: "https://wrong.example/", description: "", founded: 0 };
    const fields = aboutFields(p, { directory, ir: p.investorRelations });
    expect(fields.website).toBe(p.website);
    expect(fields.ir).toBeNull();
    expect(issuerLink({ website: "https://new.example/" }, "website", p.ticker, p.website)).toBe("https://new.example/");
    expect(issuerLink({}, "ir", "ON", "https://sonal.co.in/investors")).toBeNull();
  });

  it("uses ticker and CIK together, deduplicating simultaneous readers and normalizing leading zeroes", async () => {
    response.run.mockResolvedValue({ data: [{ kind: "website", status: "verified", url: "https://issuer.example/" }], error: null });
    const [a,b] = await Promise.all([issuerDirectory("test", "0000000123"), issuerDirectory("TEST", "123")]);
    expect(a).toEqual({ website: "https://issuer.example/" });
    expect(b).toEqual(a);
    expect(response.run.mock.calls).toEqual([["TEST", "123"]]);
    await issuerDirectory("TEST", "124");
    expect(response.run).toHaveBeenLastCalledWith("TEST", "124");
  });

  it("blocks ticker-only inheritance when the loaded profile has a different registrant", async () => {
    response.run.mockClear();
    const details = await reviewedCompanyDetails("AAPL", "1");
    expect(details.directory).toEqual({ website: null, ir: null });
    expect(response.run).not.toHaveBeenCalled();
  });

  it("keeps an existing review during partial seeding and allows a newer individual live field to win", async () => {
    response.run.mockResolvedValue({ data: [{ kind: "ir", status: "withheld", url: null }], error: null });
    expect(await issuerDirectory("OWL", "1823945")).toEqual({ ir: null, website: "https://www.blueowl.com/" });
  });

  it("uses the matching evidence snapshot during a database outage", async () => {
    response.run.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect(await issuerDirectory("DAVE", "0001841408")).toEqual({ ir: "https://investors.dave.com/", website: "https://dave.com/about" });
    expect(snapshotIssuerLinks("DAVE", "1")).toEqual({});
    expect(snapshotIssuerLinks("KVUE", "1944048")).toEqual({ ir: null, website: null });
  });
});
