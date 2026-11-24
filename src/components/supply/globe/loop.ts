/**
 * What the frame loop does after a frame: run again, and whether the camera's view is published.
 *
 * The camera is at rest when no flight, wheel zoom or coast is under way. Two things must not hold the view back:
 * - dots flowing along a selected link repaint the top layer for as long as the selection lasts, which is a reason to
 *   keep the loop running but says nothing about the camera, so the view is published on every frame the camera rests;
 * - a map that is out of view or in a background tab draws nothing, so a camera motion that is under way ends at
 *   once (`settle`): it would otherwise stop at its first step and leave the map half way when it comes back.
 */
export interface FrameState {
  /** the canvas is on screen and the tab is visible */
  showing: boolean;
  /** a flight, a wheel zoom or a coast still has steps to take */
  animating: boolean;
  /** dots travel along the selected link (motion allowed) */
  flowing: boolean;
}

export interface FrameDecision {
  /** request another frame */
  again: boolean;
  /** finish any camera motion now, before publishing */
  settle: boolean;
  /** write the camera to `data-view` */
  publish: boolean;
}

export function afterFrame(s: FrameState): FrameDecision {
  if (!s.showing) return { again: false, settle: s.animating, publish: true };
  return { again: s.animating || s.flowing, settle: false, publish: !s.animating };
}

/** How far the zoom may move from the last traced map before the map is traced again during a wheel or pinch zoom. */
export const RETRACE_RATIO = 1.15;

export interface BaseState {
  /** a wheel or pinch zoom is under way (a flight, a drag or a coast always traces) */
  zooming: boolean;
  /** something other than the camera changed the map (theme, tints, map data, size): the old picture is wrong */
  stale: boolean;
  /** scale of the frame to draw over the scale of the last traced map */
  ratio: number;
  /** the last traced map holds the whole picture (the globe's disc inside the frame), so a smaller copy leaves no gap */
  whole: boolean;
}

/**
 * Whether a frame of the map may be the last traced map scaled and moved instead of a new trace. Tracing the coasts of a
 * zoomed-in map costs 50 to 100 ms on a slow machine, which a wheel zoom hits every frame; moving and scaling the traced canvas costs nothing to draw.
 * Only while a zoom gesture runs, only for the camera's own change, and only within RETRACE_RATIO of the traced scale:
 * closer in, the copy would be visibly soft; farther out, it would leave an empty band round the edge unless the traced
 * map was whole. The frame after the gesture rests always traces, so the map is sharp again at once.
 */
export function reuseBase(s: BaseState): boolean {
  if (!s.zooming || s.stale || !Number.isFinite(s.ratio) || s.ratio <= 0) return false;
  if (s.ratio >= 1) return s.ratio < RETRACE_RATIO;
  return s.whole && s.ratio > 1 / RETRACE_RATIO;
}

/**
 * Zoom drawn by the map worker (engine.ts, `hi-geo.worker.ts`): during a wheel or pinch zoom and once it rests, the page
 * shows the last picture the worker drew, moved and scaled by a CSS transform, and asks for the next one; the page's own
 * thread never traces coasts for a zoom. A zoom out asks for a picture beyond its target (BEYOND further out), so there is
 * map to reveal while it runs; a zoom in asks for its target, which is sharp the moment the camera arrives.
 */
export const BEYOND = 1.3;

/** A picture traced at scale `tracedR` fills a frame drawn at scale `R`: it is scaled up, or it holds the whole disc. */
export function covers(tracedR: number, R: number, whole: boolean): boolean {
  return whole || R >= tracedR * 0.999;
}

/** Whether a newly drawn picture replaces the one shown: when it fills the frame, or when the shown one does not either. */
export function adoptPicture(shown: { R: number; whole: boolean }, next: { R: number; whole: boolean }, R: number): boolean {
  return covers(next.R, R, next.whole) || !covers(shown.R, R, shown.whole);
}

/** The zoom of the picture to ask the worker for: the target of a zoom in, beyond the target of a zoom out, else the camera's. */
export function pictureZoom(zoom: number, target: number | null, minZoom: number): number {
  if (target == null || !Number.isFinite(target)) return zoom;
  return target < zoom * 0.999 ? Math.max(minZoom, target / BEYOND) : target;
}
