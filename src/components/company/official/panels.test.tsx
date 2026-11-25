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
import { readCompanyPatents, resetPatentsCache } from "@/lib/sources/company/orange-book.server";
import { OB_CAVEAT, type CompanyPatents } from "@/lib/sources/company/orange-book";
import { OrangeBookView } from "./orange-book";

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

describe("Phone width", () => {
  it("keeps every table's scroll box positioned, so visually hidden text inside a table cannot widen the page", async () => {
    const data = await load("JPM");
    const banks = render(<InsuredBanks ticker="JPM" data={data} selected={null} onSelect={() => {}} pending={false} />);
    const report = render(<HoldingCompanyReport ticker="JPM" report={data.y9c!} statementAssets={() => null} />);
    for (const { container } of [banks, report]) {
      // a table with a minimum width scrolls inside its own box; the box is the containing block of what it holds
      const wide = [...container.querySelectorAll("table")].filter(t => /min-w-\[/.test(t.className));
      expect(wide.length).toBeGreaterThan(0);
      for (const t of wide) expect(t.closest(".overflow-x-auto")?.classList.contains("relative")).toBe(true);
    }
  });
});

describe("OrangeBookView", () => {
  const BMY = ["005657", "021880", "021986", "202155", "209606", "221075"].map(appl => ({ appl, sponsor: "BRISTOL MYERS SQUIBB" }));
  const patents = async (asks = BMY): Promise<CompanyPatents> => {
    resetOfficialCache();
    resetPatentsCache();
    const r = await readCompanyPatents(fakeStore(), "BMY", asks);
    if (!r.ok) throw new Error(r.reason);
    return r.data;
  };

  it("lists the applications with their last listed expiry and exclusivity as printed, and the caveats", async () => {
    const data = await patents();
    render(<OrangeBookView data={data} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(OB_CAVEAT)).toBeTruthy();
    const eliquis = screen.getByRole("button", { name: "ELIQUIS" }).closest("tr")!;
    expect(within(eliquis).getByText("NDA 202155")).toBeTruthy();
    expect(within(eliquis).getByText("Aug 24, 2031")).toBeTruthy();
    expect(within(eliquis).getByText(/Oct 17, 2028/)).toBeTruthy();
    expect(screen.queryByText(/TUBOCURARINE/)).toBeNull(); // no Orange Book patent or exclusivity rows
    expect(screen.getByText(/Orange Book files retrieved 24 Nov 2026/)).toBeTruthy();
  });

  it("shows the selected application's patents, one line per patent, each opening its stored rows", async () => {
    const data = await patents();
    const onSelect = vi.fn();
    const { rerender } = render(<OrangeBookView data={data} selected={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "REVLIMID" }));
    expect(onSelect).toHaveBeenCalledWith("021880");
    rerender(<OrangeBookView data={data} selected="021880" onSelect={onSelect} />);
    const detail = screen.getByText("applicant BRISTOL MYERS SQUIBB").closest("[data-section='Listed patents']") as HTMLElement;
    const row = within(detail).getByText("7465800").closest("tr")!;
    expect(within(row).getByText("Apr 27, 2027")).toBeTruthy();
    const link = within(row).getByRole("link");
    expect(link.getAttribute("href")).toBe(recordHref("official_03_healthcare_csv_ob_patent_63776478d4", "60c0c87962d5bffc357c222f1a25184892e15415c673f4d5d16636d9c3c1e992", 14988));
    expect(link.textContent).toBe("row 14,988 +5");
    // REVLIMID's two orphan drug exclusivities (ODE-241 and ODE-245), both to May 28, 2026
    expect(within(detail).getAllByText("Orphan drug exclusivity")).toHaveLength(2);
    expect(within(detail).getAllByText("May 28, 2026")).toHaveLength(2);
  });

  it("says so in one line when the applicant differs or nothing is listed", async () => {
    const data = await patents([{ appl: "203756", sponsor: "EXELIXIS INC" }]);
    render(<OrangeBookView data={data} selected={null} onSelect={() => {}} />);
    expect(screen.getByText(/lists no patent or exclusivity/).textContent).toContain("1 application with Orange Book rows is not shown: The Orange Book's applicant is not the firm the FDA panel names.");
  });
});
