/**
 * The long-press radial menu's geometry and choice of action (DESIGN "Input and interaction design", Touch: "long-press
 * opens a radial menu with the eight most used actions"; PLAN Milestone 5, owner decisions: the eight slots). Pure, in
 * CSS px, so Vitest checks it without a page.
 */
import type { ActionId } from '../../games/types';
import { RADIAL_SLOTS, TOUCH_TARGET_PX, type RadialSlot } from './actions';

/** Distance of a slot's centre from the menu's centre, CSS px. */
export const RADIAL_RADIUS_PX = 84;
/** A slot button's size (at least a thumb's touch target), CSS px. */
export const RADIAL_SLOT_PX = Math.max(TOUCH_TARGET_PX, 56);
/** Room kept between the menu and the viewport edge, CSS px. */
export const RADIAL_MARGIN_PX = 8;

/** Screen edges covered by the device (iPad safe-area insets), CSS px. */
export interface EdgeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_EDGE_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Where the menu and each slot sit: the centre is the long-press point, moved in just enough that every slot shows. */
export interface RadialLayout {
  centre: { x: number; y: number };
  slots: { slot: RadialSlot; x: number; y: number }[];
}

export function radialLayout(at: { x: number; y: number }, vw: number, vh: number, insets: EdgeInsets = NO_EDGE_INSETS, slots: readonly RadialSlot[] = RADIAL_SLOTS): RadialLayout {
  const reach = RADIAL_RADIUS_PX + RADIAL_SLOT_PX / 2 + RADIAL_MARGIN_PX;
  const clamp = (v: number, lo: number, hi: number) => (hi < lo ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
  const centre = { x: clamp(at.x, insets.left + reach, vw - insets.right - reach), y: clamp(at.y, insets.top + reach, vh - insets.bottom - reach) };
  return {
    centre,
    slots: slots.map((slot) => {
      const a = (slot.angleDeg * Math.PI) / 180;
      // Degrees clockwise from straight up; screen y grows downward.
      return { slot, x: centre.x + Math.sin(a) * RADIAL_RADIUS_PX, y: centre.y - Math.cos(a) * RADIAL_RADIUS_PX };
    }),
  };
}

/** The action a slot runs for a card: the first of its actions that applies (Commands.applies), or null (slot disabled). */
export function slotAction(slot: RadialSlot, applies: (action: ActionId) => boolean): ActionId | null {
  return slot.actions.find((a) => applies(a)) ?? null;
}
