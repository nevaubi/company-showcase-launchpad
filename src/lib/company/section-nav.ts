// The Overview section nav's choice of the marked chip, kept pure so the rules can be pinned by tests.

/** A jump lands a section's top on the line give or take sub-pixel rounding; within this it counts as reached. */
export const LINE_TOLERANCE = 1;

/**
 * The section in view: the last one whose top has reached the line under the sticky rows (within the tolerance),
 * the first one above that, and the last one when the page is scrolled to its end.
 */
export function currentSection(tops: { id: string; top: number }[], line: number, at: { end: boolean; scrolled: boolean }): string | undefined {
  let current = tops[0]?.id;
  for (const s of tops) if (s.top - line <= LINE_TOLERANCE) current = s.id;
  if (at.end && at.scrolled && tops.length) current = tops[tops.length - 1].id;
  return current;
}

/**
 * A chip the reader clicked stays marked while the smooth scroll runs (`y` null) and afterwards for as long as
 * the page stays where the jump left it; the first scroll of the reader's own hands it back to the measurement.
 */
export interface NavPin {
  id: string;
  /** scroll position where the jump ended; null while it is still moving */
  y: number | null;
}

export function markedSection(pin: NavPin | null, scrollY: number, measured: string | undefined): { id: string | undefined; pin: NavPin | null } {
  if (pin && (pin.y === null || Math.abs(scrollY - pin.y) < 2)) return { id: pin.id, pin };
  return { id: measured, pin: null };
}
