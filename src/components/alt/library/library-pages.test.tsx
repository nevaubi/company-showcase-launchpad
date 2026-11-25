import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRootRoute, createRouter, isRedirect, RouterProvider, type AnyRoute } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SourceProvider } from "@/components/source/source-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Route as HubRoute } from "@/routes/_authenticated/app.alt-data";
import { Route as LibraryRoute } from "@/routes/_authenticated/app.alt-data_.library";
import { Route as CollectionRoute } from "@/routes/_authenticated/app.alt-data_.library_.c.$collection";

vi.mock("@/lib/sources/read.functions", async () => {
  const { lib, libRow } = await import("./test-rows");
  const rows = [
    libRow({ id: "fdic_panel", title: "FDIC bank financial statements, all reported quarters", rows: 51453 }),
    libRow({ id: "sod", title: "Summary of Deposits branches", rows: 55060, dimensions: ["entity_id", "geo_code"] }),
    libRow({ id: "ccsa", title: "Continued claims (insured unemployment)", code: "CCSA", publisherId: "bls", agency: "U.S. Employment and Training Administration via Federal Reserve Bank of St. Louis", collectionId: "00_universal", sector: "00_universal", dimensions: ["period"], rows: 3000 }),
    libRow({ id: "mer", title: "Primary energy overview", code: "MER 1.1", publisherId: "eia", agency: "U.S. Energy Information Administration", collectionId: "04_energy", sector: "04_energy", rows: 900 }),
  ];
  return { getLibrary: async () => ({ ok: true, data: lib(rows) }), getSourceSeries: async () => ({ ok: false, reason: "unavailable", message: "" }) };
});

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= NoResize;

/** The two library routes on a memory router, as the app mounts them. */
function mount(path: string) {
  const root = createRootRoute();
  const attach = (route: unknown, at: string) =>
    (route as { update: (o: object) => AnyRoute }).update({ id: at, path: at, getParentRoute: () => root });
  const tree = root.addChildren([attach(LibraryRoute, "/app/alt-data/library"), attach(CollectionRoute, "/app/alt-data/library/c/$collection")]);
  const router = createRouter({ routeTree: tree, history: createMemoryHistory({ initialEntries: [path] }) });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SourceProvider>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </SourceProvider>
    </QueryClientProvider>,
  );
  return router;
}

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}
const hrefOf = (e: unknown) => (isRedirect(e) ? (e.options as { href?: string }).href : null);
type BeforeLoad = (ctx: object) => unknown;

describe("old Alt data links", () => {
  const hub = HubRoute.options.beforeLoad as unknown as BeforeLoad;
  it("send each old address of the Source explorer to the page that shows the same thing", () => {
    expect(hrefOf(thrown(() => hub({ location: { searchStr: "?view=sources" } })))).toBe("/app/alt-data/library");
    expect(hrefOf(thrown(() => hub({ location: { searchStr: "?view=sources&sector=01_financials" } })))).toBe("/app/alt-data/library/c/banks");
    expect(hrefOf(thrown(() => hub({ location: { searchStr: "?view=sources&source=fdic_panel&entity=%22628%22&after=25" } })))).toBe(
      '/app/alt-data/library/d/fdic_panel?entity=%22628%22&after=25',
    );
  });

  it("leave Company signals addresses alone", () => {
    expect(thrown(() => hub({ location: { searchStr: "?d=bank" } }))).toBeNull();
    expect(thrown(() => hub({ location: { searchStr: "" } }))).toBeNull();
  });

  it("send a collection's stored id to its slug, keeping the search", () => {
    const before = CollectionRoute.options.beforeLoad as unknown as BeforeLoad;
    expect(hrefOf(thrown(() => before({ params: { collection: "01_financials" }, location: { searchStr: "?q=fdic" } })))).toBe("/app/alt-data/library/c/banks?q=fdic");
    expect(thrown(() => before({ params: { collection: "banks" }, location: { searchStr: "" } }))).toBeNull();
    expect(thrown(() => before({ params: { collection: "nowhere" }, location: { searchStr: "" } }))).toBeNull();
  });
});

describe("Data library pages", () => {
  it("searches by every word and says how many tables match", async () => {
    const router = mount("/app/alt-data/library?q=fdic");
    expect(await screen.findByText("2 tables match “fdic”")).toBeInTheDocument();
    const input = screen.getByRole("searchbox", { name: "Search tables" });
    await act(async () => {
      fireEvent.change(input, { target: { value: "mer 1.1" } });
    });
    await waitFor(() => expect(screen.getByText("1 table matches “mer 1.1”")).toBeInTheDocument());
    expect(screen.getByText("Primary energy overview")).toBeInTheDocument();
    expect(router.state.location.search).toMatchObject({ q: "mer 1.1" });
  });

  it("answers an empty search with a sentence and a way back, not an empty table", async () => {
    mount("/app/alt-data/library?q=zzzz");
    expect(await screen.findByText("No table matches “zzzz”.")).toBeInTheDocument();
    expect(screen.getByText(/Try a publisher \(FDIC, EIA, FHFA\)/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    });
    expect(await screen.findByText("Collections")).toBeInTheDocument();
  });

  it("shows the overview with the collections that hold tables", async () => {
    mount("/app/alt-data/library");
    expect(await screen.findByRole("link", { name: /Banks and funds/ })).toHaveAttribute("href", "/app/alt-data/library/c/banks");
    expect(screen.getByRole("link", { name: /Economy/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Energy/ })).toBeInTheDocument();
  });

  it("lists a collection's tables, largest first", async () => {
    mount("/app/alt-data/library/c/banks");
    expect(await screen.findByText("Tables (2)")).toBeInTheDocument();
    const titles = screen.getAllByRole("link", { name: /Summary of Deposits|FDIC bank financial/ }).map((a) => a.textContent);
    expect(titles).toEqual(["Summary of Deposits branches", "FDIC bank financial statements, all reported quarters"]);
  });

  it("turns a wrong collection address into the list of collections", async () => {
    mount("/app/alt-data/library/c/nowhere-at-all");
    expect(await screen.findByRole("heading", { name: "No such collection" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /Banks and funds/ })).toBeInTheDocument();
  });
});
