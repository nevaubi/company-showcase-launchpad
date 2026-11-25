import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { FakeSourceDb } from "@/lib/sources/read.fake";
import { resetReadState } from "@/lib/sources/read.server";
import { readBoard, resetBoardCache } from "@/lib/sources/boards/board.server";
import { fixtureTables } from "@/lib/sources/boards/fixtures";
import type { Board } from "@/lib/sources/boards/types";
import { BoardBody, PHONE_TILES } from "./board";

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));

beforeAll(() => {
  // jsdom has no layout: the charts' size observer only needs to exist.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);

const tables = fixtureTables();
async function board(id: string): Promise<Board> {
  resetBoardCache();
  resetReadState();
  const read = await readBoard(new FakeSourceDb(tables), id, Date.UTC(2026, 10, 25, 21));
  if (!read.ok) throw new Error(read.message);
  return read.data;
}

const tiles = (container: HTMLElement) => [...container.querySelectorAll("article")];
const folded = (el: Element) => el.className.split(/\s+/).includes("@max-2xl:hidden");

describe("a board under two columns", () => {
  it("shows the first four tiles and a button for all nine; the button shows the rest and hands focus on", async () => {
    const data = await board("library");
    const { container } = render(<BoardBody data={data} />);
    expect(tiles(container)).toHaveLength(9);
    expect(tiles(container).map(folded)).toEqual([false, false, false, false, true, true, true, true, true]);
    const button = screen.getByRole("button", { name: "Show all 9 charts" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // only below two columns: a wide board shows every tile and no button
    expect(button.className.split(/\s+/)).toContain("@2xl:hidden");
    act(() => {
      fireEvent.click(button);
    });
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
    expect(tiles(container).some(folded)).toBe(false);
    expect(document.activeElement).toBe(tiles(container)[PHONE_TILES]);
    expect(document.activeElement?.getAttribute("data-section")).toBe(data.tiles[PHONE_TILES].title);
  });

  it("folds nothing on a board of four", async () => {
    const { container } = render(<BoardBody data={await board("01_financials")} />);
    expect(tiles(container)).toHaveLength(4);
    expect(tiles(container).some(folded)).toBe(false);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("names the board's own count", async () => {
    render(<BoardBody data={await board("00_universal")} />);
    expect(screen.getByRole("button", { name: "Show all 6 charts" })).toBeTruthy();
  });
});
