import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { radioKeyTarget, Segmented, type SegOption } from "./segmented";

type V = "a" | "b" | "c" | "d";
const OPTS: SegOption<V>[] = [
  { v: "a", l: "Alpha" },
  { v: "b", l: "Beta", title: "The second one" },
  { v: "c", l: "Gamma", disabled: true },
  { v: "d", l: "Delta" },
];

function Group({ start = "a" as V, options = OPTS, spy }: { start?: V; options?: SegOption<V>[]; spy?: (v: V) => void }) {
  const [v, setV] = useState<V>(start);
  return (
    <TooltipProvider>
      <Segmented
        label="Choice"
        value={v}
        options={options}
        onChange={(x) => {
          spy?.(x);
          setV(x);
        }}
      />
    </TooltipProvider>
  );
}

const radio = (name: string) => screen.getByRole("radio", { name });

describe("radioKeyTarget", () => {
  const none = [false, false, false, false];
  it("moves forward and back with wrap-around", () => {
    expect(radioKeyTarget("ArrowRight", 0, none)).toBe(1);
    expect(radioKeyTarget("ArrowDown", 3, none)).toBe(0);
    expect(radioKeyTarget("ArrowLeft", 0, none)).toBe(3);
    expect(radioKeyTarget("ArrowUp", 2, none)).toBe(1);
  });
  it("skips disabled options, also at the ends", () => {
    const dis = [true, false, true, false];
    expect(radioKeyTarget("ArrowRight", 1, dis)).toBe(3);
    expect(radioKeyTarget("ArrowRight", 3, dis)).toBe(1);
    expect(radioKeyTarget("Home", 3, dis)).toBe(1);
    expect(radioKeyTarget("End", 1, [false, false, false, true])).toBe(2);
  });
  it("ignores other keys and a group with nowhere else to go", () => {
    expect(radioKeyTarget("Enter", 0, none)).toBeNull();
    expect(radioKeyTarget("ArrowRight", 0, [false, true])).toBeNull();
    expect(radioKeyTarget("Home", 0, [])).toBeNull();
  });
});

describe("Segmented", () => {
  it("keeps the radio roles, checked state and click behaviour", () => {
    const spy = vi.fn();
    render(<Group spy={spy} />);
    expect(screen.getByRole("radiogroup", { name: "Choice" })).toBeTruthy();
    expect(radio("Alpha").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radio("Delta"));
    expect(spy).toHaveBeenLastCalledWith("d");
    expect(radio("Delta").getAttribute("aria-checked")).toBe("true");
    expect(radio("Alpha").getAttribute("aria-checked")).toBe("false");
  });

  it("has one tab stop: the checked option, or the first one when none is checked", () => {
    const { unmount } = render(<Group start="b" />);
    expect(screen.getAllByRole("radio").map((b) => b.tabIndex)).toEqual([-1, 0, -1, -1]);
    unmount();
    render(<Group start={"x" as V} />);
    expect(screen.getAllByRole("radio").map((b) => b.tabIndex)).toEqual([0, -1, -1, -1]);
  });

  it("arrow keys move the focus and select, skipping disabled options and wrapping", () => {
    const spy = vi.fn();
    render(<Group spy={spy} />);
    radio("Alpha").focus();
    fireEvent.keyDown(radio("Alpha"), { key: "ArrowRight" });
    expect(spy).toHaveBeenLastCalledWith("b");
    expect(document.activeElement).toBe(radio("Beta"));
    fireEvent.keyDown(radio("Beta"), { key: "ArrowRight" });
    expect(spy).toHaveBeenLastCalledWith("d");
    expect(document.activeElement).toBe(radio("Delta"));
    expect(radio("Delta").tabIndex).toBe(0);
    fireEvent.keyDown(radio("Delta"), { key: "ArrowDown" });
    expect(spy).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(radio("Alpha"), { key: "ArrowUp" });
    expect(spy).toHaveBeenLastCalledWith("d");
    fireEvent.keyDown(radio("Delta"), { key: "Home" });
    expect(spy).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(radio("Alpha"), { key: "End" });
    expect(spy).toHaveBeenLastCalledWith("d");
    expect(document.activeElement).toBe(radio("Delta"));
  });

  it("leaves other keys alone", () => {
    const spy = vi.fn();
    render(<Group spy={spy} />);
    fireEvent.keyDown(radio("Alpha"), { key: "Enter" });
    fireEvent.keyDown(radio("Alpha"), { key: "a" });
    expect(spy).not.toHaveBeenCalled();
  });
});
