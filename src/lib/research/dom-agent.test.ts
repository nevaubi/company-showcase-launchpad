import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeHighlights, beginTour, clearHighlights, clickRefusal, countText, highlight, locate, locateNear, matchScore, nextPin, outline, pagePath, readRegion, regionOf, safeClick, showPin } from "./dom-agent";

function page(html: string) {
  document.body.innerHTML = `<main>${html}</main><aside aria-label="AI assistant"><h2>Gaps</h2><button>Delete chat</button></aside>`;
  return document.querySelector("main") as HTMLElement;
}

describe("matchScore", () => {
  it("ranks exact over prefix over contains over token overlap", () => {
    const exact = matchScore("Gaps", "gaps");
    const prefix = matchScore("Gaps and levels", "gaps");
    const contains = matchScore("Open price gaps", "gaps");
    const tokens = matchScore("Support and resistance levels", "resistance support");
    expect(exact).toBe(100);
    expect(prefix).toBeLessThan(exact);
    expect(contains).toBeLessThan(prefix);
    expect(tokens).toBeGreaterThan(0);
    expect(matchScore("Revenue", "dividends")).toBe(0);
  });
});

describe("locate", () => {
  beforeEach(() => {
    page(`
      <section data-section="Price gaps"><h3>Gaps</h3><table><tr><td>Open gap</td><td>$182.40</td></tr></table></section>
      <section id="support-levels"><h2>Support &amp; resistance</h2><p>Nearest support at $171</p></section>
      <div role="tablist"><button role="tab">Quarterly</button><button role="tab">Annual</button></div>
      <h2 hidden>Hidden heading</h2>
    `);
  });
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("prefers data-section and headings", () => {
    const hit = locate("price gaps");
    expect(hit?.how).toBe("section");
    expect(hit?.el.getAttribute("data-section")).toBe("Price gaps");
    expect(locate("Support & resistance")?.el.tagName).toBe("H2");
  });

  it("finds text and numbers on the page", () => {
    const hit = locate("$182.40", "text");
    expect(hit?.how).toBe("text");
    expect(hit?.el.textContent).toContain("182.40");
  });

  it("supports data-attribute and id selectors", () => {
    expect(locate("data-section=Price gaps", "selector")).toBeNull(); // unquoted spaces are not a valid selector
    expect(locate("[data-section='Price gaps']")?.how).toBe("selector");
    expect(locate("#support-levels")?.el.id).toBe("support-levels");
  });

  it("never matches inside the assistant panel or hidden elements", () => {
    const root = document.querySelector("main") as HTMLElement;
    const hit = locate("Gaps", "heading", root);
    expect(hit && root.contains(hit.el)).toBe(true);
    expect(locate("Hidden heading", "heading")).toBeNull();
  });

  it("regionOf returns the card/section a heading introduces", () => {
    const h = locate("Support & resistance")!.el;
    expect(regionOf(h).id).toBe("support-levels");
    expect(readRegion(h)).toContain("Nearest support at $171");
  });

  it("outlines sections and tabs", () => {
    const o = outline();
    expect(o).toContain("Price gaps");
    expect(o).toContain("tab: Quarterly");
    expect(o).not.toContain("Hidden heading");
  });
});

describe("safe clicks", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("presses tabs and toolbar toggles", () => {
    page(`<div role="tablist"><button role="tab" id="q">Quarterly</button></div><div role="group"><button id="r">5Y</button></div>`);
    const onClick = vi.fn();
    document.getElementById("q")!.addEventListener("click", onClick);
    expect(safeClick(document.getElementById("q")!)).toEqual({ ok: true, label: "Quarterly" });
    expect(onClick).toHaveBeenCalledOnce();
    expect(clickRefusal(document.getElementById("r")!)).toBeNull();
  });

  it("refuses submits, destructive actions, external links and plain buttons", () => {
    page(`
      <form><button id="s">Run</button></form>
      <div role="toolbar"><button id="d" aria-pressed="false">Delete watchlist</button></div>
      <a id="x" href="https://example.com">Docs</a>
      <a id="i" href="/app/markets">Markets</a>
      <button id="p">Do thing</button>
      <input id="in" />
    `);
    expect(clickRefusal(document.getElementById("s")!)).toMatch(/submit/);
    expect(clickRefusal(document.getElementById("d")!)).toMatch(/side effects/);
    expect(clickRefusal(document.getElementById("x")!)).toMatch(/leaves the app/);
    expect(clickRefusal(document.getElementById("i")!)).toBeNull();
    expect(clickRefusal(document.getElementById("p")!)).toMatch(/only tabs/);
    expect(clickRefusal(document.getElementById("in")!)).toMatch(/typing/);
  });
});

describe("highlights", () => {
  it("adds outlined callouts that clear", () => {
    vi.useFakeTimers();
    page(`<p id="t">Revenue $96.2B</p>`);
    highlight(document.getElementById("t")!, "Q2 revenue", 1000);
    highlight(document.getElementById("t")!, "again", 5000);
    expect(activeHighlights()).toBe(2);
    expect(document.querySelectorAll(".agent-mark")).toHaveLength(2);
    expect(document.querySelector(".agent-mark-label")?.textContent).toBe("Q2 revenue");
    vi.advanceTimersByTime(1100);
    expect(activeHighlights()).toBe(1);
    clearHighlights();
    expect(activeHighlights()).toBe(0);
    vi.useRealTimers();
  });
});

describe("walkthrough stops", () => {
  it("numbers stops, keeps them until cleared and replaces a stop shown again", () => {
    vi.useFakeTimers();
    page(`<p id="a">Revenue $96.2B</p><p id="b">Gross margin 71.2%</p>`);
    beginTour();
    const first = nextPin();
    highlight(document.getElementById("a")!, "Revenue up 12%", 0, { n: first });
    highlight(document.getElementById("b")!, "Margin down 210bp", 0, { n: nextPin() });
    vi.advanceTimersByTime(60_000);
    expect(activeHighlights()).toBe(2);
    const labels = [...document.querySelectorAll(".agent-mark-label:not(.agent-mark-out)")].map((l) => l.textContent);
    expect(labels).toEqual(["1Revenue up 12%", "2Margin down 210bp"]);
    highlight(document.getElementById("a")!, "Revenue up 12%", 0, { n: first, pulse: true });
    expect(activeHighlights()).toBe(2);
    beginTour();
    expect(activeHighlights()).toBe(0);
    expect(nextPin()).toBe(1);
    vi.useRealTimers();
  });

  it("searches inside the named section first and counts repeated text", () => {
    page(`<section data-section="Income statement"><p>Revenue $4.3B</p></section><section data-section="Segments"><p id="seg">Revenue $4.3B</p></section>`);
    expect(countText("$4.3B")).toBe(2);
    expect(locateNear("$4.3B", "text")?.el.id).toBe("");
    expect(locateNear("$4.3B", "text", "Segments")?.el.id).toBe("seg");
    expect(locateNear("$4.3B", "text", "No such section")?.el.id).toBe("");
  });

  it("shows a stop again on its page and reports one that is gone", async () => {
    page(`<p id="t">Free cash flow $1.1B</p>`);
    window.scrollBy = vi.fn(); // not implemented in jsdom
    beginTour();
    const pin = { n: 1, target: "Free cash flow", kind: "text" as const, label: "FCF doubled", path: pagePath() };
    expect(await showPin(pin)).toEqual({ ok: true });
    expect(document.querySelector(".agent-mark-label")?.textContent).toBe("1FCF doubled");
    expect(await showPin({ ...pin, path: "/app/elsewhere" })).toEqual({ ok: false, reason: "That stop is on another page" });
    clearHighlights();
  });
});
