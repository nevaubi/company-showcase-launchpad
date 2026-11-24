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
