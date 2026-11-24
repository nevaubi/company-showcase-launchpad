import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HoldHeight, KeepReaderInPlace, useKeepReaderBelow } from "./hold-height";

afterEach(() => vi.restoreAllMocks());

/** jsdom lays nothing out: each element reports the height and top its data attributes give it. */
function fakeLayout() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const h = Number(this.querySelector("[data-h]")?.getAttribute("data-h") ?? this.getAttribute("data-h") ?? 0);
    const top = Number(this.getAttribute("data-top") ?? 0);
    return { height: h, top, bottom: top + h, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  });
}

describe("HoldHeight", () => {
  it("keeps the height from before the read as a minimum once the read lands", () => {
    fakeLayout();
    const { container, rerender } = render(
      <HoldHeight phase="reading">
        <div data-h="344" />
      </HoldHeight>,
    );
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.minHeight).toBe("");
    rerender(
      <HoldHeight phase="extended">
        <div data-h="320" />
      </HoldHeight>,
    );
    expect(box.style.minHeight).toBe("344px");
    // later renders keep it for the rest of the visit
    rerender(
      <HoldHeight phase="extended">
        <div data-h="300" />
      </HoldHeight>,
    );
    expect(box.style.minHeight).toBe("344px");
  });

  it("holds nothing when no read was planned", () => {
    fakeLayout();
    const { container, rerender } = render(
      <HoldHeight phase="served">
        <div data-h="344" />
      </HoldHeight>,
    );
    rerender(
      <HoldHeight phase="served">
        <div data-h="200" />
      </HoldHeight>,
    );
    expect((container.firstElementChild as HTMLElement).style.minHeight).toBe("");
  });

  it("also holds when the read fails", () => {
    fakeLayout();
    const { container, rerender } = render(
      <HoldHeight phase="reading">
        <div data-h="120" />
      </HoldHeight>,
    );
    rerender(
      <HoldHeight phase="failed">
        <div data-h="90" />
      </HoldHeight>,
    );
    expect((container.firstElementChild as HTMLElement).style.minHeight).toBe("120px");
  });
});

describe("KeepReaderInPlace", () => {
  it("scrolls by however far the element under the middle of the viewport moved in the swap", () => {
    fakeLayout();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    const { container, rerender } = render(
      <KeepReaderInPlace phase="reading">
        <p data-top="500" />
      </KeepReaderInPlace>,
    );
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => container.querySelector("p") });
    // a panel above grows by 40 px in the same commit as the new figures
    rerender(
      <KeepReaderInPlace phase="extended">
        <p data-top="540" />
      </KeepReaderInPlace>,
    );
    expect(scrollBy).toHaveBeenCalledWith(0, 40);
  });

  it("does nothing when the reader did not move", () => {
    fakeLayout();
    const reader = document.createElement("p");
    reader.setAttribute("data-top", "500");
    document.body.appendChild(reader);
    Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => reader });
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    const { rerender } = render(<KeepReaderInPlace phase="reading">{null}</KeepReaderInPlace>);
    rerender(<KeepReaderInPlace phase="extended">{null}</KeepReaderInPlace>);
    expect(scrollBy).not.toHaveBeenCalled();
    reader.remove();
  });
});

function Late({ h, top }: { h: number; top: number }) {
  const ref = useKeepReaderBelow<HTMLDivElement>();
  return <div ref={ref} data-h={h} data-top={top} />;
}

describe("useKeepReaderBelow", () => {
  it("scrolls by the change when a panel above the middle of the viewport shrinks", () => {
    fakeLayout();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    const { rerender } = render(<Late h={176} top={-300} />);
    rerender(<Late h={43} top={-300} />);
    expect(scrollBy).toHaveBeenCalledWith(0, -133);
  });

  it("leaves the page alone when the panel is where the reader is or below", () => {
    fakeLayout();
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    const { rerender } = render(<Late h={176} top={400} />);
    rerender(<Late h={43} top={400} />);
    expect(scrollBy).not.toHaveBeenCalled();
  });
});
