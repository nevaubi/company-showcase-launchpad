import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdInPlace } from "./scroll-to";

/** jsdom has no layout: each element reports the top the test gives it, and frames run when the test says so. */
const tops = new Map<Element, number>();
let frames: FrameRequestCallback[] = [];
let now = 0;
const frame = (advance = 16) => { now += advance; const run = frames; frames = []; for (const f of run) f(now); };
const el = (parent: Element, attrs: Record<string, string> = {}) => {
  const e = document.createElement("div");
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent.appendChild(e);
  e.getBoundingClientRect = () => ({ top: tops.get(e) ?? 0 }) as DOMRect;
  return e;
};

describe("holdInPlace", () => {
  let scrollBy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    frames = []; now = 0; tops.clear();
    document.body.innerHTML = "";
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { frames.push(f); return frames.length; });
    vi.stubGlobal("cancelAnimationFrame", () => { frames = []; });
    vi.spyOn(performance, "now").mockImplementation(() => now);
    scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("moves the window by exactly what the pressed control shifted, and not at all when it did not", () => {
    const row = el(document.body);
    tops.set(row, 400);
    holdInPlace(row);
    frame();
    expect(scrollBy).not.toHaveBeenCalled();
    tops.set(row, 1140); // the map above grew by 740 px
    frame();
    expect(scrollBy).toHaveBeenCalledWith({ top: 740, behavior: "instant" });
    tops.set(row, 400); // the window followed
    frame();
    expect(scrollBy).toHaveBeenCalledTimes(1);
    tops.set(row, 150); // a panel above finished loading and got shorter
    frame();
    expect(scrollBy).toHaveBeenLastCalledWith({ top: -250, behavior: "instant" });
  });

  it("holds the nearest surviving region when the change re-creates the pressed control", () => {
    const region = el(document.body, { id: "supply-coverage" });
    const plain = el(region);
    const row = el(plain);
    tops.set(region, 300); tops.set(row, 520);
    holdInPlace(row);
    row.remove();
    tops.set(region, 90);
    frame();
    expect(scrollBy).toHaveBeenCalledWith({ top: -210, behavior: "instant" });
  });

  it("ends when the reader scrolls, taps or types, and after its time is up", () => {
    const row = el(document.body);
    tops.set(row, 400);
    holdInPlace(row, 1000);
    window.dispatchEvent(new Event("wheel"));
    tops.set(row, 900);
    frame();
    expect(scrollBy).not.toHaveBeenCalled();

    holdInPlace(row, 1000);
    tops.set(row, 1000);
    frame(1200); // past its time: this frame still corrects, then it stops
    expect(scrollBy).toHaveBeenCalledTimes(1);
    expect(scrollBy).toHaveBeenLastCalledWith({ top: 100, behavior: "instant" });
    tops.set(row, 2000);
    frame();
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it("does nothing without a pressed element, or when nothing of it survives", () => {
    holdInPlace(null);
    expect(frames).toHaveLength(0);
    const row = el(document.body);
    holdInPlace(row);
    row.remove();
    frame();
    frame();
    expect(scrollBy).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
  });
});
