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
