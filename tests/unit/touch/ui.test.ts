// PLAN M5-P1 (Touch): the touch HUD's pure parts against DESIGN "Input and interaction design", Touch: the radial
// menu's eight slots around the long-press point (owner decisions: tap/untap, flip, inspect, +1/+1, to hand, to
// graveyard, exile, to stack), sized for thumbs and kept on screen; the hand fan that scrolls horizontally and lifts
// cards; the device check that brings the thumb bar.
import { describe, expect, it } from 'vitest';
import type { ActionId } from '../../../src/games/types';
import { fanLayout } from '../../../src/ui/hand';
import { RADIAL_SLOTS, TOUCH_TARGET_PX } from '../../../src/ui/touch/actions';
import { blockPageGestures, touchDevice } from '../../../src/ui/touch/device';
import { fanIndexAt, TOUCH_FAN_MARGIN_PX, touchFanLayout } from '../../../src/ui/touch/fan';
import { RADIAL_RADIUS_PX, RADIAL_SLOT_PX, radialLayout, slotAction } from '../../../src/ui/touch/radial';

describe('radial menu', () => {
  it('puts the eight slots clockwise around the long-press point, tap at the top, a thumb wide and apart', () => {
    const l = radialLayout({ x: 600, y: 400 }, 1194, 834);
    expect(l.centre).toEqual({ x: 600, y: 400 });
    expect(l.slots.map((s) => s.slot.id)).toEqual(RADIAL_SLOTS.map((s) => s.id));
    const top = l.slots[0]!;
    expect(top.x).toBeCloseTo(600, 6);
    expect(top.y).toBeCloseTo(400 - RADIAL_RADIUS_PX, 6);
    const right = l.slots.find((s) => s.slot.angleDeg === 90)!;
    expect(right.x).toBeCloseTo(600 + RADIAL_RADIUS_PX, 6);
    expect(RADIAL_SLOT_PX).toBeGreaterThanOrEqual(TOUCH_TARGET_PX);
    // Neighbouring slots do not overlap.
    for (let i = 0; i < l.slots.length; i++) {
      const a = l.slots[i]!;
      const b = l.slots[(i + 1) % l.slots.length]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(RADIAL_SLOT_PX);
    }
  });

  it('moves in from the screen edges and the safe area so every slot is fully on screen', () => {
    for (const at of [
      { x: 0, y: 0 },
      { x: 1194, y: 834 },
      { x: 5, y: 800 },
    ]) {
      const insets = { top: 24, right: 0, bottom: 20, left: 0 };
      const l = radialLayout(at, 1194, 834, insets);
      for (const s of l.slots) {
        expect(s.x - RADIAL_SLOT_PX / 2).toBeGreaterThanOrEqual(0);
        expect(s.x + RADIAL_SLOT_PX / 2).toBeLessThanOrEqual(1194);
        expect(s.y - RADIAL_SLOT_PX / 2).toBeGreaterThanOrEqual(insets.top);
        expect(s.y + RADIAL_SLOT_PX / 2).toBeLessThanOrEqual(834 - insets.bottom);
      }
    }
  });

  it('runs the first action of a slot that applies, so the stack slot casts from hand and adds an ability in play', () => {
    const stack = RADIAL_SLOTS.find((s) => s.id === 'stack')!;
    const inHand = (a: ActionId) => a === 'cast';
    const inPlay = (a: ActionId) => a === 'ability' || a === 'tap';
    expect(slotAction(stack, inHand)).toBe('cast');
    expect(slotAction(stack, inPlay)).toBe('ability');
    expect(slotAction(stack, () => false)).toBeNull();
    expect(slotAction(RADIAL_SLOTS[0]!, inPlay)).toBe('tap');
  });
});

describe('hand fan on a touch screen', () => {
  const vw = 1194;
  const vh = 834;

  it('is the desktop fan while every card keeps a touch target uncovered', () => {
    for (const n of [0, 1, 7, 12]) {
      const t = touchFanLayout(n, vw, vh, null, 0);
      expect(t.boxes).toEqual(fanLayout(n, vw, vh, null));
      expect(t.maxScroll).toBe(0);
    }
    const lifted = touchFanLayout(7, vw, vh, 3, 0);
    expect(lifted.boxes).toEqual(fanLayout(7, vw, vh, 3));
  });

  it('a large hand keeps each card a touch target wide and scrolls sideways within the screen', () => {
    const n = 30;
    const t0 = touchFanLayout(n, vw, vh, null, 0);
    expect(t0.maxScroll).toBeGreaterThan(0);
    for (let i = 1; i < n; i++) expect(t0.boxes[i]!.left - t0.boxes[i - 1]!.left).toBeCloseTo(TOUCH_TARGET_PX, 6);
    expect(t0.boxes[0]!.left).toBeCloseTo(TOUCH_FAN_MARGIN_PX, 6);
    // Scrolled to the end, the last card ends at the margin.
    const end = touchFanLayout(n, vw, vh, null, 1e9);
    expect(end.scroll).toBe(end.maxScroll);
    const last = end.boxes[n - 1]!;
    expect(last.left + last.width).toBeCloseTo(vw - TOUCH_FAN_MARGIN_PX, 6);
    // Scroll is clamped at both ends.
    expect(touchFanLayout(n, vw, vh, null, -50).scroll).toBe(0);
    expect(touchFanLayout(n, vw, vh, null, Number.NaN).scroll).toBe(0);
  });

  it('lifts a card to the raised height over its place, inside the screen, on top', () => {
    const n = 30;
    for (const i of [0, 15, 29]) {
      const t = touchFanLayout(n, vw, vh, i, i === 29 ? 1e9 : 0);
      const b = t.boxes[i]!;
      expect(b.height).toBeCloseTo(vh * 0.45, 6);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.left + b.width).toBeLessThanOrEqual(vw + 1e-6);
      expect(b.z).toBe(n + 1);
    }
  });

  it('finds the card under a finger: the topmost covering box, else the nearest', () => {
    const boxes = touchFanLayout(30, vw, vh, null, 0).boxes;
    // Over card 3's uncovered strip.
    expect(fanIndexAt(boxes, boxes[3]!.left + 10)).toBe(3);
    // Past the right end of the fan: the last card shown there.
    expect(fanIndexAt(boxes, 5000)).toBe(29);
    expect(fanIndexAt(boxes, -100)).toBe(0);
    expect(fanIndexAt([], 10)).toBe(-1);
  });
});

describe('touch devices', () => {
  const win = (coarse: boolean, points: number) => ({ matchMedia: (q: string) => ({ matches: coarse && q.includes('coarse') }) as MediaQueryList, navigator: { maxTouchPoints: points } as Navigator });

  it('a coarse pointer or touch points (iPadOS Safari presents itself as a Mac) mean a touch screen', () => {
    expect(touchDevice(win(true, 0))).toBe(true);
    expect(touchDevice(win(false, 5))).toBe(true);
    expect(touchDevice(win(false, 0))).toBe(false);
    expect(touchDevice(undefined)).toBe(false);
  });

  it("Safari's page pinch gestures are prevented while the table shows, and released afterwards", () => {
    const target = new EventTarget();
    const undo = blockPageGestures(target);
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      const e = new Event(type, { cancelable: true });
      target.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
    }
    undo();
    const e = new Event('gesturestart', { cancelable: true });
    target.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });
});
