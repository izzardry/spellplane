/**
 * Frame pacing of ambient motion (DESIGN "Themes and rendering", Renderer). A lit theme's light and particles, the
 * pending pulse, ping fades and the foil sheen move with nothing changing, so they would draw every animation frame.
 * On a GPU that costs a few milliseconds a frame. On a software renderer (SwiftShader, llvmpipe: no GPU, or GPU
 * acceleration off) a lit frame at 1440 × 900 takes 0.3 to 1.5 s of CPU, and drawing back to back leaves the page no
 * time for input, messages or anything else: every click and every peer message waits behind a frame.
 *
 * So ambient motion is paced by what the last frame cost: while frames are cheap it draws every animation frame;
 * once one costs more than AMBIENT_SLOW_FRAME_MS, the next ambient-only frame waits until AMBIENT_BACKOFF frame costs
 * have passed since the last drawn frame (the renderer is busy at most 1 / AMBIENT_BACKOFF of the time for ambience).
 * Changes (state, camera, drags, card motion, texture uploads) always draw at once.
 */

/** A frame costing more than this (ms) marks a renderer too slow for ambient motion at the display's frame rate. */
export const AMBIENT_SLOW_FRAME_MS = 50;
/** On a slow renderer an ambient-only frame waits this many frame costs after the last drawn frame. */
export const AMBIENT_BACKOFF = 4;

/** Whether an ambient-only frame may be drawn, given the last frame's cost and the time since it was drawn (ms). */
export function ambientDue(frameCostMs: number, sinceDrawnMs: number): boolean {
  if (!(frameCostMs > AMBIENT_SLOW_FRAME_MS)) return true;
  return sinceDrawnMs >= AMBIENT_BACKOFF * frameCostMs;
}

/** The frame time the face upload budget per frame is sized for (60 fps), ms. */
const UPLOAD_FRAME_MS = 1000 / 60;
/** At most this many times the upload budget per frame on a slow renderer. */
export const UPLOAD_SCALE_MAX = 8;

/**
 * How many times the per-frame face upload budget (scene/faces.ts) one frame may take, given the last frame's cost:
 * 1 at 60 fps or faster, growing with the frame cost up to UPLOAD_SCALE_MAX. The budget keeps uploads from stalling a
 * frame on a GPU; on a renderer that takes a second a frame anyway, one budget a frame would bring the faces of a
 * zoom in at a trickle, and every batch ends with a mip-map pass over the whole texture array.
 */
export function uploadScale(frameCostMs: number): number {
  if (!(frameCostMs > UPLOAD_FRAME_MS)) return 1;
  return Math.min(UPLOAD_SCALE_MAX, frameCostMs / UPLOAD_FRAME_MS);
}
