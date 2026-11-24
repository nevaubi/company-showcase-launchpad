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
