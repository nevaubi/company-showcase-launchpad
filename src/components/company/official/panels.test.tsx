import { fireEvent, render as baseRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("@tanstack/react-router", async orig => ({ ...(await orig<typeof import("@tanstack/react-router")>()), useRouter: () => ({ history: { push } }) }));
const open = vi.fn();
vi.mock("@/components/source/source-context", () => ({ useSource: () => ({ open }) }));

import { readCompanyOfficial, resetOfficialCache } from "@/lib/sources/company/official.server";
import type { CompanyOfficial } from "@/lib/sources/company/types";
import { recordHref } from "@/lib/sources/links";
import { fakeStore } from "@/test/fixtures/sources/company/fake-store";
import { HoldingCompanyReport, Y9C_CAPTION } from "./holding-company-report";
import { BANKS_CAPTION, InsuredBanks } from "./insured-banks";
import { TooltipProvider } from "@/components/ui/tooltip";

const render = (ui: ReactElement) => {
  const r = baseRender(<TooltipProvider>{ui}</TooltipProvider>);
  return { ...r, rerender: (next: ReactElement) => r.rerender(<TooltipProvider>{next}</TooltipProvider>) };
};

beforeAll(() => {
  if (!("ResizeObserver" in globalThis))
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
});
const load = async (t: string): Promise<CompanyOfficial> => {
  resetOfficialCache();
  const r = await readCompanyOfficial(fakeStore(), t);
  if (!r.ok) throw new Error(r.reason);
  return r.data;
};

describe("InsuredBanks", () => {
  it("lists every Wintrust institution, figures only where the FDIC cohort tables state units, and says why for the rest", async () => {
    const data = await load("WTFC");
    const onSelect = vi.fn();
    render(<InsuredBanks ticker="WTFC" data={data} selected={null} onSelect={onSelect} pending={false} />);
    expect(screen.getByText(BANKS_CAPTION)).toBeTruthy();
    const table = screen.getAllByRole("table")[0];
    expect(within(table).getAllByRole("row")).toHaveLength(18);
    expect(screen.getByText("Outside the stored FDIC 500 cohort.")).toBeTruthy();
    expect(screen.getByText("Noninsured trust company.")).toBeTruthy();
    expect(screen.getByText(/Trust companies file a call report but are not FDIC insured|A trust company files a call report but is not FDIC insured/)).toBeTruthy();
    // the largest bank by stated assets is selected first
    expect(screen.getByRole("button", { name: "WINTRUST BANK NATIONAL ASSN", pressed: true })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "LAKE FOREST B&T CO NA" }));
    expect(onSelect).toHaveBeenCalledWith("27589");
  });

  it("links every figure to its stored record and shows the unit the dictionary states", async () => {
    const data = await load("JPM");
    render(<InsuredBanks ticker="JPM" data={data} selected={null} onSelect={() => {}} pending={false} />);
    const asset = data.banks[0].lines.find(l => l.field === "ASSET")!;
    const links = screen.getAllByRole("link", { name: "4,174,631,000" });
    expect(links[0].getAttribute("href")).toBe(recordHref(asset.ref.dataset, asset.ref.snapshot, asset.ref.row));
    expect(screen.getAllByText("USD thousands").length).toBeGreaterThan(0);
    expect(screen.getByText("JPMORGAN CHASE BANK DEARBORN")).toBeTruthy();
    expect(screen.getByText(/The filing header of 3 asset-backed deals names JPMorgan Chase Bank, N.A. as sponsor./)).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Table" }));
    expect(screen.getByRole("columnheader", { name: "Total assets (USD thousands)" })).toBeTruthy();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(100);
  });

  it("shows Mechanics Bancorp's own bank and nothing of the other Mechanics Bank", async () => {
    const data = await load("MCHB");
    const { container } = render(<InsuredBanks ticker="MCHB" data={data} selected={null} onSelect={() => {}} pending={false} />);
    expect(screen.getAllByText("MECHANICS BANK").length).toBeGreaterThan(0);
    expect(screen.getByText("Held through one NIC relationship (100.00% equity).")).toBeTruthy();
    expect(container.textContent).not.toContain("29011");
    expect(container.textContent).not.toContain("919,6");
  });
});

describe("HoldingCompanyReport", () => {
  it("shows the capital lines as filed, with units from the reviewed list and blanks as blanks", async () => {
    const data = await load("JPM");
    render(<HoldingCompanyReport ticker="JPM" report={data.y9c!} statementAssets={() => null} />);
    expect(screen.getByText(Y9C_CAPTION)).toBeTruthy();
    const row = screen.getByText("Common equity tier 1 capital ratio").closest("tr")!;
    expect(within(row).getAllByRole("link").map(a => a.textContent)).toEqual(["14.2769", "14.1913", "13.9676"]);
    expect(within(row).getByText("%")).toBeTruthy();
    const slr = screen.getByText("Supplementary leverage ratio").closest("tr")!;
    expect(within(slr).getByText("as filed")).toBeTruthy();
    const cet1Capital = screen.getByText("Common equity tier 1 capital").closest("tr")!;
    expect(within(cet1Capital).getAllByText("blank")).toHaveLength(3);
    expect(screen.queryByText(/equal the 10-Q/)).toBeNull();
  });

  it("ties total assets to the 10-Q with both references, and states a difference as one", async () => {
    const data = await load("JPM");
    const src = { accn: "0001628280-26-077777", concept: "us-gaap:Assets", end: "2026-09-30", value: 5_091_545_000_000 };
    const { rerender } = render(<HoldingCompanyReport ticker="JPM" report={data.y9c!} statementAssets={d => (d === "2026-09-30" ? { value: 5_091_545_000_000, src } : null)} />);
    expect(screen.getByText("Total assets on the FR Y-9C equal the 10-Q's at 30 Sep 2026.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /10-Q, total assets/ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ src, value: 5_091_545_000_000 }));
    rerender(<HoldingCompanyReport ticker="JPM" report={data.y9c!} statementAssets={d => (d === "2026-09-30" ? { value: 5_091_481_000_000 } : null)} />);
    expect(screen.getByText(/differ at 30 Sep 2026: 10-Q less FR Y-9C is −\$64\.0M\./)).toBeTruthy();
  });
});
