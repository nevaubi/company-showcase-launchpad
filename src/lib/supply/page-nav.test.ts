import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_HEADER, COMPANY_NAV, fitsBeside, FOLLOW_START, followRoom, nextFollow, offscreen, PANEL_TOP, SUPPLY_SECTIONS, VIEW_NAV, type FollowState } from "./page-nav";

const ROOT = join(__dirname, "../../..");
const ROUTE = "src/routes/_authenticated/app.supply-chain.tsx";
const DIR = "src/components/supply";
/** The page's own files: the route and the supply components. The globe (another unit's) is checked by its own tests. */
const pageFiles = () => [ROUTE, ...readdirSync(join(ROOT, DIR)).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== "supply-globe.tsx").map((f) => `${DIR}/${f}`)];
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("the supply page never moves the reader", () => {
  it("every address change it makes keeps the scroll position", () => {
    expect(VIEW_NAV).toEqual({ replace: true, resetScroll: false });
    expect(COMPANY_NAV).toEqual({ resetScroll: false });
    // each call is one statement on one line, ending with the spread of one of the two option sets
    const calls = read(ROUTE).split("\n").filter((line) => /\bnavigate\(\{/.test(line));
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c, `navigate call without a scroll-keeping option: ${c.trim().slice(0, 80)}`).toMatch(/\.\.\.(VIEW_NAV|COMPANY_NAV) \}\)/);
  });
  it("nothing scrolls as a side effect: the window's scroll position is touched in one file only", () => {
    const offenders = pageFiles().filter((p) => p !== `${DIR}/scroll-to.ts`).filter((p) => /scrollIntoView|\bscrollTo\(|\bscrollBy\(|\.scrollTop\s*=/.test(read(p)));
    expect(offenders).toEqual([]);
    const users = (fn: string) => pageFiles().filter((p) => p !== `${DIR}/scroll-to.ts` && new RegExp(`\\b${fn}\\(`).test(read(p))).sort();
    // going somewhere: only when the reader presses a section link or the button of a cue
    expect(users("scrollToId")).toEqual([`${DIR}/off-screen-cue.tsx`, `${DIR}/section-nav.tsx`]);
    // holding the pressed control still: only on a company change
    expect(users("holdInPlace")).toEqual([ROUTE]);
    const route = read(ROUTE);
    expect(route.match(/holdInPlace\(/g)).toHaveLength(1);
    expect(route).toMatch(/const go = useCallback\(\(tk: string[^)]*\) => \{[\s\S]{0,400}holdInPlace\(/);
  });
  it("moving keyboard focus never scrolls either", () => {
    const offenders = pageFiles().filter((p) => /\.focus\(\s*\)/.test(read(p)));
    expect(offenders).toEqual([]);
  });
  it("every section the links point at exists in the page", () => {
    const route = read(ROUTE);
    for (const s of SUPPLY_SECTIONS) expect(route).toContain(`id="${s.id}"`);
    expect(new Set(SUPPLY_SECTIONS.map((s) => s.id)).size).toBe(SUPPLY_SECTIONS.length);
  });
});

describe("offscreen", () => {
  const vh = 800;
  it("is null while enough of the region is in the visible band", () => {
    expect(offscreen({ top: 200, bottom: 600 }, vh)).toBeNull();
    expect(offscreen({ top: -400, bottom: 300 }, vh)).toBeNull();
    expect(offscreen({ top: vh - 100, bottom: vh + 900 }, vh)).toBeNull();
  });
  it("says below when the region starts under the bottom edge, or only a sliver shows", () => {
    expect(offscreen({ top: 1200, bottom: 1900 }, vh)).toBe("below");
    expect(offscreen({ top: vh - 30, bottom: vh + 500 }, vh)).toBe("below");
  });
  it("says above when the region ends under the sticky bars, or only a sliver shows below them", () => {
    expect(offscreen({ top: -900, bottom: -100 }, vh)).toBe("above");
    expect(offscreen({ top: -900, bottom: APP_HEADER + 20 }, vh)).toBe("above");
    // a taller sticky stack hides more of the top
    expect(offscreen({ top: -900, bottom: 140 }, vh, APP_HEADER)).toBeNull();
    expect(offscreen({ top: -900, bottom: 140 }, vh, APP_HEADER + 40)).toBe("above");
  });
});

describe("the evidence panel follows the reader", () => {
  const vh = 900, short = 500, tall = 1400;
  const at = (prev: FollowState, panelTop: number, cellTop: number, dir: -1 | 0 | 1, panelHeight = tall) => nextFollow(prev, { cellTop, panelTop, panelHeight, viewportHeight: vh, dir });
  it("a panel that fits in the window is always held at the top", () => {
    expect(fitsBeside(short, vh)).toBe(true);
    expect(fitsBeside(vh - PANEL_TOP - 16, vh)).toBe(true);
    expect(fitsBeside(vh - PANEL_TOP - 15, vh)).toBe(false);
    for (const dir of [-1, 0, 1] as const) expect(at(FOLLOW_START, PANEL_TOP, -600, dir, short)).toBe(FOLLOW_START);
    // it was in the flow as a tall panel and has shrunk: back to the top, where its head can be read
    expect(at({ mode: "free", offset: 700 }, -200, -900, 0, short)).toEqual(FOLLOW_START);
    expect(at({ mode: "bottom", offset: 700 }, -200, -900, 0, short)).toEqual(FOLLOW_START);
  });
  it("a tall panel is released where it is when the reader scrolls down, so its end can be read", () => {
    // held at the top, 600 px down its column
    const free = at(FOLLOW_START, PANEL_TOP, PANEL_TOP - 600, 1);
    expect(free).toEqual({ mode: "free", offset: 600 });
    // not yet followed anything (near the top of the page): released in place
    expect(at(FOLLOW_START, 330, 330, 1)).toEqual({ mode: "free", offset: 0 });
    // content changes and scrolling up leave a panel that is held at the top alone
    expect(at(FOLLOW_START, PANEL_TOP, PANEL_TOP - 600, 0)).toBe(FOLLOW_START);
    expect(at(FOLLOW_START, PANEL_TOP, PANEL_TOP - 600, -1)).toBe(FOLLOW_START);
  });
  it("is held again once its end is in view, and released the other way when the reader scrolls up", () => {
    const free: FollowState = { mode: "free", offset: 600 };
    expect(at(free, -300, -900, 1)).toBe(free); // end still below the window: 1100 > 884
    const bottom = at(free, vh - 16 - tall, -1116, 1);
    expect(bottom).toEqual({ mode: "bottom", offset: 600 });
    expect(at(bottom, vh - 16 - tall, -1500, 1)).toBe(bottom);
    expect(at(bottom, vh - 16 - tall, -1500, 0)).toBe(bottom);
    // scrolling up: back into the flow exactly where it is drawn
    expect(at(bottom, vh - 16 - tall, -1500, -1)).toEqual({ mode: "free", offset: 984 });
    // and held at the top once its head is back under the bars
    expect(at({ mode: "free", offset: 984 }, PANEL_TOP - 40, -900, -1)).toEqual({ mode: "free", offset: 984 });
    expect(at({ mode: "free", offset: 984 }, PANEL_TOP + 3, -873, -1)).toEqual(FOLLOW_START);
  });
  it("reserves room in its column so a panel that grows stays under the reader's eyes", () => {
    // 600 px down a 700 px map, a 300 px panel becomes 900 px: the column must be 1500 px or the panel would be pushed up
    expect(followRoom(PANEL_TOP - 600, 900)).toBe(1500);
    // nothing followed yet: only its own height
    expect(followRoom(330, 900)).toBe(900);
  });
});
