import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSearchText } from "./use-search-text";

// The address is simulated: commit writes q, and the hook is re-rendered with it, as the router does.
function setup(initial?: string) {
  let q = initial;
  const commits: (string | undefined)[] = [];
  const h = renderHook(({ q }) => useSearchText(q, (v) => { commits.push(v); q = v; }), { initialProps: { q } });
  const sync = () => h.rerender({ q });
  return { h, commits, sync, nav: (v: string | undefined) => { q = v; h.rerender({ q }); } };
}

describe("useSearchText", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps a space typed after a pause", () => {
    const { h, commits, sync } = setup();
    act(() => h.result.current[1]("earnings "));
    act(() => vi.advanceTimersByTime(450));
    sync();
    expect(commits).toEqual(["earnings"]);
    expect(h.result.current[0]).toBe("earnings ");
    act(() => h.result.current[1]("earnings 2025"));
    act(() => vi.advanceTimersByTime(450));
    sync();
    expect(h.result.current[0]).toBe("earnings 2025");
    expect(commits).toEqual(["earnings", "earnings 2025"]);
  });

  it("does not undo typing when the address catches up late", () => {
    const { h, commits, sync } = setup();
    act(() => h.result.current[1]("earnings"));
    act(() => vi.advanceTimersByTime(250));
    // more typed before the router re-renders with the first value
    act(() => h.result.current[1]("earnings r"));
    sync();
    expect(h.result.current[0]).toBe("earnings r");
    act(() => vi.advanceTimersByTime(250));
    sync();
    expect(commits).toEqual(["earnings", "earnings r"]);
  });

  it("follows an outside navigation", () => {
    const { h, nav } = setup("proxy");
    expect(h.result.current[0]).toBe("proxy");
    nav(undefined);
    expect(h.result.current[0]).toBe("");
    nav("10-K");
    expect(h.result.current[0]).toBe("10-K");
  });
});
