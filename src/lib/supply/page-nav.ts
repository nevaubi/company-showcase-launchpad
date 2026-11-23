// How /app/supply-chain changes what it shows without moving the reader. The router restores scroll on every navigation
// (src/router.tsx, `scrollRestoration`), so each address change the page makes says `resetScroll: false`; nothing on the
// page scrolls as a side effect of a click. When what a click produced is out of view, the page shows a cue with a button
// and the reader decides (`offscreen` picks the direction). page-nav.test.ts guards all three. Pure, no browser/Node APIs.

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
