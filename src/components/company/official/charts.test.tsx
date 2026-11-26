import { fireEvent, render as baseRender, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("@tanstack/react-router", async orig => ({ ...(await orig<typeof import("@tanstack/react-router")>()), useRouter: () => ({ history: { push } }) }));
vi.mock("@/components/source/source-context", () => ({ useSource: () => ({ open: vi.fn() }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import data from "@/lib/sources/company/fixtures/r6-store.json";
import { fixtureClient, type FixtureStore } from "@/lib/sources/company/fixtures/store-client";
import { readCompanyOfficial, resetOfficialCache } from "@/lib/sources/company/official.server";
import { readCompanyPatents, resetPatentsCache } from "@/lib/sources/company/orange-book.server";
import type { CompanyOfficial } from "@/lib/sources/company/types";
import { recordHref } from "@/lib/sources/links";
import { fakeStore } from "@/test/fixtures/sources/company/fake-store";
import { HoldingCompanyReport } from "./holding-company-report";
import { InsuredBanks } from "./insured-banks";
import { ObTimelineView } from "./ob-timeline";

// Real rows: Wells Fargo and Fifth Third (fixtures/r6-store.json, 26 Nov 2026), Bristol Myers Squibb's Orange Book
// rows (the round 4 store, 25 Nov 2026).
const render = (ui: ReactElement) => baseRender(<TooltipProvider>{ui}</TooltipProvider>);
beforeAll(() => {
  if (!("ResizeObserver" in globalThis))
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
});
afterEach(() => push.mockReset());
const load = async (ticker: string): Promise<CompanyOfficial> => {
  resetOfficialCache();
  const r = await readCompanyOfficial(fixtureClient(data as unknown as FixtureStore), ticker);
  if (!r.ok) throw new Error(r.reason);
  return r.data;
};

describe("Insured banks charts", () => {
  it("compares Wells Fargo's three charters, each on its own axis, and a charter's name selects it", async () => {
    const d = await load("WFC");
    const onSelect = vi.fn();
    render(<InsuredBanks data={d} selected={null} onSelect={onSelect} pending={false} />);
    const compared = screen.getByText("Charters compared").closest("[data-section]")! as HTMLElement;
    expect(within(compared).getAllByRole("group")).toHaveLength(3);
    expect(within(compared).getByText("$1.915 trillion")).toBeTruthy();
    expect(within(compared).getByText(/charters are never added together/)).toBeTruthy();
    fireEvent.click(within(compared).getByRole("button", { name: "WELLS FARGO BANK S CNTL NA" }));
    expect(onSelect).toHaveBeenCalledWith("5146");
  });
  it("leads the selected charter with its trends in reader scale, the stored figure as filed beneath, and its ratio tiles", async () => {
    const d = await load("WFC");
    render(<InsuredBanks data={d} selected={null} onSelect={() => {}} pending={false} />);
    const trends = document.querySelector('[data-section="Bank trends"]') as HTMLElement;
    expect(within(trends).getByText("1,914,653,000 USD thousands (monetary measures) as filed")).toBeTruthy();
    const link = within(trends).getAllByRole("link", { name: "$1.915 trillion" })[0];
    expect(link.getAttribute("href")).toBe(recordHref("official_fdic_2026q2_cohort500_native_current_quarter", "5161b5868f6f0b69142364ccfc1a39c59578abe9d9b551c3d50b940290ac2ddf", 42));
    const ratios = document.querySelector('[data-section="Bank ratios"]') as HTMLElement;
    expect(within(ratios).getByText("11.66%")).toBeTruthy();
    expect(within(ratios).getByText("−1.47")).toBeTruthy();
  });
  it("shows the charter's deposits by state: the stored totals, the largest states and every state in the table view", async () => {
    const d = await load("WFC");
    render(<InsuredBanks data={d} selected={null} onSelect={() => {}} pending={false} />);
    const deposits = document.querySelector('[data-section="Charter deposits by state"]') as HTMLElement;
    expect(within(deposits).getByText("$1.555 trillion")).toBeTruthy();
    expect(within(deposits).getByText("1,554,614,000 USD thousands as filed")).toBeTruthy();
    expect(within(deposits).getByText("USD billions · branches")).toBeTruthy();
    expect(within(deposits).getByText("4,157")).toBeTruthy();
    expect(within(deposits).getByText(/in 40 states and territories/)).toBeTruthy();
    const first = within(deposits).getAllByRole("listitem")[0];
    expect(first.textContent).toContain("South Dakota");
    fireEvent.click(within(deposits).getByRole("radio", { name: "Table" }));
    const table = within(deposits).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(41);
    expect(within(table).getByText("464,761,269")).toBeTruthy();
  });
});

describe("Holding company charts", () => {
  it("draws total assets, equity and year-to-date net income as columns, each column opening its record", async () => {
    const d = await load("FITB");
    render(<HoldingCompanyReport ticker="FITB" report={d.y9c!} statementAssets={() => null} />);
    const charts = document.querySelector('[data-section="Holding company charts"]') as HTMLElement;
    expect(within(charts).getByText(/Net income, year to date/)).toBeTruthy();
    const q1 = within(charts).getByRole("button", { name: "Q1 2026: 165,000 USD thousands. Opens the stored record." });
    fireEvent.click(q1);
    expect(push).toHaveBeenCalledWith(recordHref("official_01_financials_data_fed_y9_family_all_native_2026q1_q3_ffceb6e988", "eaa74358d53d90f9235e1733559ca65225488e3d13444f8834a1be15afb07948", 39));
    expect(within(charts).getByText("Capital ratios as filed, percent, Q1 2026 to Q3 2026")).toBeTruthy();
    expect(within(charts).getByText("Tier 1 leverage ratio")).toBeTruthy();
  });
});

describe("Orange Book timeline", () => {
  it("lists the next listed dates after today, soonest first, each opening its stored rows", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-26T12:00:00Z"));
    try {
      resetPatentsCache();
      const r = await readCompanyPatents(fakeStore(), "BMY", [
        { appl: "021880", sponsor: "BRISTOL MYERS SQUIBB" },
        { appl: "202155", sponsor: "BRISTOL MYERS SQUIBB" },
      ]);
      if (!r.ok) throw new Error(r.reason);
      render(<ObTimelineView data={r.data} />);
      const next = document.querySelector('[data-section="Next listed dates"]') as HTMLElement;
      const items = within(next).getAllByRole("listitem").map(li => li.textContent ?? "");
      expect(items[0]).toMatch(/^Apr 27, 2027REVLIMIDpatent expiry, 7465800/);
      expect(items[1]).toMatch(/^May 21, 2027ELIQUISpatent expiry, 6967208\*PED/);
      expect(within(next).getByText("Next listed dates after today, 26 Nov 2026")).toBeTruthy();
      const group = screen.getByRole("group");
      fireEvent.keyDown(group, { key: "ArrowRight" });
      fireEvent.keyDown(group, { key: "Enter" });
      expect(push).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
