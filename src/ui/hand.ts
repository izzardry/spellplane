/**
 * Screen-anchored hand fan geometry (DESIGN "Specification: geometry, layout and motion", Screen layer: cards at 22%
 * of viewport height, overlapping to fit 80% of the width, the hovered card raised to 45% of viewport height;
 * "Camera and navigation", Screen-anchored layer). Pure, in CSS pixels.
 */
import type { InstanceId, SecretStore, TableState } from '../core/types';
import { GEOMETRY, SCREEN_LAYER } from '../core/geometry';
import { TEAM_FAN_HEIGHT } from './types';

/** Card aspect: width / height = 63 / 88 (DESIGN "Specification: geometry, layout and motion"). */
export const CARD_ASPECT = GEOMETRY.card.w / GEOMETRY.card.h;
/** Gap between hand cards while they fit without overlapping. */
export const HAND_GAP_PX = 8;

/** One card's box: left and bottom edge offsets from the viewport's left and bottom, size. */
export interface FanBox {
  left: number;
  bottom: number;
  width: number;
  height: number;
  /** Paint order, the hovered card on top. */
  z: number;
}

/**
 * The free band of the bottom edge the fan may use, CSS px from the viewport's left edge (visual.md 2.9 board 7: the own
 * plate bottom left, talk and the primary bottom right, the hand fan between them and nothing over a card face).
 */
export interface FanSpan {
  left: number;
  right: number;
}

/**
 * Layout of `n` hand cards in a `vw` x `vh` viewport with card `hovered` (index) raised. With `span` the resting fan
 * fits inside that band (centred in it, overlapping more where it must) instead of 80 % of the width. The raised card
 * stays centred on its slot, inside the window: it is read for a moment and lies over everything (pulled into the band,
 * it slid toward the middle and over the near battlefield the pointer was heading for).
 */
export function fanLayout(n: number, vw: number, vh: number, hovered: number | null = null, span: FanSpan | null = null): FanBox[] {
  if (n <= 0) return [];
  const h = vh * SCREEN_LAYER.handCardViewportFraction;
  const w = h * CARD_ASPECT;
  const band = span && span.right - span.left >= w ? span : null;
  const maxWidth = band ? Math.min(vw * SCREEN_LAYER.handWidthFraction, band.right - band.left) : vw * SCREEN_LAYER.handWidthFraction;
  const natural = n * w + (n - 1) * HAND_GAP_PX;
  const step = n === 1 ? 0 : natural <= maxWidth ? w + HAND_GAP_PX : (maxWidth - w) / (n - 1);
  const total = w + (n - 1) * step;
  const left0 = band ? (band.left + band.right - total) / 2 : (vw - total) / 2;
  const boxes: FanBox[] = [];
  for (let i = 0; i < n; i++) {
    const left = left0 + i * step;
    if (i === hovered) {
      const hh = vh * SCREEN_LAYER.handHoverViewportFraction;
      const hw = hh * CARD_ASPECT;
      const centred = left + w / 2 - hw / 2;
      boxes.push({ left: Math.min(Math.max(0, centred), Math.max(0, vw - hw)), bottom: 0, width: hw, height: hh, z: n + 1 });
    } else boxes.push({ left, bottom: 0, width: w, height: h, z: i + 1 });
  }
  return boxes;
}

/** The fan's own hand in the owner's arrangement (SecretStore.hand), then any hand card the arrangement lacks. */
export function handOrder(state: TableState, secrets: SecretStore, seat: string): InstanceId[] {
  const zone = state.zones[`hand:${seat}`];
  if (!zone) return [];
  const members = new Set(zone.ids);
  const ordered = secrets.hand.filter((id) => members.has(id));
  const seen = new Set(ordered);
  return [...ordered, ...zone.ids.filter((id) => !seen.has(id))];
}

/**
 * Screen edges (CSS px) the HUD's screen-anchored layer covers, for the scene's table fit (DESIGN "Camera and
 * navigation", Screen-anchored layer): `top` the toolbar and turn-strip row plus the stack chip below it (8 from the
 * edge, a 28 px strip, 6 clear, a 28 px chip, 4 clear; reserved even while the stack is empty, so the fitted view does
 * not jump when a spell goes on the stack), `log` the open log column at the right
 * (300 wide, 8 from the edge, 8 clear), `handGap` the margin above the hand fan (22% of viewport height), `avatars`
 * the avatar column at the left (150 plus padding, 8 from the edge, 8 clear), `farPlate` the room above the far edge
 * for the plate across the table at three or more chairs (a 46 px compact plate and 4 clear; gate M8 N4).
 */
export const FIT_INSET = { top: 74, log: 316, handGap: 8, avatars: 190, farPlate: 50 } as const;

/**
 * The teammate's fan above the own one at a Two-Headed Giant table (ui/hand/team.ts: a 12 px gap, cards at
 * TEAM_FAN_HEIGHT of the viewport height, and its name label of about 22 px above them).
 */
export const TEAM_FAN_INSET = { gap: 12, label: 22 } as const;

const NO_SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 } as const;

/**
 * The scene host's `data-fit-insets` value, "top right bottom left" in CSS px. With `teamFan` the teammate's fan is
 * kept clear as well, so the fitted table (the own avatar spots and the lines aimed at them) sits above it (M3 gate).
 * `extraBottom` is room taken above the fan by more of the screen layer (the thumb action bar on touch screens, M5-P1).
 * `safe` are the device's safe-area insets (the iPad's home indicator and rounded corners, M5-P1): the screen layer sits
 * inside them, so each edge's inset grows by its own.
 */
export function fitInsets(vh: number, logOpen: boolean, teamFan = false, extraBottom = 0, safe: { top: number; right: number; bottom: number; left: number } = NO_SAFE_AREA, sides = false): string {
  const team = teamFan ? TEAM_FAN_INSET.gap + Math.round(vh * TEAM_FAN_HEIGHT) + TEAM_FAN_INSET.label : 0;
  const px = (v: number) => Math.max(0, Math.round(v));
  const bottom = Math.round(vh * SCREEN_LAYER.handCardViewportFraction) + FIT_INSET.handGap + team + px(extraBottom) + px(safe.bottom);
  // `sides`: side seats' plates stand on both sides of the table (three or more chairs), so the right keeps the left's room,
  // and the plate across the table stands above the table's far edge, clear of that seat's piles (gate M8 N4, round 3).
  const right = Math.max(logOpen ? FIT_INSET.log : 0, sides ? FIT_INSET.avatars : 0);
  const top = FIT_INSET.top + (sides ? FIT_INSET.farPlate : 0);
  return `${top + px(safe.top)} ${right + px(safe.right)} ${bottom} ${FIT_INSET.avatars + px(safe.left)}`;
}
