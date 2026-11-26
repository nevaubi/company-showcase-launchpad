import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SourceProvider } from "@/components/source/source-context";
import { filingDetailQuery } from "@/lib/xbrl/queries";
import type { FilingDetail, StoredDetail } from "@/lib/xbrl/detail";
import { FilingDetailView } from "./filing-detail";

// The Money map itself is not under test: a stand-in shows whether it is mounted.
vi.mock("@/components/financials/money-map", () => ({
  hasMoneyMap: () => true,
  MoneyMap: () => <div data-testid="money-map">Money map</div>,
}));
vi.mock("@tanstack/react-router", () => ({ Link: ({ children }: { children: unknown }) => children }));

beforeAll(() => {
  // jsdom has no ResizeObserver; panels use it to decide whether to fold long tables.
  if (!("ResizeObserver" in globalThis))
    (globalThis as Record<string, unknown>).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
});

const annual: FilingDetail = {
  format: 1,
  ticker: "TEST",
  accn: "0000000000-26-000001",
  form: "10-K",
  filed: "2026-02-01",
  reportDate: "2025-12-31",
  doc: "test-10k.htm",
  periods: { y24: { key: "y24", end: "2024-12-31", start: "2024-01-01", months: 12 }, y25: { key: "y25", end: "2025-12-31", start: "2025-01-01", months: 12 } },
  tables: [
    {
      id: "revenue-product",
      family: "revenue",
      title: "Revenue by product",
      concept: "us-gaap:Revenues",
      conceptLabel: "Revenue",
      axis: "srt:ProductOrServiceAxis",
      axisLabel: "Product / service",
      unit: "USD",
      periods: ["y24", "y25"],
      rows: [
        { member: "a:ProductAMember", label: "Product A", values: { y24: { v: 60e6 }, y25: { v: 70e6 } } },
        { member: "a:ProductBMember", label: "Product B", values: { y24: { v: 40e6 } } },
      ],
      total: { y24: { v: 100e6 }, y25: { v: 110e6 } },
    },
  ],
  segments: null,
  concentration: [],
  counts: { facts: 10, dimensional: 4 },
};

function mount(map?: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const stored: StoredDetail = { ticker: "TEST", builtAt: "2026-02-02", format: 1, annual, quarterly: null } as StoredDetail;
  client.setQueryData(filingDetailQuery("TEST").queryKey, stored);
  return render(
    <QueryClientProvider client={client}>
      <SourceProvider>
        <TooltipProvider>{map === undefined ? <FilingDetailView ticker="TEST" /> : <FilingDetailView ticker="TEST" map={map} />}</TooltipProvider>
      </SourceProvider>
    </QueryClientProvider>,
  );
}

describe("FilingDetailView money map", () => {
  it("opens on the Money map by default (the Financials tab)", () => {
    mount();
    expect(screen.getByTestId("money-map")).toBeTruthy();
    expect(screen.getByRole("radio", { name: /money map/i })).toBeTruthy();
  });

  it("leaves the Money map out with map={false} (the IR tab) and opens on the first table", () => {
    const { container } = mount(false);
    expect(screen.queryByTestId("money-map")).toBeNull();
    expect(screen.queryByRole("radio", { name: /money map/i })).toBeNull();
    expect(container.textContent).toContain("Product A");
  });
});
