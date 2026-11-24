// How /app/supply-chain changes what it shows without moving the reader. The router restores scroll on every navigation
// (src/router.tsx, `scrollRestoration`), so each address change the page makes says `resetScroll: false`; nothing on the
// page scrolls as a side effect of a click. When what a click produced is out of view, the page shows a cue with a button
// and the reader decides (`offscreen` picks the direction). The evidence panel beside the map follows the reader down the
// page and stays where it is when its content grows (`nextFollow`, `followRoom`). page-nav.test.ts guards all of it.
// Pure, no browser/Node APIs.

/** View state (view, tab, overlay, depth, selection, isolation): replaces the history entry, never moves the page. */
export const VIEW_NAV = { replace: true, resetScroll: false } as const;
/** A company change: a new history entry (Back returns to the previous company), the page stays where it is. */
export const COMPANY_NAV = { resetScroll: false } as const;

/** The page's regions, in reading order. Ids are the anchors the section links and cues scroll to when pressed. */
export const SUPPLY_SECTIONS = [
  { id: "supply-map", label: "Map" },
  { id: "supply-summary", label: "Summary" },
  { id: "supply-regions", label: "Regions" },
  { id: "supply-signals", label: "Contracts" },
  { id: "supply-market", label: "Market" },
  { id: "supply-coverage", label: "Coverage" },
] as const;
export type SupplySectionId = (typeof SUPPLY_SECTIONS)[number]["id"];

/** Height of the app header, the fallback for `--sticky-top`. */
export const APP_HEADER = 56;
/** Height of the section links that stay under the app header. */
export const SECTION_NAV = 40;
/** Where a panel that follows the reader sits: under the app header and the section links, with a little air. */
export const PANEL_TOP = APP_HEADER + SECTION_NAV + 12;

/** Whether a panel of this height can follow the reader down the page without any of it being cut off at the bottom of the window. */
export function fitsBeside(panelHeight: number, viewportHeight: number, top: number = PANEL_TOP, margin = 16): boolean {
  return panelHeight <= viewportHeight - top - margin;
}

/**
 * Where a region sits relative to what the reader can see: "above" or "below" when less than `margin` px of it is inside
 * the visible band (under the sticky header, above the bottom edge), null when it can be read where it is.
 */
export function offscreen(rect: { top: number; bottom: number }, viewportHeight: number, stickyTop: number = APP_HEADER, margin = 64): "above" | "below" | null {
  if (rect.bottom < stickyTop + margin) return "above";
  if (rect.top > viewportHeight - margin) return "below";
  return null;
}

/**
 * How the panel beside the map follows the reader. `top`: held under the sticky bars (the browser's own sticky
 * positioning, so it never trembles). A panel taller than the window cannot be read that way, so it takes turns:
 * scrolling down releases it into the flow (`free`) until its end is in view, where it is held again (`bottom`);
 * scrolling up releases it until its head is back under the bars. `offset` is how far below the top of its column it
 * sits while in the flow.
 */
export type FollowMode = "top" | "free" | "bottom";
export interface FollowState { mode: FollowMode; offset: number }
export interface FollowMeasure {
  /** viewport y of the top of the panel's column */
  cellTop: number;
  /** viewport y of the panel as it is drawn now */
  panelTop: number;
  panelHeight: number;
  viewportHeight: number;
  /** 1 scrolling down, -1 scrolling up, 0 when only the content changed */
  dir: -1 | 0 | 1;
}
export const FOLLOW_START: FollowState = { mode: "top", offset: 0 };

/** The next way to hold the panel. Every change of mode keeps the panel where it is on screen at that moment. */
export function nextFollow(prev: FollowState, m: FollowMeasure, top: number = PANEL_TOP, margin = 16): FollowState {
  if (fitsBeside(m.panelHeight, m.viewportHeight, top, margin)) return prev.mode === "top" ? prev : FOLLOW_START;
  const at = Math.max(0, Math.round(m.panelTop - m.cellTop));
  if (prev.mode === "top") return m.dir > 0 ? { mode: "free", offset: at } : prev;
  if (prev.mode === "bottom") return m.dir < 0 ? { mode: "free", offset: at } : prev;
  if (m.dir > 0 && m.panelTop + m.panelHeight <= m.viewportHeight - margin) return { mode: "bottom", offset: prev.offset };
  if (m.dir < 0 && m.panelTop >= top) return FOLLOW_START;
  return prev;
}

/**
 * The height the panel's column needs so a panel held at the top can stay there: how far it has followed the reader
 * plus its own height. Without it a panel that grows (another tab, a longer list) would be pushed up by the end of
 * its column and its tabs would leave the reader's view.
 */
export function followRoom(cellTop: number, panelHeight: number, top: number = PANEL_TOP): number {
  return Math.max(0, Math.round(top - cellTop)) + panelHeight;
}
