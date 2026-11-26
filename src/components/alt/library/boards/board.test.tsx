import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeSourceDb } from "@/lib/sources/read.fake";
import { resetReadState } from "@/lib/sources/read.server";
import { readBoard, resetBoardCache } from "@/lib/sources/boards/board.server";
import { fixtureTables } from "@/lib/sources/boards/fixtures";
import type { Board, BoardLayoutSection } from "@/lib/sources/boards/types";
import { CORE_BOARDS } from "@/lib/sources/boards/specs";
import { BoardBody, BoardSection } from "./board";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));

const requests: string[][] = [];
vi.mock("@/lib/sources/boards/board.functions", () => ({
  // every request of the section through the real server with a small budget, so tiles are deferred and asked again
  getBoard: async ({ data }: { data: { id: string; tiles?: string[] } }) => {
    requests.push(data.tiles ?? []);
    return readBoard(new FakeSourceDb(fixtureTables()), data.id, Date.UTC(2026, 10, 25, 21), data.tiles, 6);
  },
}));

beforeAll(() => {
  // jsdom has no layout: the charts' size observer only needs to exist.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  requests.length = 0;
});

const tables = fixtureTables();
const core = (id: string) => CORE_BOARDS.find((b) => b.id === id)?.tiles ?? [];
async function board(id: string): Promise<Board> {
  resetBoardCache();
  resetReadState();
  const read = await readBoard(new FakeSourceDb(tables), id, Date.UTC(2026, 10, 25, 21), core(id));
  if (!read.ok) throw new Error(read.message);
  return read.data;
}
const articles = (container: HTMLElement) => [...container.querySelectorAll("article")];

describe("a board", () => {
  it("shows every tile, none folded behind a button", async () => {
    const data = await board("library");
    const { container } = render(<BoardBody data={data} />);
    expect(articles(container)).toHaveLength(core("library").length);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("groups the landing board by collection, each section headed by the collection's name", async () => {
    render(<BoardBody data={await board("library")} />);
    for (const name of ["Economy", "Energy"]) expect(screen.getByRole("heading", { name, level: 3 })).toBeTruthy();
  });

  it("shows a refused tile as one quiet line with its reason, never an empty frame", async () => {
    const data = await board("01_financials");
    const refused = { ...data, tiles: data.tiles.slice(1), refused: [{ id: data.tiles[0].id, title: data.tiles[0].title, reason: "The reason." }] };
    const { container } = render(<BoardBody data={refused} />);
    expect(articles(container)).toHaveLength(data.tiles.length - 1);
    expect(screen.getByText(`Not shown: ${data.tiles[0].title}. The reason.`)).toBeTruthy();
  });
});

describe("a board section", () => {
  it("draws skeletons, then every tile, asking again for the tiles a request deferred", async () => {
    resetBoardCache();
    resetReadState();
    const section: BoardLayoutSection = {
      title: "Rates",
      tiles: core("00_universal").map((id) => ({ id, title: id, form: "line", size: "regular", collection: "00_universal", datasetId: "" })),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <BoardSection board="00_universal" section={section} />
      </QueryClientProvider>,
    );
    expect(container.querySelectorAll("[aria-hidden].animate-pulse, [aria-hidden] .animate-pulse").length).toBeGreaterThan(0);
    await waitFor(() => expect(articles(container)).toHaveLength(section.tiles.length), { timeout: 4000 });
    expect(requests.length).toBeGreaterThan(1);
    expect(screen.getByRole("heading", { name: "Rates", level: 3 })).toBeTruthy();
  });

  it("shows only the tiles a search keeps while requesting the whole section", async () => {
    resetBoardCache();
    resetReadState();
    const ids = core("00_universal");
    const section: BoardLayoutSection = { title: null, tiles: ids.map((id) => ({ id, title: id, form: "line", size: "regular", collection: "00_universal", datasetId: "" })) };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <BoardSection board="00_universal" section={section} only={[ids[1]]} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(articles(container)).toHaveLength(1), { timeout: 4000 });
    await waitFor(() => expect(new Set(requests.flat())).toEqual(new Set(ids)), { timeout: 4000 });
    expect(articles(container)).toHaveLength(1);
  });
});
