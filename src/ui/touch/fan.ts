/**
 * The hand fan on a touch screen (DESIGN "Input and interaction design", Touch: "The hand fan scrolls horizontally and
 * lifts cards on touch for reading"; "Specification: geometry, layout and motion", Screen layer). Pure, in CSS px.
 *
 * While the desktop fan (ui/hand.ts fanLayout) leaves every card at least a touch target's width uncovered, the touch fan
 * is the same. Once a large hand would overlap more than that, the cards keep a touch target's width each and the fan
 * spans the screen width less a margin, scrolling sideways under the finger; the lifted card is drawn at the raised size
 * over its place, inside the screen.
 */
import { SCREEN_LAYER } from '../../core/geometry';
import { CARD_ASPECT, fanLayout, type FanBox } from '../hand';
import { TOUCH_TARGET_PX } from './actions';
import { NO_EDGE_INSETS, type EdgeInsets } from './radial';

/** Space kept at either screen edge by a scrolling fan, CSS px. */
export const TOUCH_FAN_MARGIN_PX = 8;

export interface TouchFan {
  boxes: FanBox[];
  /** How far the fan can scroll (0: it fits). */
  maxScroll: number;
  /** The scroll offset used, clamped to [0, maxScroll]. */
  scroll: number;
}

/**
 * `insets` are the device's left and right safe-area insets (PLAN Milestone 5, owner decisions: safe-area insets
 * respected): the fan is laid out in the width between them, offsets still measured from the screen's left edge.
 */
export function touchFanLayout(n: number, vw: number, vh: number, lifted: number | null, scroll: number, insets: Pick<EdgeInsets, 'left' | 'right'> = NO_EDGE_INSETS): TouchFan {
  const inL = Math.max(0, insets.left);
  const iw = Math.max(0, vw - inL - Math.max(0, insets.right));
  const desktop = fanLayout(n, iw, vh, null);
  const step = n > 1 ? desktop[1]!.left - desktop[0]!.left : Infinity;
  if (step >= TOUCH_TARGET_PX) return { boxes: fanLayout(n, iw, vh, lifted).map((b) => ({ ...b, left: b.left + inL })), maxScroll: 0, scroll: 0 };
  const h = vh * SCREEN_LAYER.handCardViewportFraction;
  const w = h * CARD_ASPECT;
  const total = w + (n - 1) * TOUCH_TARGET_PX;
  const band = Math.max(w, iw - 2 * TOUCH_FAN_MARGIN_PX);
  const maxScroll = Math.max(0, total - band);
  const s = Math.min(Math.max(0, Number.isFinite(scroll) ? scroll : 0), maxScroll);
  const left0 = inL + (maxScroll > 0 ? TOUCH_FAN_MARGIN_PX - s : (iw - total) / 2);
  const boxes: FanBox[] = [];
  for (let i = 0; i < n; i++) {
    const left = left0 + i * TOUCH_TARGET_PX;
    if (i === lifted) {
      const hh = vh * SCREEN_LAYER.handHoverViewportFraction;
      const hw = hh * CARD_ASPECT;
      const centred = left + w / 2 - hw / 2;
      boxes.push({ left: inL + Math.min(Math.max(0, centred - inL), Math.max(0, iw - hw)), bottom: 0, width: hw, height: hh, z: n + 1 });
    } else boxes.push({ left, bottom: 0, width: w, height: h, z: i + 1 });
  }
  return { boxes, maxScroll, scroll: s };
}

/**
 * The card under a finger at screen x in a fan laid out without a lifted card: the topmost (highest index) box that
 * covers x, else the nearest one; -1 for an empty fan.
 */
export function fanIndexAt(boxes: readonly FanBox[], x: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i]!;
    if (x >= b.left && x <= b.left + b.width) return i;
    const d = Math.min(Math.abs(x - b.left), Math.abs(x - b.left - b.width));
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Height the thumb action bar takes above the hand fan, its gap included (a touch target plus the bar's padding and
 * border, 8 px clear of the fan), CSS px: the HUD's prompts above the hand and the table fit move up by it.
 */
export const THUMB_BAR_SPACE_PX = 64;

/**
 * A menu of `w` × `h` CSS px opened at (x, y), moved in so it stays `margin` px inside the screen and clear of the
 * safe-area insets (the context menu; PLAN Milestone 5, owner decisions: safe-area insets respected).
 */
export function clampMenu(x: number, y: number, w: number, h: number, vw: number, vh: number, insets: EdgeInsets = NO_EDGE_INSETS, margin = 4): { left: number; top: number } {
  const lo = (inset: number) => Math.max(0, inset) + margin;
  return {
    left: Math.max(lo(insets.left), Math.min(x, vw - Math.max(0, insets.right) - margin - w)),
    top: Math.max(lo(insets.top), Math.min(y, vh - Math.max(0, insets.bottom) - margin - h)),
  };
}
