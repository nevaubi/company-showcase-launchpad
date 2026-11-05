import { act, renderHook, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSessionState } from "./use-session-state";

describe("research view preferences", () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);
  it("restores the company filter when returning to the view", () => {
    const first = renderHook(() => useSessionState("companies:filter", ""));
    act(() => first.result.current[1]("Apple"));
    first.unmount();
    const returned = renderHook(() => useSessionState("companies:filter", ""));
    expect(returned.result.current[0]).toBe("Apple");
  });
  it("does not overwrite a second company's stored filter when switching tickers", () => {
    sessionStorage.setItem("alt:AAPL", JSON.stringify("contracts"));
    sessionStorage.setItem("alt:NVDA", JSON.stringify("ownership"));
    const hook = renderHook(({ key }) => useSessionState(key, "all"), { initialProps: { key: "alt:AAPL" } });
    hook.rerender({ key: "alt:NVDA" });
    expect(hook.result.current[0]).toBe("ownership");
    expect(JSON.parse(sessionStorage.getItem("alt:AAPL") ?? "null")).toBe("contracts");
    expect(JSON.parse(sessionStorage.getItem("alt:NVDA") ?? "null")).toBe("ownership");
  });
  it("falls back safely when a stored preference is malformed", () => {
    sessionStorage.setItem("companies:filter", "broken json");
    const hook = renderHook(() => useSessionState("companies:filter", ""));
    expect(hook.result.current[0]).toBe("");
  });
});